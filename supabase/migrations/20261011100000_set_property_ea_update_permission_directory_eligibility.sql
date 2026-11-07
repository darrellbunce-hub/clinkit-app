-- Estate Agent delegation: only a directory-eligible branch may be given
-- delegated updates.
--
-- set_property_ea_update_permission (20261005120000) let the seller-side
-- homeowner set homeowner_only_updates = false for whichever branch is actively
-- assigned. can_operate_property treats that flag as operational write
-- authority for the branch's members, so a branch that is not in
-- ea_branch_directory (an internal, smoke-test, development or fixture branch,
-- Rule 17.15, or one that is not entitled, Rule 25.16) could still be given new
-- authority after appointment. 20261011090000 closed the same route through
-- assign_property_ea_branch; this closes it here. Rule 25.37: enforcement must
-- be server-side.
--
-- set_property_ea_update_permission now:
--   - locks the active assignment before deciding;
--   - refuses to change homeowner-only updates (true or null) to delegated
--     updates (false) for a branch not in ea_branch_directory, with the generic
--     branch_not_found used by assign_property_ea_branch;
--   - still lets the homeowner restrict delegation, and re-confirm delegation
--     the branch already has, whatever the branch's eligibility.
--
-- Everything else is unchanged: signature, jsonb result, SECURITY DEFINER,
-- search_path, owner, grants and every existing check and its order.
--
-- No rows are changed. Existing assignments and delegation are not revoked or
-- altered. can_operate_property, reconnection and Estate Agent property
-- creation are not changed here.

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
  v_assign_src text;
  v_viewdef text;
  v_view_options text[];
begin
  if to_regprocedure('public.set_property_ea_update_permission(bigint, boolean)') is null then
    raise exception 'set_property_ea_update_permission_directory_eligibility aborted: set_property_ea_update_permission(bigint, boolean) is missing';
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
  where p.oid = to_regprocedure('public.set_property_ea_update_permission(bigint, boolean)');

  if v_result is distinct from 'jsonb'
     or v_definer is distinct from true
     or v_config is distinct from array['search_path=public']
     or v_owner is distinct from 'postgres'
  then
    raise exception 'set_property_ea_update_permission_directory_eligibility aborted: set_property_ea_update_permission signature, definer, search_path or owner differs from 20261005120000';
  end if;

  if v_src not like '%''not_authenticated''%'
     or v_src not like '%''invalid_value''%'
     or v_src not like '%public.is_property_seller_side_homeowner(p_property_id)%'
     or v_src not like '%homeowner_only_updates = p_homeowner_only_updates%'
     or v_src not like '%''no_active_assignment''%'
     or v_src like '%ea_branch_directory%'
  then
    raise exception 'set_property_ea_update_permission_directory_eligibility aborted: set_property_ea_update_permission differs from 20261005120000';
  end if;

  if has_function_privilege('anon', 'public.set_property_ea_update_permission(bigint, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_property_ea_update_permission(bigint, boolean)', 'execute')
  then
    raise exception 'set_property_ea_update_permission_directory_eligibility aborted: set_property_ea_update_permission grants differ from 20261005120000';
  end if;

  select p.prosrc
  into v_assign_src
  from pg_proc p
  where p.oid = to_regprocedure('public.assign_property_ea_branch(bigint, uuid, boolean)');

  if v_assign_src is null or v_assign_src not like '%from public.ea_branch_directory d%' then
    raise exception 'set_property_ea_update_permission_directory_eligibility aborted: 20261011090000 (assign_property_ea_branch directory eligibility) is not applied';
  end if;

  if to_regclass('public.ea_branch_directory') is null then
    raise exception 'set_property_ea_update_permission_directory_eligibility aborted: ea_branch_directory is missing';
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
    raise exception 'set_property_ea_update_permission_directory_eligibility aborted: ea_branch_directory is not the 20261010120000 eligibility view';
  end if;

  perform set_config('moveloop.set_property_ea_update_permission_acl', v_acl, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) set_property_ea_update_permission: directory eligibility
-- ---------------------------------------------------------------------------

create or replace function public.set_property_ea_update_permission(
  p_property_id bigint,
  p_homeowner_only_updates boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_homeowner_only_updates is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_value');
  end if;

  if not public.is_property_seller_side_homeowner(p_property_id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  perform 1
  from public.property_ea_assignments pea
  where pea.property_id = p_property_id
    and pea.status = 'active'
  for update;

  -- Rules 17.15 and 25.16: only a branch in the homeowner directory can be
  -- given delegated updates; restricting, or keeping delegation the branch
  -- already has, is always allowed.
  if p_homeowner_only_updates is false
     and exists (
       select 1
       from public.property_ea_assignments pea
       where pea.property_id = p_property_id
         and pea.status = 'active'
         and pea.homeowner_only_updates is distinct from false
         and not exists (
           select 1
           from public.ea_branch_directory d
           where d.branch_id = pea.branch_id
         )
     )
  then
    return jsonb_build_object('ok', false, 'error', 'branch_not_found');
  end if;

  update public.property_ea_assignments
  set
    homeowner_only_updates = p_homeowner_only_updates,
    updated_at = now()
  where property_id = p_property_id
    and status = 'active'
  returning id into v_assignment_id;

  if v_assignment_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_active_assignment');
  end if;

  return jsonb_build_object('ok', true, 'assignment_id', v_assignment_id);
end;
$$;

comment on function public.set_property_ea_update_permission(bigint, boolean) is
  'The seller-side homeowner sets whether their active EA branch may post operational updates (homeowner_only_updates). Delegated updates can be newly given only to a branch listed in ea_branch_directory (Rules 17.15 and 25.16); otherwise branch_not_found. Restricting, or keeping existing delegation, is always allowed; nothing is revoked for eligibility.';

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
  v_authorised integer;
  v_lock integer;
  v_check integer;
  v_update integer;
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
  where p.oid = to_regprocedure('public.set_property_ea_update_permission(bigint, boolean)');

  if v_src is null
     or v_result is distinct from 'jsonb'
     or v_definer is distinct from true
     or v_config is distinct from array['search_path=public']
     or v_owner is distinct from 'postgres'
  then
    raise exception 'set_property_ea_update_permission_directory_eligibility postflight: signature, definer, search_path or owner changed';
  end if;

  if v_acl is distinct from current_setting('moveloop.set_property_ea_update_permission_acl', true) then
    raise exception 'set_property_ea_update_permission_directory_eligibility postflight: grants changed';
  end if;

  if has_function_privilege('anon', 'public.set_property_ea_update_permission(bigint, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_property_ea_update_permission(bigint, boolean)', 'execute')
  then
    raise exception 'set_property_ea_update_permission_directory_eligibility postflight: grants changed';
  end if;

  if v_src not like '%''not_authenticated''%'
     or v_src not like '%''invalid_value''%'
     or v_src not like '%''no_active_assignment''%'
  then
    raise exception 'set_property_ea_update_permission_directory_eligibility postflight: an existing check is missing';
  end if;

  v_authorised := strpos(v_src, 'public.is_property_seller_side_homeowner(p_property_id)');
  v_lock := strpos(v_src, 'for update;');
  v_check := strpos(v_src, 'from public.ea_branch_directory d');
  v_update := strpos(v_src, 'homeowner_only_updates = p_homeowner_only_updates');

  if v_authorised = 0
     or v_lock = 0
     or v_check = 0
     or v_update = 0
     or not (v_authorised < v_lock and v_lock < v_check and v_check < v_update)
     or v_src not like '%if p_homeowner_only_updates is false%pea.homeowner_only_updates is distinct from false%return jsonb_build_object(''ok'', false, ''error'', ''branch_not_found'');%'
  then
    raise exception 'set_property_ea_update_permission_directory_eligibility postflight: eligibility check missing or not between authorisation and update';
  end if;

  perform set_config('moveloop.set_property_ea_update_permission_acl', '', false);
end;
$$;
