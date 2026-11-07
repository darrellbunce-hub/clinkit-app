-- PROPOSED — NOT APPLIED. Stage 2 pre-launch review draft.
-- Promote by copying into supabase/migrations/ only after approval, and only
-- after 20261021100000_start_move_create_property_atomic.sql is applied and
-- the Start Move client that uses it is deployed (see README.md, rollout).
--
-- Fail-closed cleanup_abandoned_onboarding_chain.
--
-- The current definition (20261005100000) deletes a whole chain, its
-- properties, memberships and activities whenever the caller created the
-- chain and nobody else can see it. Foreign keys then cascade the delete into
-- property history: lifecycle states and events, delink events, operational
-- identities, claim metadata and invitations, EA assignments and reconnection
-- events. A homeowner whose chain nobody has joined yet can lose an
-- established sale with one call.
--
-- The replacement only ever deletes a chain that holds nothing: no
-- properties, no chain nodes, and no chain-level history. It never deletes a
-- property, membership, activity or any history row. Derived caches for the
-- chain (refresh queue entry, chain summary) are removed with it.
--
-- p_require_empty is kept so existing callers and grants keep working, but is
-- now ignored: every call behaves as p_require_empty = true did.
--
-- No existing rows are changed by this migration.

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_ref record;
  v_src text;
begin
  if to_regprocedure('public.cleanup_abandoned_onboarding_chain(bigint, boolean)') is null then
    raise exception 'cleanup_fail_closed aborted: cleanup_abandoned_onboarding_chain(bigint, boolean) is missing';
  end if;

  if to_regprocedure('public.cleanup_abandoned_onboarding_chain(bigint)') is not null then
    raise exception 'cleanup_fail_closed aborted: legacy cleanup_abandoned_onboarding_chain(bigint) overload still exists';
  end if;

  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public.cleanup_abandoned_onboarding_chain(bigint, boolean)');

  if v_src not like '%caller_owns_unshared_chain(p_chain_id)%delete from public.properties%' then
    raise exception 'cleanup_fail_closed aborted: current cleanup body differs from 20261005100000';
  end if;

  if to_regclass('public.chains') is null
     or to_regclass('public.properties') is null
     or to_regclass('public.chain_nodes') is null
     or to_regclass('public.chain_completion_events') is null
     or to_regclass('public.operational_delays') is null
     or to_regclass('public.property_delink_events') is null
     or to_regclass('public.property_lifecycle_still_active_confirmations') is null
     or to_regclass('public.email_events') is null
     or to_regclass('public.property_operational_summary') is null
     or to_regclass('public.chain_operational_summary') is null
     or to_regclass('public.chain_operational_refresh_queue') is null
  then
    raise exception 'cleanup_fail_closed aborted: a table checked by the cleanup is missing';
  end if;

  -- Every table with a foreign key to chains must be one the function checks
  -- (or a derived cache it removes). An unknown referencing table could be
  -- cascaded or left orphaned, so refuse to install.
  for v_ref in
    select c.relname as table_name
    from pg_constraint k
    inner join pg_class c on c.oid = k.conrelid
    inner join pg_namespace n on n.oid = c.relnamespace
    where k.contype = 'f'
      and k.confrelid = 'public.chains'::regclass
      and (
        n.nspname <> 'public'
        or c.relname not in (
          'properties',
          'chain_nodes',
          'chain_completion_events',
          'operational_delays',
          'property_delink_events',
          'property_lifecycle_still_active_confirmations',
          'email_events',
          'property_operational_summary',
          'chain_operational_summary',
          'chain_operational_refresh_queue'
        )
      )
  loop
    raise exception 'cleanup_fail_closed aborted: unexpected foreign key to chains from %', v_ref.table_name;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) cleanup_abandoned_onboarding_chain(bigint, boolean)
-- ---------------------------------------------------------------------------

create or replace function public.cleanup_abandoned_onboarding_chain(
  p_chain_id bigint,
  p_require_empty boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_chain public.chains%rowtype;
begin
  v_uid := auth.uid();

  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  -- Locks the chain against a concurrent start_move_create_property call.
  select *
  into v_chain
  from public.chains c
  where c.id = p_chain_id
  for update;

  if v_chain.id is null
     or v_chain.created_by_user_id is distinct from v_uid
  then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if exists (select 1 from public.properties p where p.chain_id = p_chain_id)
     or exists (select 1 from public.chain_nodes n where n.chain_id = p_chain_id)
  then
    return jsonb_build_object('ok', false, 'error', 'chain_not_empty');
  end if;

  if exists (select 1 from public.chain_completion_events e where e.chain_id = p_chain_id)
     or exists (select 1 from public.operational_delays d where d.chain_id = p_chain_id)
     or exists (select 1 from public.property_delink_events e where e.chain_id = p_chain_id)
     or exists (select 1 from public.property_lifecycle_still_active_confirmations c where c.chain_id = p_chain_id)
     or exists (select 1 from public.email_events e where e.chain_id = p_chain_id)
  then
    return jsonb_build_object('ok', false, 'error', 'chain_has_history');
  end if;

  delete from public.chain_operational_refresh_queue
  where chain_id = p_chain_id;

  delete from public.chain_operational_summary
  where chain_id = p_chain_id;

  -- Stale cache rows for properties Join Chain moved out of this chain; the
  -- refresh worker rebuilds them under the property's current chain.
  delete from public.property_operational_summary
  where chain_id = p_chain_id;

  delete from public.chains
  where id = p_chain_id
    and created_by_user_id = v_uid;

  return jsonb_build_object('ok', true, 'empty_chain', true);
end;
$$;

alter function public.cleanup_abandoned_onboarding_chain(bigint, boolean) owner to postgres;

comment on function public.cleanup_abandoned_onboarding_chain(bigint, boolean) is
  'Removes an onboarding chain the caller created only while it holds nothing: no properties or chain nodes (chain_not_empty) and no chain-level history (chain_has_history). Derived caches keyed to the chain are removed with it. Never deletes a property, membership, activity or history row. p_require_empty is accepted for compatibility and ignored: every call is empty-only.';

revoke all on function public.cleanup_abandoned_onboarding_chain(bigint, boolean) from public, anon;
grant execute on function public.cleanup_abandoned_onboarding_chain(bigint, boolean) to authenticated, service_role;
