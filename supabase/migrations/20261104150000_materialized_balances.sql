-- Materialized balances.
--
-- Before: balances were a view that summed a user's whole transaction history on
-- every read (O(history)). Now each (user, token) pair has one row in `balances`,
-- maintained by statement-level triggers on `transactions` in the same database
-- transaction as the ledger change, so:
--   * reading a balance is a primary-key lookup, independent of history size;
--   * a write applies only the deltas of the changed rows, one balance update per
--     (user, token) per statement - also for bulk imports;
--   * stored balances cannot drift from the history - whatever path writes to
--     `transactions` (SQL functions, future code, manual fixes) goes through the trigger.
-- `balance_drift()` recomputes balances from the ledger and reports differences;
-- it is used by the tests and can be run as a periodic consistency check.

-- One transaction: the switch-over is atomic. Applied on a live ledger, so writers
-- are blocked while the trigger is installed and the table is backfilled.
begin;

lock table public.transactions in share row exclusive mode;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.balances (
  user_id    uuid not null references public.users (id) on delete cascade,
  token_id   text not null references public.tokens (id),
  -- Spendable: completed deposits minus all non-failed withdrawals.
  available  numeric(38, 18) not null default 0,
  -- Deposits seen by Circle but not COMPLETE yet.
  incoming   numeric(38, 18) not null default 0 check (incoming >= 0),
  -- Pending withdrawals (already subtracted from `available`).
  outgoing   numeric(38, 18) not null default 0 check (outgoing >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, token_id)
);

comment on table public.balances is
  'Per-user, per-token balance, maintained by the transactions_balance_* triggers. Never write directly.';
comment on column public.balances.available is
  'Not constrained to >= 0 on purpose: an outbound transfer made outside the app must still be recorded.';

alter table public.balances enable row level security;

-- ---------------------------------------------------------------------------
-- Trigger: apply the delta of every ledger change
-- ---------------------------------------------------------------------------

-- How much one ledger row contributes to its balance row. The single source of
-- truth for the balance rules; balance_drift() uses it too.
create function public.tx_balance_effect(
  p_direction public.tx_direction,
  p_status    public.tx_status,
  p_amount    numeric,
  out available numeric,
  out incoming  numeric,
  out outgoing  numeric
)
language sql immutable
as $$
  select
    case
      when p_direction = 'deposit'    and p_status = 'completed' then p_amount
      when p_direction = 'withdrawal' and p_status <> 'failed'   then -p_amount
      else 0
    end,
    case when p_direction = 'deposit'    and p_status = 'pending' then p_amount else 0 end,
    case when p_direction = 'withdrawal' and p_status = 'pending' then p_amount else 0 end
$$;

-- Statement-level triggers with transition tables: one firing per SQL statement,
-- deltas summed per (user, token), each balance row updated once. A per-row
-- trigger would rewrite the same balance row N times in a bulk statement (each
-- update creating a new row version), which degrades badly on imports/backfills.

create type public.balance_delta as (
  user_id   uuid,
  token_id  text,
  available numeric,
  incoming  numeric,
  outgoing  numeric
);

-- Applies summed deltas to `balances`.
--  1. Existing rows are locked in a fixed (user_id, token_id) order, so concurrent
--     statements cannot deadlock on each other.
--  2. Existing rows are changed with a plain UPDATE. (Not INSERT ... ON CONFLICT:
--     CHECK constraints are evaluated on the proposed row before the conflict is
--     detected, so a negative `incoming` delta would be rejected.)
--  3. Missing rows are created only for non-negative deltas. A negative delta for a
--     missing row means its earlier contribution is gone with the row itself - a
--     cascading user delete - and must not re-create it.
create function public.apply_balance_deltas(p_deltas public.balance_delta[])
returns void
language plpgsql
as $$
begin
  if p_deltas is null or cardinality(p_deltas) = 0 then
    return;
  end if;

  perform 1
  from public.balances b
  join unnest(p_deltas) d on d.user_id = b.user_id and d.token_id = b.token_id
  order by b.user_id, b.token_id
  for update of b;

  update public.balances b
  set available  = b.available + d.available,
      incoming   = b.incoming  + d.incoming,
      outgoing   = b.outgoing  + d.outgoing,
      updated_at = now()
  from unnest(p_deltas) d
  where b.user_id = d.user_id and b.token_id = d.token_id;

  insert into public.balances as b (user_id, token_id, available, incoming, outgoing)
  select d.user_id, d.token_id, d.available, d.incoming, d.outgoing
  from unnest(p_deltas) d
  where d.available >= 0 and d.incoming >= 0 and d.outgoing >= 0
    and not exists (select 1 from public.balances x where x.user_id = d.user_id and x.token_id = d.token_id)
  order by d.user_id, d.token_id
  -- Another statement created the row in the meantime: add to it.
  on conflict (user_id, token_id) do update
  set available  = b.available + excluded.available,
      incoming   = b.incoming  + excluded.incoming,
      outgoing   = b.outgoing  + excluded.outgoing,
      updated_at = now();
end
$$;

create function public.transactions_balance_on_insert()
returns trigger
language plpgsql
as $$
begin
  perform public.apply_balance_deltas(array(
    select row(n.user_id, n.token_id, sum(e.available), sum(e.incoming), sum(e.outgoing))::public.balance_delta
    from new_rows n
    cross join lateral public.tx_balance_effect(n.direction, n.status, n.amount) e
    group by n.user_id, n.token_id
  ));
  return null;
end
$$;

-- New contribution minus old contribution. Unrelated updates (tx_hash,
-- submit_attempts, ...) produce zero deltas and touch no balance row.
create function public.transactions_balance_on_update()
returns trigger
language plpgsql
as $$
begin
  perform public.apply_balance_deltas(array(
    select row(x.user_id, x.token_id, sum(x.available), sum(x.incoming), sum(x.outgoing))::public.balance_delta
    from (
      select n.user_id, n.token_id, e.available, e.incoming, e.outgoing
      from new_rows n cross join lateral public.tx_balance_effect(n.direction, n.status, n.amount) e
      union all
      select o.user_id, o.token_id, -e.available, -e.incoming, -e.outgoing
      from old_rows o cross join lateral public.tx_balance_effect(o.direction, o.status, o.amount) e
    ) x
    group by x.user_id, x.token_id
    having sum(x.available) <> 0 or sum(x.incoming) <> 0 or sum(x.outgoing) <> 0
  ));
  return null;
end
$$;

create function public.transactions_balance_on_delete()
returns trigger
language plpgsql
as $$
begin
  perform public.apply_balance_deltas(array(
    select row(o.user_id, o.token_id, -sum(e.available), -sum(e.incoming), -sum(e.outgoing))::public.balance_delta
    from old_rows o
    cross join lateral public.tx_balance_effect(o.direction, o.status, o.amount) e
    group by o.user_id, o.token_id
  ));
  return null;
end
$$;

create trigger transactions_balance_insert
after insert on public.transactions
referencing new table as new_rows
for each statement execute function public.transactions_balance_on_insert();

create trigger transactions_balance_update
after update on public.transactions
referencing old table as old_rows new table as new_rows
for each statement execute function public.transactions_balance_on_update();

create trigger transactions_balance_delete
after delete on public.transactions
referencing old table as old_rows
for each statement execute function public.transactions_balance_on_delete();

-- ---------------------------------------------------------------------------
-- Backfill from the existing ledger
-- ---------------------------------------------------------------------------

insert into public.balances (user_id, token_id, available, incoming, outgoing)
select t.user_id, t.token_id, sum(e.available), sum(e.incoming), sum(e.outgoing)
from public.transactions t
cross join lateral public.tx_balance_effect(t.direction, t.status, t.amount) e
group by t.user_id, t.token_id;

-- ---------------------------------------------------------------------------
-- Read model and write path now use the table
-- ---------------------------------------------------------------------------

create or replace view public.user_balances_api
with (security_invoker = true)
as
select
  b.user_id,
  b.token_id,
  trim_scale(b.available)::text as available,
  trim_scale(b.incoming)::text  as incoming,
  trim_scale(b.outgoing)::text  as outgoing,
  to_jsonb(k) - 'created_at'    as token
from public.balances b
join public.tokens k on k.id = b.token_id;

-- Same contract as before; the balance check is now a PK lookup. Locking the
-- balance row (instead of the user row) serialises withdrawals of the same
-- user and token only, and the trigger updates that same, already locked row.
create or replace function public.create_withdrawal(
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
  v_address   text;
  v_available numeric;
  v_id        uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;

  select address into v_address from public.users where id = p_user_id;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0001';
  end if;

  select available into v_available
  from public.balances
  where user_id = p_user_id and token_id = p_token_id
  for update;

  if coalesce(v_available, 0) < p_amount then
    raise exception 'insufficient_funds' using errcode = 'P0001';
  end if;

  insert into public.transactions (user_id, direction, status, token_id, amount, source_address, destination_address)
  values (p_user_id, 'withdrawal', 'pending', p_token_id, p_amount, v_address, p_destination)
  returning id into v_id;

  return query select * from public.transactions_api where id = v_id;
end
$$;

drop view public.user_balances;

-- ---------------------------------------------------------------------------
-- Consistency check
-- ---------------------------------------------------------------------------

-- Rows where the stored balance differs from a full recomputation from the
-- ledger. Expected to return nothing. O(history): for tests and periodic audits,
-- not for the request path.
create function public.balance_drift()
returns table (
  user_id            uuid,
  token_id           text,
  stored_available   numeric,
  expected_available numeric,
  stored_incoming    numeric,
  expected_incoming  numeric,
  stored_outgoing    numeric,
  expected_outgoing  numeric
)
language sql stable
security definer
set search_path = public
as $$
  with expected as (
    select t.user_id, t.token_id,
           sum(e.available) as available, sum(e.incoming) as incoming, sum(e.outgoing) as outgoing
    from public.transactions t
    cross join lateral public.tx_balance_effect(t.direction, t.status, t.amount) e
    group by t.user_id, t.token_id
  )
  select coalesce(b.user_id, x.user_id), coalesce(b.token_id, x.token_id),
         coalesce(b.available, 0), coalesce(x.available, 0),
         coalesce(b.incoming, 0),  coalesce(x.incoming, 0),
         coalesce(b.outgoing, 0),  coalesce(x.outgoing, 0)
  from public.balances b
  full join expected x on x.user_id = b.user_id and x.token_id = b.token_id
  where coalesce(b.available, 0) <> coalesce(x.available, 0)
     or coalesce(b.incoming, 0)  <> coalesce(x.incoming, 0)
     or coalesce(b.outgoing, 0)  <> coalesce(x.outgoing, 0)
$$;

revoke execute on function public.balance_drift() from public, anon, authenticated;
grant execute on function public.balance_drift() to service_role;
revoke execute on function public.create_withdrawal(uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function public.create_withdrawal(uuid, text, numeric, text) to service_role;

commit;
