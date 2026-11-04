-- Circle wallet: initial schema.
--
-- The `transactions` table is an append-mostly ledger and the single source of
-- truth for balances. Balances are never stored; they are derived from the
-- ledger (see `user_balances`), so they cannot drift from the history the user
-- sees. Every write that affects money goes through a SECURITY DEFINER function
-- so the invariants (no overdraft, no status regression) live in the database.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

comment on table public.app_settings is 'Key/value settings, e.g. the Circle wallet set id created on first run.';

create table public.users (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(btrim(name)) between 1 and 100),
  circle_wallet_id text not null unique,
  address          text not null,
  blockchain       text not null,
  created_at       timestamptz not null default now()
);

create index users_address_idx on public.users (lower(address));

-- Token metadata cached from Circle (GET /v1/w3s/tokens/{id}).
create table public.tokens (
  id            text primary key,           -- Circle token id
  symbol        text not null,
  name          text,
  decimals      integer not null check (decimals between 0 and 36),
  token_address text,
  blockchain    text not null,
  created_at    timestamptz not null default now()
);

create type public.tx_direction as enum ('deposit', 'withdrawal');
create type public.tx_status as enum ('pending', 'completed', 'failed');

create table public.transactions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users (id) on delete cascade,
  direction           public.tx_direction not null,
  status              public.tx_status not null default 'pending',
  token_id            text not null references public.tokens (id),
  amount              numeric(38, 18) not null check (amount > 0),
  source_address      text,
  destination_address text,
  circle_tx_id        text,
  circle_state        text,
  tx_hash             text,
  error_reason        text,
  -- How many times we tried to submit a withdrawal to Circle.
  submit_attempts     integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- A Circle transfer between two of our own wallets yields an OUTBOUND record
  -- for one user and an INBOUND record for the other, hence the pair.
  constraint transactions_circle_tx_unique unique (circle_tx_id, direction)
);

create index transactions_user_created_idx on public.transactions (user_id, created_at desc);
create index transactions_pending_idx on public.transactions (status) where status = 'pending';

-- Raw webhook log: idempotency (Circle delivers at least once) and audit.
create table public.webhook_events (
  notification_id   text primary key,
  notification_type text not null,
  payload           jsonb not null,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  error             text
);

-- The backend talks to the database with the service role key; nothing is
-- exposed to anon/authenticated clients.
alter table public.app_settings   enable row level security;
alter table public.users          enable row level security;
alter table public.tokens         enable row level security;
alter table public.transactions   enable row level security;
alter table public.webhook_events enable row level security;

-- ---------------------------------------------------------------------------
-- Circle state helpers
-- ---------------------------------------------------------------------------

-- Position of a Circle state in the lifecycle. Webhooks may arrive out of
-- order, so we never move a transaction to a lower rank.
create function public.circle_state_rank(p_state text)
returns integer
language sql immutable
as $$
  select case upper(p_state)
    when 'INITIATED' then 1
    when 'CLEARED'   then 2
    when 'QUEUED'    then 3
    when 'SENT'      then 4
    when 'STUCK'     then 4
    when 'CONFIRMED' then 5
    when 'COMPLETE'  then 6
    when 'FAILED'    then 6
    when 'DENIED'    then 6
    when 'CANCELLED' then 6
    else 0
  end
$$;

create function public.circle_state_to_status(p_state text)
returns public.tx_status
language sql immutable
as $$
  select case upper(p_state)
    when 'COMPLETE'  then 'completed'::public.tx_status
    when 'FAILED'    then 'failed'::public.tx_status
    when 'DENIED'    then 'failed'::public.tx_status
    when 'CANCELLED' then 'failed'::public.tx_status
    else 'pending'::public.tx_status
  end
$$;

-- ---------------------------------------------------------------------------
-- Read models (amounts as text: PostgREST would turn numeric into JSON numbers
-- and lose precision)
-- ---------------------------------------------------------------------------

create view public.user_balances
with (security_invoker = true)
as
select
  t.user_id,
  t.token_id,
  coalesce(sum(case
    when t.direction = 'deposit'    and t.status = 'completed' then t.amount
    when t.direction = 'withdrawal' and t.status <> 'failed'   then -t.amount
    else 0 end), 0) as available,
  coalesce(sum(case when t.direction = 'deposit'    and t.status = 'pending' then t.amount else 0 end), 0) as incoming,
  coalesce(sum(case when t.direction = 'withdrawal' and t.status = 'pending' then t.amount else 0 end), 0) as outgoing
from public.transactions t
group by t.user_id, t.token_id;

create view public.user_balances_api
with (security_invoker = true)
as
select
  b.user_id,
  b.token_id,
  trim_scale(b.available)::text as available,
  trim_scale(b.incoming)::text  as incoming,
  trim_scale(b.outgoing)::text  as outgoing,
  to_jsonb(k) - 'created_at'    as token
from public.user_balances b
join public.tokens k on k.id = b.token_id;

create view public.transactions_api
with (security_invoker = true)
as
select
  t.id,
  t.user_id,
  t.direction,
  t.status,
  t.circle_state,
  t.circle_tx_id,
  trim_scale(t.amount)::text as amount,
  t.source_address,
  t.destination_address,
  t.tx_hash,
  t.error_reason,
  t.created_at,
  t.updated_at,
  to_jsonb(k) - 'created_at' as token
from public.transactions t
join public.tokens k on k.id = t.token_id;

-- ---------------------------------------------------------------------------
-- Write path
-- ---------------------------------------------------------------------------

-- Reserve funds and create a pending withdrawal atomically. The user row lock
-- serialises concurrent withdrawals of the same user, so the balance check and
-- the insert cannot interleave (no double spend).
create function public.create_withdrawal(
  p_user_id     uuid,
  p_token_id    text,
  p_amount      numeric,
  p_destination text
)
returns setof public.transactions_api
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user      public.users;
  v_available numeric;
  v_id        uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;

  select * into v_user from public.users where id = p_user_id for update;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0001';
  end if;

  select coalesce(available, 0) into v_available
  from public.user_balances
  where user_id = p_user_id and token_id = p_token_id;

  if coalesce(v_available, 0) < p_amount then
    raise exception 'insufficient_funds' using errcode = 'P0001';
  end if;

  insert into public.transactions (user_id, direction, status, token_id, amount, source_address, destination_address)
  values (p_user_id, 'withdrawal', 'pending', p_token_id, p_amount, v_user.address, p_destination)
  returning id into v_id;

  return query select * from public.transactions_api where id = v_id;
end
$$;

-- Apply a Circle transaction snapshot (from a webhook or from polling) to the
-- ledger. Idempotent and order-independent:
--  * final statuses (completed / failed) are never changed;
--  * a pending transaction only moves forward in the Circle lifecycle.
-- For withdrawals `p_ref_id` is our transaction id (we send it to Circle as
-- refId and as the idempotency key), which links the Circle record to the row
-- that already holds the reservation.
create function public.apply_circle_transaction(
  p_user_id      uuid,
  p_direction    public.tx_direction,
  p_circle_tx_id text,
  p_state        text,
  p_token_id     text,
  p_amount       numeric,
  p_source       text,
  p_destination  text,
  p_tx_hash      text,
  p_error        text,
  p_ref_id       uuid default null
)
returns setof public.transactions_api
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_status public.tx_status := public.circle_state_to_status(p_state);
  v_rank   integer := public.circle_state_rank(p_state);
begin
  -- 1. Find the existing ledger row, if any.
  select id into v_id
  from public.transactions
  where circle_tx_id = p_circle_tx_id and direction = p_direction
  for update;

  if v_id is null and p_direction = 'withdrawal' and p_ref_id is not null then
    select id into v_id
    from public.transactions
    where id = p_ref_id and user_id = p_user_id and direction = 'withdrawal'
    for update;
  end if;

  -- 2. Unknown transaction: record it. (Deposits always land here first; an
  --    unknown withdrawal means someone moved funds outside of this app, and
  --    the ledger must still reflect it.)
  if v_id is null then
    insert into public.transactions (
      user_id, direction, status, token_id, amount, source_address,
      destination_address, circle_tx_id, circle_state, tx_hash, error_reason
    ) values (
      p_user_id, p_direction, v_status, p_token_id, p_amount, p_source,
      p_destination, p_circle_tx_id, upper(p_state), p_tx_hash, p_error
    )
    on conflict (circle_tx_id, direction) do nothing
    returning id into v_id;

    if v_id is null then
      -- Lost a race with a concurrent insert of the same Circle transaction.
      select id into v_id from public.transactions
      where circle_tx_id = p_circle_tx_id and direction = p_direction
      for update;
    else
      return query select * from public.transactions_api where id = v_id;
      return;
    end if;
  end if;

  -- 3. Move the existing row forward (never backwards, never out of a final state).
  update public.transactions t
  set circle_tx_id = coalesce(t.circle_tx_id, p_circle_tx_id),
      circle_state = upper(p_state),
      status       = v_status,
      tx_hash      = coalesce(p_tx_hash, t.tx_hash),
      error_reason = coalesce(p_error, t.error_reason),
      updated_at   = now()
  where t.id = v_id
    and t.status = 'pending'
    and v_rank >= public.circle_state_rank(t.circle_state);

  return query select * from public.transactions_api where id = v_id;
end
$$;

-- Mark a withdrawal that Circle definitively rejected (e.g. 4xx on submit).
-- Releases the reservation because failed withdrawals do not count against
-- the balance.
create function public.fail_withdrawal(p_id uuid, p_error text)
returns setof public.transactions_api
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.transactions
  set status = 'failed', error_reason = p_error, updated_at = now()
  where id = p_id and direction = 'withdrawal' and status = 'pending' and circle_tx_id is null;

  return query select * from public.transactions_api where id = p_id;
end
$$;

-- Only the backend (service_role) may call the write functions.
revoke execute on function public.create_withdrawal(uuid, text, numeric, text) from public, anon, authenticated;
revoke execute on function public.apply_circle_transaction(uuid, public.tx_direction, text, text, text, numeric, text, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.fail_withdrawal(uuid, text) from public, anon, authenticated;
grant execute on function public.create_withdrawal(uuid, text, numeric, text) to service_role;
grant execute on function public.apply_circle_transaction(uuid, public.tx_direction, text, text, text, numeric, text, text, text, text, uuid) to service_role;
grant execute on function public.fail_withdrawal(uuid, text) to service_role;
