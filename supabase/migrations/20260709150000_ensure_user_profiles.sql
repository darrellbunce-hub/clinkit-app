-- Guarantee every auth.users row has a matching public.profiles row.
-- Inserts homeowner defaults only when missing; never overwrites existing profiles.

-- ---------------------------------------------------------------------------
-- RPC: ensure_user_profile
-- Callable by authenticated users for their own row only.
-- ---------------------------------------------------------------------------

create or replace function public.ensure_user_profile()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_existed_before boolean;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
  )
  into v_existed_before;

  if v_existed_before then
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'account_type', (
        select p.account_type
        from public.profiles p
        where p.id = v_user_id
      )
    );
  end if;

  insert into public.profiles (
    id,
    role,
    account_type
  )
  values (
    v_user_id,
    'homeowner',
    'homeowner'
  )
  on conflict (id) do nothing;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'profile_create_failed');
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', true,
    'account_type', 'homeowner'
  );
end;
$$;

comment on function public.ensure_user_profile() is
  'Idempotently ensures the authenticated user has a profiles row. Inserts homeowner defaults only when missing.';

revoke all on function public.ensure_user_profile() from public;
grant execute on function public.ensure_user_profile() to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: create homeowner profiles for auth users without any profile row.
-- Idempotent — safe to run multiple times; never updates existing rows.
-- ---------------------------------------------------------------------------

insert into public.profiles (
  id,
  role,
  account_type
)
select
  u.id,
  'homeowner',
  'homeowner'
from auth.users u
where not exists (
  select 1
  from public.profiles p
  where p.id = u.id
)
on conflict (id) do nothing;
