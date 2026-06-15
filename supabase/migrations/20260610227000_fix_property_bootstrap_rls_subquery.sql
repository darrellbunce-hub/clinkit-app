-- Fix B′ bootstrap SELECT: property_members NOT EXISTS was RLS-blind.
--
-- The B′ clause in properties_select_member_or_agent used a subquery on
-- property_members that ran under the caller's RLS (property_members_select_own).
-- Creators could not see peer membership rows, so NOT EXISTS stayed true and
-- onboarding creators retained base-table read on properties others joined.
--
-- Fix: SECURITY DEFINER helper for global membership existence check.
--
-- Prerequisite: 20260610226000_onboarding_bootstrap_rls.sql
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- Helper: property_has_any_member (global; bypasses property_members RLS)
-- ---------------------------------------------------------------------------

create or replace function public.property_has_any_member(
  p_property_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.property_members pm
    where pm.property_id = p_property_id
  );
$$;

comment on function public.property_has_any_member(bigint) is
  'True when any property_members row exists for the property; used by B′ bootstrap SELECT (ignores caller RLS).';

revoke all on function public.property_has_any_member(bigint) from public;
grant execute on function public.property_has_any_member(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: properties — B′ bootstrap SELECT (fixed membership check)
-- ---------------------------------------------------------------------------

drop policy if exists properties_select_member_or_agent
  on public.properties;

create policy properties_select_member_or_agent
  on public.properties
  for select
  to authenticated
  using (
    public.is_property_member(id)
    or public.is_ea_assigned_to_property(id)
    or (
      created_by_user_id = auth.uid()
      and not public.property_has_any_member(id)
    )
  );

comment on policy properties_select_member_or_agent on public.properties is
  'Members and assigned EAs may read properties; creators may read own rows until any membership exists (onboarding bootstrap).';

-- ---------------------------------------------------------------------------
-- Post-apply verification
-- ---------------------------------------------------------------------------

do $$
declare
  v_helper_exists boolean;
  v_policy_qual text;
begin
  select exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'property_has_any_member'
  )
  into v_helper_exists;

  if not v_helper_exists then
    raise exception
      'property_bootstrap_rls_fix failed: property_has_any_member missing';
  end if;

  select qual
  into v_policy_qual
  from pg_policies
  where schemaname = 'public'
    and tablename = 'properties'
    and policyname = 'properties_select_member_or_agent';

  if v_policy_qual is null
    or v_policy_qual not like '%property_has_any_member%'
  then
    raise exception
      'property_bootstrap_rls_fix failed: properties_select_member_or_agent missing property_has_any_member';
  end if;

  raise notice
    'property_bootstrap_rls_fix verified: helper and updated B′ policy present';
end;
$$;

-- ---------------------------------------------------------------------------
-- Rollback plan (manual)
-- ---------------------------------------------------------------------------
-- 1. Restore properties_select_member_or_agent from 20260610226000 (broken B′).
-- 2. DROP FUNCTION public.property_has_any_member(bigint);
