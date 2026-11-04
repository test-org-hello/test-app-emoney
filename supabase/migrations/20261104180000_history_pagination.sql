-- Keyset ("cursor") pagination of the transaction history.
--
-- The API returned only the last 100 transactions. Pages are now addressed by the
-- (created_at, id) of the last row seen: each page is a short index range scan no
-- matter how deep, and new transactions arriving on top do not shift later pages
-- (unlike OFFSET). `id` breaks ties between rows with the same created_at.

begin;

-- Scanned backwards for "newest first"; row comparison on these columns is an index condition.
create index transactions_user_created_id_idx on public.transactions (user_id, created_at, id);
drop index public.transactions_user_created_idx;

-- One page of a user's history, newest first, strictly older than the cursor
-- (p_before_created_at, p_before_id); no cursor = first page. p_limit is a safety cap
-- (1000): the API validates its own limit (<= 200) and asks for one extra row to detect
-- whether a next page exists.
create function public.list_transactions(
  p_user_id           uuid,
  p_limit             integer,
  p_before_created_at timestamptz default null,
  p_before_id         uuid default null
)
returns setof public.transactions_api
language sql
stable
security definer
set search_path = public
as $$
  select t.*
  from public.transactions_api t
  where t.user_id = p_user_id
    and (p_before_created_at is null or (t.created_at, t.id) < (p_before_created_at, p_before_id))
  order by t.created_at desc, t.id desc
  limit least(greatest(p_limit, 1), 1000)
$$;

revoke execute on function public.list_transactions(uuid, integer, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.list_transactions(uuid, integer, timestamptz, uuid) to service_role;

commit;
