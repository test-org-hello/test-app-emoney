-- Ledger immutability.
--
-- Before: anon/authenticated were blocked only by RLS (which does not cover
-- TRUNCATE), and service_role - the backend, or anyone holding its key - could
-- UPDATE/DELETE any ledger row; the balance triggers would then faithfully
-- reflect a rewritten history. Now the database itself enforces:
--   * transactions: facts are immutable (amount, direction, user, token,
--     addresses, created_at, idempotency key); a row only moves forward through
--     its lifecycle (pending -> completed | failed), a final row is frozen;
--     no DELETE except together with its user (cascade); no TRUNCATE;
--   * balances: written only by the ledger triggers, never directly;
--   * anon/authenticated: no privileges at all on money tables and read models.
-- Not covered: a database superuser can disable triggers - that is a matter of
-- access control and audit, not of the schema.

begin;

-- ---------------------------------------------------------------------------
-- Privileges: the public API keys get nothing (RLS alone does not cover TRUNCATE)
-- ---------------------------------------------------------------------------

revoke all on table
  public.transactions, public.balances, public.users, public.tokens,
  public.webhook_events, public.app_settings,
  public.transactions_api, public.user_balances_api
from anon, authenticated;

-- Objects created later by migrations (run as postgres) do not get them back either.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

-- Nobody truncates the ledger, not even the backend.
revoke truncate on table public.transactions, public.balances from service_role;

-- ---------------------------------------------------------------------------
-- transactions: append + forward-only lifecycle
-- ---------------------------------------------------------------------------

create function public.transactions_guard_update()
returns trigger
language plpgsql
as $$
begin
  -- Facts of the operation never change.
  if new.id <> old.id
     or new.user_id <> old.user_id
     or new.direction <> old.direction
     or new.token_id <> old.token_id
     or new.amount <> old.amount
     or new.created_at <> old.created_at
     or new.source_address is distinct from old.source_address
     or new.destination_address is distinct from old.destination_address
     or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'ledger_immutable: transaction % facts cannot be changed', old.id
      using errcode = 'P0001';
  end if;

  -- The Circle transaction id is set once (a withdrawal learns it after submission).
  if old.circle_tx_id is not null and new.circle_tx_id is distinct from old.circle_tx_id then
    raise exception 'ledger_immutable: transaction % is already linked to a Circle transaction', old.id
      using errcode = 'P0001';
  end if;

  -- A final transaction is frozen; only bookkeeping columns may be touched.
  if old.status <> 'pending'
     and (new.status <> old.status
          or new.circle_state is distinct from old.circle_state
          or new.circle_tx_id is distinct from old.circle_tx_id
          or new.tx_hash is distinct from old.tx_hash
          or new.error_reason is distinct from old.error_reason) then
    raise exception 'ledger_immutable: transaction % is final (%)', old.id, old.status
      using errcode = 'P0001';
  end if;

  return new;
end
$$;

-- Deleting ledger rows is allowed only as part of deleting their user (FK cascade):
-- by then the user row is already gone in this transaction.
create function public.transactions_guard_delete()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.users where id = old.user_id) then
    raise exception 'ledger_immutable: transaction % cannot be deleted', old.id
      using errcode = 'P0001';
  end if;
  return old;
end
$$;

create function public.ledger_guard_truncate()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ledger_immutable: % cannot be truncated', tg_table_name using errcode = 'P0001';
end
$$;

create trigger transactions_guard_update
before update on public.transactions
for each row execute function public.transactions_guard_update();

create trigger transactions_guard_delete
before delete on public.transactions
for each row execute function public.transactions_guard_delete();

create trigger transactions_guard_truncate
before truncate on public.transactions
for each statement execute function public.ledger_guard_truncate();

-- ---------------------------------------------------------------------------
-- balances: only the ledger triggers write it
-- ---------------------------------------------------------------------------

-- pg_trigger_depth() = 1 means this guard fired for a statement issued directly
-- against `balances`. Writes made by the transactions_balance_* triggers, and the
-- FK cascade from a deleted user, run nested (depth >= 2).
create function public.balances_guard_write()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() <= 1 then
    raise exception 'ledger_immutable: balances are derived from transactions and cannot be written directly'
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end
$$;

create trigger balances_guard_write
before insert or update or delete on public.balances
for each row execute function public.balances_guard_write();

create trigger balances_guard_truncate
before truncate on public.balances
for each statement execute function public.ledger_guard_truncate();

commit;
