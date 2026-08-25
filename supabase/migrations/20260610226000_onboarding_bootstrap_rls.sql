-- Onboarding bootstrap RLS: chain creation RPC + property bootstrap SELECT (B′).
--
-- After 20260610225000 removed legacy permissive SELECT policies, PostgREST
-- INSERT … RETURNING on chains fails (no participant yet → chains_select_participants
-- blocks RETURNING). Property inserts fail similarly until ensure_property_membership.
--
-- Architecture:
--   Chains  — create_chain_for_onboarding (SECURITY DEFINER); no creator SELECT policy
--   Properties — extend properties_select_member_or_agent with B′ bootstrap clause
--
-- Prerequisite: 20260610225000_drop_legacy_permissive_rls_policies.sql
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- chains: audit column for onboarding creator (set inside RPC only)
-- ---------------------------------------------------------------------------

alter table public.chains
  add column if not exists created_by_user_id uuid references auth.users (id);

create index if not exists chains_created_by_user_id_idx
  on public.chains (created_by_user_id);

comment on column public.chains.created_by_user_id is
  'User who created the chain during onboarding; set by create_chain_for_onboarding.';

-- ---------------------------------------------------------------------------
-- RPC: create_chain_for_onboarding
-- ---------------------------------------------------------------------------

create or replace function public.create_chain_for_onboarding(
  p_name text,
  p_access_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_chain_id bigint;
  v_name text;
  v_access_code text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_name := nullif(trim(p_name), '');

  if v_name is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_name');
  end if;

  v_access_code := nullif(trim(p_access_code), '');

  if v_access_code is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_access_code');
  end if;

  begin
    insert into public.chains (name, access_code, created_by_user_id)
    values (v_name, v_access_code, v_user_id)
    returning id into v_chain_id;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'duplicate_access_code');
  end;

  return jsonb_build_object(
    'ok', true,
    'chain_id', v_chain_id,
    'access_code', v_access_code
  );
end;
$$;

comment on function public.create_chain_for_onboarding(text, text) is
  'Creates a chain during Start Move onboarding; returns chain_id without client SELECT on empty chain.';

revoke all on function public.create_chain_for_onboarding(text, text) from public;
grant execute on function public.create_chain_for_onboarding(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: properties — B′ bootstrap SELECT (creator until first property_member)
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
      and not exists (
        select 1
        from public.property_members pm
        where pm.property_id = properties.id
      )
    )
  );

comment on policy properties_select_member_or_agent on public.properties is
  'Members and assigned EAs may read properties; creators may read own rows until membership exists (onboarding bootstrap).';

-- ---------------------------------------------------------------------------
-- Post-apply verification
-- ---------------------------------------------------------------------------

do $$
declare
  v_rpc_exists boolean;
  v_policy_qual text;
begin
  select exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_chain_for_onboarding'
  )
  into v_rpc_exists;

  if not v_rpc_exists then
    raise exception 'onboarding_bootstrap_rls failed: create_chain_for_onboarding missing';
  end if;

  select qual
  into v_policy_qual
  from pg_policies
  where schemaname = 'public'
    and tablename = 'properties'
    and policyname = 'properties_select_member_or_agent';

  if v_policy_qual is null
    or v_policy_qual not like '%property_members%'
  then
    raise exception
      'onboarding_bootstrap_rls failed: properties_select_member_or_agent missing B′ clause';
  end if;

  raise notice 'onboarding_bootstrap_rls verified: RPC and B′ property policy present';
end;
$$;

-- ---------------------------------------------------------------------------
-- Rollback plan (manual)
-- ---------------------------------------------------------------------------
-- 1. DROP FUNCTION public.create_chain_for_onboarding(text, text);
-- 2. Restore properties_select_member_or_agent from 20260610220000 (without B′).
-- 3. ALTER TABLE public.chains DROP COLUMN IF EXISTS created_by_user_id;
-- Do NOT re-add legacy permissive SELECT policies.
