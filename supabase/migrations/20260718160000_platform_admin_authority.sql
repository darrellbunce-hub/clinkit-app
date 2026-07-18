-- Phase 3B: Keynetic platform administrator authority (separate from EA/homeowner roles).
-- Deny-by-default RLS; only service_role may read/write the allowlist.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by_user_id uuid null references auth.users (id) on delete set null,
  grant_reason_code text not null default 'manual_bootstrap',
  created_at timestamptz not null default now(),

  constraint platform_admins_grant_reason_code_check check (
    grant_reason_code in (
      'manual_bootstrap',
      'privacy_operations',
      'engineering_bootstrap',
      'verification_fixture'
    )
  )
);

comment on table public.platform_admins is
  'Explicit Keynetic platform administrator allowlist. Not estate-agent branch admin.';

create index if not exists platform_admins_granted_at_idx
  on public.platform_admins (granted_at desc);

alter table public.platform_admins enable row level security;

revoke all on table public.platform_admins from public, anon, authenticated;
grant select, insert, update, delete on table public.platform_admins to service_role;

create or replace function public.is_platform_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = p_user_id
  );
$$;

comment on function public.is_platform_admin(uuid) is
  'Returns whether a user is an explicit Keynetic platform administrator. Service role only.';

revoke all on function public.is_platform_admin(uuid) from public, anon, authenticated;
grant execute on function public.is_platform_admin(uuid) to service_role;

-- Exact-match subject lookup for Privacy Admin (no user enumeration).
create or replace function public.lookup_auth_user_id_by_exact_email(p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
begin
  if p_email is null or length(trim(p_email)) = 0 then
    return null;
  end if;

  select u.id
  into v_user_id
  from auth.users u
  where lower(trim(u.email)) = lower(trim(p_email))
  limit 1;

  return v_user_id;
end;
$$;

comment on function public.lookup_auth_user_id_by_exact_email(text) is
  'Privacy Admin exact-match subject lookup. Service role only. Returns null when absent.';

revoke all on function public.lookup_auth_user_id_by_exact_email(text) from public, anon, authenticated;
grant execute on function public.lookup_auth_user_id_by_exact_email(text) to service_role;
