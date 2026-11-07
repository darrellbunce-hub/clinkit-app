-- Estate Agent appointment: only a directory-eligible branch may be appointed.
--
-- assign_property_ea_branch (20261005120000) accepted any existing branch id.
-- Homeowner search (20261010120000) lists only eligible branches, but a caller
-- supplying a branch id directly could still appoint an internal, smoke-test,
-- development or fixture branch (Rule 17.15) or a branch that is not entitled
-- (Rule 25.16: a branch may establish new Estate Agent relationships only
-- while entitled). Rule 25.37: enforcement must be server-side.
--
-- assign_property_ea_branch now uses ea_branch_directory as the single
-- eligibility rule:
--   - appointing a branch that is not in the directory (new or replacing)
--     returns the existing generic branch_not_found failure before anything is
--     revoked or inserted;
--   - for the branch already assigned, changing delegation is unchanged except
--     that a branch no longer in the directory cannot be given delegated
--     updates (homeowner_only_updates true -> false); keeping or restricting
--     delegation still succeeds.
--
-- Everything else is unchanged: signature, jsonb result, SECURITY DEFINER,
-- search_path, owner, grants and every existing check and its order.
--
-- No rows are changed. Existing assignments are not revoked or altered.
-- Reconnection, Estate Agent property creation and
-- set_property_ea_update_permission are not changed here.

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_src text;
  v_result text;
  v_definer boolean;
  v_config text[];
  v_owner text;
  v_acl text;
  v_viewdef text;
  v_view_options text[];
begin
  if to_regprocedure('public.assign_property_ea_branch(bigint, uuid, boolean)') is null then
    raise exception 'assign_property_ea_branch_directory_eligibility aborted: assign_property_ea_branch(bigint, uuid, boolean) is missing';
  end if;

  select
    p.prosrc,
    pg_catalog.format_type(p.prorettype, null),
    p.prosecdef,
    p.proconfig,
    pg_catalog.pg_get_userbyid(p.proowner),
    coalesce(p.proacl::text, '')
  into v_src, v_result, v_definer, v_config, v_owner, v_acl
  from pg_proc p
  where p.oid = to_regprocedure('public.assign_property_ea_branch(bigint, uuid, boolean)');

  if v_result is distinct from 'jsonb'
     or v_definer is distinct from true
     or v_config is distinct from array['search_path=public']
     or v_owner is distinct from 'postgres'
  then
    raise exception 'assign_property_ea_branch_directory_eligibility aborted: assign_property_ea_branch signature, definer, search_path or owner differs from 20261005120000';
  end if;

  if v_src not like '%''branch_not_found''%'
     or v_src not like '%''branch_acts_for_buyer''%'
     or v_src not like '%public.is_property_seller_side_homeowner(p_property_id)%'
     or v_src not like '%revocation_reason = ''replaced''%'
     or v_src not like '%insert into public.property_ea_assignments%'
     or v_src like '%ea_branch_directory%'
  then
    raise exception 'assign_property_ea_branch_directory_eligibility aborted: assign_property_ea_branch differs from 20261005120000';
  end if;

  if has_function_privilege('anon', 'public.assign_property_ea_branch(bigint, uuid, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.assign_property_ea_branch(bigint, uuid, boolean)', 'execute')
  then
    raise exception 'assign_property_ea_branch_directory_eligibility aborted: assign_property_ea_branch grants differ from 20261005120000';
  end if;

  if to_regclass('public.ea_branch_directory') is null then
    raise exception 'assign_property_ea_branch_directory_eligibility aborted: ea_branch_directory is missing';
  end if;

  select pg_get_viewdef('public.ea_branch_directory'::regclass, true), c.reloptions
  into v_viewdef, v_view_options
  from pg_class c
  where c.oid = 'public.ea_branch_directory'::regclass;

  if v_viewdef not like '%is_ea_branch_commercially_entitled%'
     or v_viewdef not like '%smoke_test_fixture_objects%'
     or not ('security_invoker=false' = any (coalesce(v_view_options, array[]::text[])))
     or not exists (
       select 1
       from pg_attribute a
       where a.attrelid = 'public.ea_branch_directory'::regclass
         and a.attname = 'branch_id'
         and not a.attisdropped
         and a.atttypid = 'uuid'::regtype
     )
  then
    raise exception 'assign_property_ea_branch_directory_eligibility aborted: ea_branch_directory is not the 20261010120000 eligibility view';
  end if;

  perform set_config('moveloop.assign_property_ea_branch_acl', v_acl, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) assign_property_ea_branch: directory eligibility
-- ---------------------------------------------------------------------------

create or replace function public.assign_property_ea_branch(
  p_property_id bigint,
  p_branch_id uuid,
  p_homeowner_only_updates boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_property public.properties%rowtype;
  v_existing public.property_ea_assignments%rowtype;
  v_assignment_id uuid;
  v_branch_selectable boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_branch_id is null
     or not exists (
       select 1
       from public.ea_branches b
       where b.id = p_branch_id
     )
  then
    return jsonb_build_object('ok', false, 'error', 'branch_not_found');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id
  for update;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  if v_property.stage = 'searching' then
    return jsonb_build_object('ok', false, 'error', 'invalid_property');
  end if;

  if not public.is_property_seller_side_homeowner(p_property_id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  -- The branch acting for the buyer's sale cannot also take the seller side.
  if exists (
    select 1
    from public.properties s
    inner join public.property_ea_assignments spea
      on spea.property_id = s.id
    where s.chain_id = v_property.chain_id
      and s.linked_property_id = v_property.id
      and spea.branch_id = p_branch_id
      and spea.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'error', 'branch_acts_for_buyer');
  end if;

  select *
  into v_existing
  from public.property_ea_assignments
  where property_id = p_property_id
    and status = 'active'
  for update;

  -- Rules 17.15 and 25.16: the homeowner directory is the eligibility rule.
  v_branch_selectable := exists (
    select 1
    from public.ea_branch_directory d
    where d.branch_id = p_branch_id
  );

  if v_existing.id is not null
     and v_existing.branch_id = p_branch_id
  then
    -- An ineligible branch keeps its assignment but gains no delegated updates.
    if not v_branch_selectable
       and coalesce(v_existing.homeowner_only_updates, true)
       and p_homeowner_only_updates is false
    then
      return jsonb_build_object('ok', false, 'error', 'branch_not_found');
    end if;

    update public.property_ea_assignments
    set
      homeowner_only_updates = coalesce(
        p_homeowner_only_updates,
        v_existing.homeowner_only_updates
      ),
      updated_at = now()
    where id = v_existing.id;

    return jsonb_build_object(
      'ok', true,
      'assignment_id', v_existing.id,
      'replaced', false
    );
  end if;

  if not v_branch_selectable then
    return jsonb_build_object('ok', false, 'error', 'branch_not_found');
  end if;

  if v_existing.id is not null then
    update public.property_ea_assignments
    set
      status = 'revoked',
      revoked_at = now(),
      revocation_reason = 'replaced',
      updated_at = now()
    where id = v_existing.id;
  end if;

  insert into public.property_ea_assignments (
    property_id,
    branch_id,
    status,
    homeowner_only_updates,
    assigned_by_user_id
  )
  values (
    p_property_id,
    p_branch_id,
    'active',
    coalesce(p_homeowner_only_updates, true),
    v_uid
  )
  returning id into v_assignment_id;

  return jsonb_build_object(
    'ok', true,
    'assignment_id', v_assignment_id,
    'replaced', v_existing.id is not null
  );
end;
$$;

comment on function public.assign_property_ea_branch(bigint, uuid, boolean) is
  'The seller-side homeowner appoints an EA branch to their row (one active branch; an existing different branch is revoked in the same transaction). Estate agents, buyers, participants and plain members cannot appoint. Refuses the branch acting for the buyer''s sale. Only a branch listed in ea_branch_directory (Rules 17.15 and 25.16) can be newly appointed or given delegated updates; otherwise branch_not_found. An existing assignment is never revoked or altered for eligibility.';

-- ---------------------------------------------------------------------------
-- 2) Postflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_src text;
  v_result text;
  v_definer boolean;
  v_config text[];
  v_owner text;
  v_acl text;
  v_check integer;
  v_same_branch integer;
  v_revoke integer;
  v_insert integer;
begin
  select
    p.prosrc,
    pg_catalog.format_type(p.prorettype, null),
    p.prosecdef,
    p.proconfig,
    pg_catalog.pg_get_userbyid(p.proowner),
    coalesce(p.proacl::text, '')
  into v_src, v_result, v_definer, v_config, v_owner, v_acl
  from pg_proc p
  where p.oid = to_regprocedure('public.assign_property_ea_branch(bigint, uuid, boolean)');

  if v_src is null
     or v_result is distinct from 'jsonb'
     or v_definer is distinct from true
     or v_config is distinct from array['search_path=public']
     or v_owner is distinct from 'postgres'
  then
    raise exception 'assign_property_ea_branch_directory_eligibility postflight: signature, definer, search_path or owner changed';
  end if;

  if v_acl is distinct from current_setting('moveloop.assign_property_ea_branch_acl', true) then
    raise exception 'assign_property_ea_branch_directory_eligibility postflight: grants changed';
  end if;

  if has_function_privilege('anon', 'public.assign_property_ea_branch(bigint, uuid, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.assign_property_ea_branch(bigint, uuid, boolean)', 'execute')
  then
    raise exception 'assign_property_ea_branch_directory_eligibility postflight: grants changed';
  end if;

  if v_src not like '%public.is_property_seller_side_homeowner(p_property_id)%'
     or v_src not like '%''branch_acts_for_buyer''%'
     or v_src not like '%''property_not_found''%'
     or v_src not like '%''invalid_property''%'
     or v_src not like '%''not_authenticated''%'
  then
    raise exception 'assign_property_ea_branch_directory_eligibility postflight: an existing check is missing';
  end if;

  v_check := strpos(v_src, 'from public.ea_branch_directory d');
  v_same_branch := strpos(v_src, 'and v_existing.branch_id = p_branch_id');
  v_revoke := strpos(v_src, 'revocation_reason = ''replaced''');
  v_insert := strpos(v_src, 'insert into public.property_ea_assignments');

  if v_check = 0
     or v_same_branch = 0
     or v_revoke = 0
     or v_insert = 0
     or not (v_check < v_same_branch and v_same_branch < v_revoke and v_revoke < v_insert)
     or v_src not like '%if not v_branch_selectable then%return jsonb_build_object(''ok'', false, ''error'', ''branch_not_found'');%revocation_reason = ''replaced''%'
     or v_src not like '%and p_homeowner_only_updates is false%'
  then
    raise exception 'assign_property_ea_branch_directory_eligibility postflight: eligibility check missing or not before revoke and insert';
  end if;

  perform set_config('moveloop.assign_property_ea_branch_acl', '', false);
end;
$$;
