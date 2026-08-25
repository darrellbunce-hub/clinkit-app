-- Platform Security — Development catalog preflight (read-only)
-- Target: Development ONLY — bbbsxzxcjkmpqsfvmhbo
-- Run in Supabase SQL Editor on the Development project.
-- Does NOT modify data.

-- =============================================================================
-- 1. RLS enabled on sensitive tables
-- =============================================================================
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'v')
  and c.relname in (
    'properties',
    'chains',
    'activities',
    'profiles',
    'property_members',
    'ea_companies',
    'ea_branches',
    'ea_branch_members',
    'ea_branch_invitations',
    'email_events',
    'property_lifecycle_events',
    'property_lifecycle_states',
    'property_claim_invitations',
    'property_operational_summary',
    'chain_operational_summary'
  )
order by c.relname;

-- =============================================================================
-- 2. Table privileges (anon / authenticated)
-- =============================================================================
select
  table_name,
  grantee,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.table_privileges
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and table_name in (
    'properties',
    'chains',
    'activities',
    'profiles',
    'property_members',
    'email_events',
    'property_lifecycle_states',
    'property_claim_invitations'
  )
group by table_name, grantee
order by table_name, grantee;

-- =============================================================================
-- 3. RPC EXECUTE grants — audit-critical functions
-- =============================================================================
select
  routine_name as function_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name in (
    'record_property_lifecycle_transition',
    'get_property_lifecycle_signals',
    'report_multiple_operational_homeowners',
    'get_latest_property_claim_invitation',
    'get_active_property_claim_invitation',
    'property_invitation_is_pending',
    'homeowner_has_meaningful_participation',
    'create_email_event',
    'list_recent_email_events',
    'mark_email_event_sent',
    'mark_email_event_failed',
    'preview_ea_branch_invitation'
  )
  and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
order by routine_name, grantee;

-- =============================================================================
-- 3b. SECURITY DEFINER flag
-- =============================================================================
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'record_property_lifecycle_transition',
    'get_property_lifecycle_signals',
    'report_multiple_operational_homeowners',
    'get_latest_property_claim_invitation',
    'get_active_property_claim_invitation',
    'property_invitation_is_pending',
    'homeowner_has_meaningful_participation',
    'create_email_event',
    'list_recent_email_events'
  )
order by p.proname;

-- =============================================================================
-- 4. Policy inventory (sensitive tables)
-- =============================================================================
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual is not null as has_using,
  with_check is not null as has_with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'properties',
    'chains',
    'activities',
    'property_members',
    'email_events'
  )
order by tablename, policyname;

-- =============================================================================
-- 5. email_events hardening spot-check
-- =============================================================================
select
  has_table_privilege('authenticated', 'public.email_events', 'SELECT') as auth_can_select_email_events,
  has_table_privilege('authenticated', 'public.email_events', 'INSERT') as auth_can_insert_email_events,
  has_table_privilege('anon', 'public.email_events', 'SELECT') as anon_can_select_email_events,
  has_function_privilege(
    'authenticated',
    'public.list_recent_email_events(text, integer)',
    'EXECUTE'
  ) as auth_can_execute_list_recent_email_events;
