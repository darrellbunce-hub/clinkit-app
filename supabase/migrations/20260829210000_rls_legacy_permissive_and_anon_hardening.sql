-- RLS hardening: drop Dashboard-era permissive policies; revoke anon/public
-- on core tables; enable RLS on service-only tables missing it.
--
-- Context: PostgreSQL OR-combines permissive policies. Legacy
-- USING (true) / WITH CHECK (true) policies (often role public) nullify
-- later scoped PR5 / participant policies.
--
-- Prerequisite: Phase 5 / participant scoped policies must already exist
-- (e.g. properties_select_member_or_agent). This migration aborts if they
-- are missing so Production is never left with zero access policies.
--
-- Idempotent: DROP POLICY IF EXISTS / ENABLE RLS / REVOKE are safe to re-run.
-- See docs/RLS_SECURITY_AUDIT.md.

-- ---------------------------------------------------------------------------
-- 0) Preflight — require scoped policies before removing legacy openers
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text[] := array[]::text[];
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'properties'
      and policyname = 'properties_select_member_or_agent'
  ) then
    v_missing := array_append(v_missing, 'properties_select_member_or_agent');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'activities'
      and policyname = 'activities_select_chain_participant'
  ) then
    v_missing := array_append(v_missing, 'activities_select_chain_participant');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'chains'
      and policyname = 'chains_select_participants'
  ) then
    v_missing := array_append(v_missing, 'chains_select_participants');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'property_members'
      and policyname = 'property_members_select_own'
  ) then
    v_missing := array_append(v_missing, 'property_members_select_own');
  end if;

  if to_regclass('public.chain_nodes') is not null
     and not exists (
       select 1 from pg_policies
       where schemaname = 'public'
         and tablename = 'chain_nodes'
         and policyname = 'chain_nodes_select_participant'
     ) then
    v_missing := array_append(v_missing, 'chain_nodes_select_participant');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception
      'rls_hardening aborted: scoped policies missing (%). Apply Phase 5 / participant RLS migrations before this hardening so legitimate access remains after legacy drops.',
      array_to_string(v_missing, ', ');
  end if;

  raise notice 'rls_hardening preflight: scoped PR5/participant policies present';
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Drop legacy permissive policies (Dashboard / remote_schema era)
-- ---------------------------------------------------------------------------

-- properties
drop policy if exists "Enable read access for all users"
  on public.properties;
drop policy if exists "Allow property inserts"
  on public.properties;
drop policy if exists "Allow property updates"
  on public.properties;
drop policy if exists "Allow updates"
  on public.properties;

-- property_members
drop policy if exists "Allow property member reads"
  on public.property_members;
drop policy if exists "Allow property member inserts"
  on public.property_members;

-- activities
drop policy if exists "Allow activity reads"
  on public.activities;
drop policy if exists "Allow activity inserts"
  on public.activities;

-- chains
drop policy if exists "Allow chain reads"
  on public.chains;
drop policy if exists "Allow chain inserts"
  on public.chains;

-- chain_nodes (only if table exists)
do $$
begin
  if to_regclass('public.chain_nodes') is null then
    raise notice 'rls_hardening: chain_nodes absent — skip chain_nodes legacy drops';
    return;
  end if;

  execute 'drop policy if exists "Authenticated users can view their chain nodes" on public.chain_nodes';
  execute 'drop policy if exists "Authenticated users can insert chain nodes" on public.chain_nodes';
  execute 'drop policy if exists "Allow authenticated users to update own chain nodes" on public.chain_nodes';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Verify legacy names are gone
-- ---------------------------------------------------------------------------

do $$
declare
  v_remaining bigint;
begin
  select count(*)
  into v_remaining
  from pg_policies
  where schemaname = 'public'
    and policyname in (
      'Enable read access for all users',
      'Allow property inserts',
      'Allow property updates',
      'Allow updates',
      'Allow property member reads',
      'Allow property member inserts',
      'Allow activity reads',
      'Allow activity inserts',
      'Allow chain reads',
      'Allow chain inserts',
      'Authenticated users can view their chain nodes',
      'Authenticated users can insert chain nodes',
      'Allow authenticated users to update own chain nodes'
    );

  if v_remaining > 0 then
    raise exception
      'rls_hardening failed: % legacy permissive polic(ies) still present',
      v_remaining;
  end if;

  raise notice 'rls_hardening: legacy permissive policies removed';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Revoke anonymous / PUBLIC table privileges on core tables
--     (policies on role public are insufficient if GRANT remains)
-- ---------------------------------------------------------------------------

revoke all on table public.properties from anon, public;
revoke all on table public.property_members from anon, public;
revoke all on table public.activities from anon, public;
revoke all on table public.chains from anon, public;

do $$
begin
  if to_regclass('public.chain_nodes') is not null then
    execute 'revoke all on table public.chain_nodes from anon, public';
  end if;

  if to_regclass('public.profiles') is not null then
    execute 'revoke all on table public.profiles from anon, public';
  end if;
end;
$$;

-- Reaffirm authenticated DML needed by the app (idempotent).
grant select, insert, update on table public.properties to authenticated;
grant select on table public.property_members to authenticated;
grant select, insert on table public.activities to authenticated;
grant select, insert, update on table public.chains to authenticated;

do $$
begin
  if to_regclass('public.chain_nodes') is not null then
    execute 'grant select, insert, update on table public.chain_nodes to authenticated';
  end if;

  if to_regclass('public.profiles') is not null then
    execute 'grant select, insert, update on table public.profiles to authenticated';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Enable RLS on service-only tables missing it (no policies = deny clients)
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.billing_customer_email_dispatches') is not null then
    execute 'alter table public.billing_customer_email_dispatches enable row level security';
    execute 'revoke all on table public.billing_customer_email_dispatches from anon, authenticated, public';
  end if;

  if to_regclass('public.property_lifecycle_still_active_confirmations') is not null then
    execute 'alter table public.property_lifecycle_still_active_confirmations enable row level security';
    execute 'revoke all on table public.property_lifecycle_still_active_confirmations from anon, authenticated, public';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Advisory: flag any remaining USING/WITH CHECK true policies (do not fail)
-- ---------------------------------------------------------------------------

do $$
declare
  v_open record;
  v_count bigint := 0;
begin
  for v_open in
    select tablename, policyname, cmd, roles, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        qual in ('true', '(true)')
        or with_check in ('true', '(true)')
      )
    order by tablename, policyname
  loop
    v_count := v_count + 1;
    raise warning
      'rls_hardening advisory: open policy %.% (%) roles=% using=% check=%',
      v_open.tablename,
      v_open.policyname,
      v_open.cmd,
      v_open.roles,
      coalesce(v_open.qual, '<null>'),
      coalesce(v_open.with_check, '<null>');
  end loop;

  if v_count = 0 then
    raise notice 'rls_hardening: no remaining USING/WITH CHECK true policies in public schema';
  else
    raise warning
      'rls_hardening: % open true-polic(ies) remain — review manually',
      v_count;
  end if;
end;
$$;
