-- Exact amounts of any precision.
--
-- Amounts were numeric(38, 18): at most 18 decimals and 20 integer digits, while
-- `tokens.decimals` allows up to 36. A token with more than 18 decimals would have
-- been silently rounded on insert (ledger no longer matching the chain), and a
-- huge amount would have failed the insert. Unconstrained `numeric` is exact with
-- arbitrary precision: no rounding, no overflow. Precision is validated in the
-- application against the token's `decimals` instead (withdrawals and incoming
-- Circle transfers alike).
--
-- A column type cannot change while views use it, and functions return those
-- views' row types, so they are dropped and re-created unchanged in one transaction.

begin;

drop function public.create_withdrawal(uuid, text, numeric, text, text);
drop function public.apply_circle_transaction(uuid, public.tx_direction, text, text, text, numeric, text, text, text, text, uuid);
drop function public.fail_withdrawal(uuid, text);
drop view public.user_balances_api;
drop view public.transactions_api;

alter table public.transactions alter column amount type numeric;
alter table public.balances
  alter column available type numeric,
  alter column incoming  type numeric,
  alter column outgoing  type numeric;

-- Re-created unchanged ---------------------------------------------------------

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
from public.balances b
join public.tokens k on k.id = b.token_id;

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

create function public.create_withdrawal(
  p_user_id         uuid,
  p_token_id        text,
  p_amount          numeric,
  p_destination     text,
  p_idempotency_key text default null
)
returns table (replayed boolean, tx public.transactions_api)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replayed  boolean := false;
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

  -- Replay? Checked after taking the lock, so a concurrent first request has committed.
  if p_idempotency_key is not null then
    v_id := public.find_withdrawal_by_key(p_user_id, p_idempotency_key, p_token_id, p_amount, p_destination);
    if v_id is not null then
      return query select true, t from public.transactions_api t where t.id = v_id;
      return;
    end if;
  end if;

  if coalesce(v_available, 0) < p_amount then
    raise exception 'insufficient_funds' using errcode = 'P0001';
  end if;

  begin
    insert into public.transactions (
      user_id, direction, status, token_id, amount, source_address, destination_address, idempotency_key
    ) values (
      p_user_id, 'withdrawal', 'pending', p_token_id, p_amount, v_address, p_destination, p_idempotency_key
    )
    returning id into v_id;
  exception when unique_violation then
    -- Lost a race with a request that used the same key for another token.
    v_id := public.find_withdrawal_by_key(p_user_id, p_idempotency_key, p_token_id, p_amount, p_destination);
    v_replayed := true;
  end;

  return query select v_replayed, t from public.transactions_api t where t.id = v_id;
end
$$;

revoke execute on function public.create_withdrawal(uuid, text, numeric, text, text) from public, anon, authenticated;
revoke execute on function public.apply_circle_transaction(uuid, public.tx_direction, text, text, text, numeric, text, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.fail_withdrawal(uuid, text) from public, anon, authenticated;
grant execute on function public.create_withdrawal(uuid, text, numeric, text, text) to service_role;
grant execute on function public.apply_circle_transaction(uuid, public.tx_direction, text, text, text, numeric, text, text, text, text, uuid) to service_role;
grant execute on function public.fail_withdrawal(uuid, text) to service_role;

commit;
