-- PROPOSED — NOT APPLIED. Stage 2 pre-launch review draft.
-- Promote by copying into supabase/migrations/ only after approval.
--
-- Probe, reconnection and shared-view identifier confidentiality (Business
-- Rules 3.4, 7.8, 19.23, 24.7). Apply after 20261021130000.
--
--   1. assign_property_ea_branch (20261011090000): returned
--      property_not_found before authorisation (an existence oracle for any
--      property id) and refused, as branch_acts_for_buyer, any branch with
--      an active assignment on the sale that links to this row. Every link
--      writer sets sale.linked_property_id to the same household's onward
--      purchase, and an assignment always represents a row's seller side,
--      so that branch acts for the buyer household's own sale, not for the
--      buyer. The refusal blocked two different selling households from
--      using the same branch and told the seller which branch the buyer's
--      household uses. It is removed: the answer no longer depends on any
--      other row's assignment. Unknown and foreign ids both return
--      not_authorized. Every other check, its order, the directory
--      eligibility rule, signature, owner and grants are unchanged.
--   2. list_reconnectable_ea_properties / reconnect_returning_ea_branch
--      (20261005120000): a branch whose assignment ended because the
--      appointing homeowner was erased could list the property's address and
--      postcode and re-appoint itself without any homeowner. No business rule
--      allows this (7.8: the homeowner appoints the Estate Agent; 24.7: a
--      former branch keeps no identifiable access). Both now fail closed
--      after the existing sign-in and email checks: the list is always empty
--      and reconnect always returns the generic not_reconnectable. Signatures
--      and grants are unchanged so the app degrades to "nothing to
--      reconnect". property_ea_reconnection_events is retained.
--   3. Internal helpers granted to every signed-in user, with no caller
--      check: get_active_ea_branch_invitation (any branch's active invitation
--      for any email, including the invitee name, inviter id and token
--      hash), user_has_ea_branch_membership (whether any user id is an Estate
--      Agent), user_email_has_ea_branch_membership (whether any email is an
--      Estate Agent) and resolve_convertible_searching_placeholder_for_sale
--      (another row's placeholder id and owner). Their only remaining callers
--      are SECURITY DEFINER functions owned by the same owner, so execute
--      moves from authenticated to service_role.
--   4. chain_properties_participant (20260725140000): returned every chain
--      row's created_by_user_id to every chain viewer, which lets a viewer
--      correlate the same Estate Agent or homeowner across chains. The column
--      now shows the caller's own id only (null otherwise). The app reads the
--      view only for the caller's own rows and never reads another row's
--      creator. Every other column, its order and the filter are unchanged.
--
-- No rows are changed. No table grants change.

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
  v_def text;
  v_opts text[];
  v_fn text;
  v_helper regprocedure;
  v_helper_owner oid;
  v_cols text;
begin
  if to_regprocedure('public.assign_property_ea_branch(bigint, uuid, boolean)') is null
     or to_regprocedure('public.list_reconnectable_ea_properties()') is null
     or to_regprocedure('public.reconnect_returning_ea_branch(bigint, uuid)') is null
     or to_regprocedure('public._require_verified_email_for_transaction()') is null
     or to_regprocedure('public.get_active_ea_branch_invitation(uuid, text)') is null
     or to_regprocedure('public.user_has_ea_branch_membership(uuid)') is null
     or to_regprocedure('public.user_email_has_ea_branch_membership(text)') is null
     or to_regprocedure('public.resolve_convertible_searching_placeholder_for_sale(bigint)') is null
     or to_regclass('public.chain_properties_participant') is null
     or to_regclass('public.ea_branch_directory') is null
  then
    raise exception 'probe_reconnect_confidentiality aborted: a required object is missing';
  end if;

  -- 1) assign_property_ea_branch must be the 20261011090000 definition.
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
    raise exception 'probe_reconnect_confidentiality aborted: assign_property_ea_branch signature, definer, search_path or owner differs from 20261011090000';
  end if;

  if v_src not like '%''branch_acts_for_buyer''%'
     or v_src not like '%''property_not_found''%'
     or v_src not like '%from public.ea_branch_directory d%'
     or v_src not like '%and p_homeowner_only_updates is false%'
     or v_src not like '%revocation_reason = ''replaced''%'
  then
    raise exception 'probe_reconnect_confidentiality aborted: assign_property_ea_branch differs from 20261011090000';
  end if;

  perform set_config('moveloop.assign_property_ea_branch_acl', v_acl, false);

  -- 2) Reconnection functions must be the 20261005120000 definitions.
  select p.prosrc into v_src from pg_proc p
  where p.oid = to_regprocedure('public.reconnect_returning_ea_branch(bigint, uuid)');
  if v_src not like '%homeowner_left_cascade%'
     or v_src not like '%insert into public.property_ea_reconnection_events%'
  then
    raise exception 'probe_reconnect_confidentiality aborted: reconnect_returning_ea_branch differs from 20261005120000';
  end if;

  select p.prosrc into v_src from pg_proc p
  where p.oid = to_regprocedure('public.list_reconnectable_ea_properties()');
  if v_src not like '%''address'', p.address%'
     or v_src not like '%homeowner_left_cascade%'
  then
    raise exception 'probe_reconnect_confidentiality aborted: list_reconnectable_ea_properties differs from 20261005120000';
  end if;

  -- 3) Helpers: callable only from SECURITY DEFINER functions with the same
  --    owner. Refuse if a policy, view or SECURITY INVOKER function uses one,
  --    because it would stop working for end users.
  foreach v_fn in array array[
    'get_active_ea_branch_invitation',
    'user_has_ea_branch_membership',
    'user_email_has_ea_branch_membership',
    'resolve_convertible_searching_placeholder_for_sale'
  ] loop
    if exists (
      select 1 from pg_policies pol
      where pol.schemaname = 'public'
        and (coalesce(pol.qual, '') like '%' || v_fn || '(%'
             or coalesce(pol.with_check, '') like '%' || v_fn || '(%')
    ) then
      raise exception 'probe_reconnect_confidentiality aborted: a policy uses %', v_fn;
    end if;

    if exists (
      select 1 from pg_views v
      where v.schemaname = 'public'
        and v.definition like '%' || v_fn || '(%'
    ) then
      raise exception 'probe_reconnect_confidentiality aborted: a view uses %', v_fn;
    end if;

    select p.oid::regprocedure, p.proowner into v_helper, v_helper_owner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_fn;

    if exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname <> v_fn
        and p.prosrc like '%' || v_fn || '(%'
        and (not p.prosecdef or p.proowner <> v_helper_owner)
    ) then
      raise exception 'probe_reconnect_confidentiality aborted: % is called by an invoker function or another owner', v_fn;
    end if;
  end loop;

  -- 4) chain_properties_participant must be the 20260725140000 definition.
  select pg_get_viewdef('public.chain_properties_participant'::regclass), c.reloptions
  into v_def, v_opts
  from pg_class c
  where c.oid = 'public.chain_properties_participant'::regclass;

  select string_agg(a.attname, ',' order by a.attnum) into v_cols
  from pg_attribute a
  where a.attrelid = 'public.chain_properties_participant'::regclass
    and a.attnum > 0
    and not a.attisdropped;

  if v_cols is distinct from 'id,chain_id,chain_position,stage,status,relationship_type,linked_property_id,is_searching,buyer_connected,seller_connected,awaiting_buyer,created_by_user_id,address,postcode,current_user_role,is_own_property,has_members,stage_entered_at'
     or (v_def not like '%p.created_by_user_id,%' and v_def not like '%    created_by_user_id,%')
     or v_def like '%CASE%created_by_user_id%END AS created_by_user_id%'
     or (v_def not like '%is_chain_operational_viewer(p.chain_id)%' and v_def not like '%is_chain_operational_viewer(chain_id)%')
     or not ('security_invoker=false' = any (coalesce(v_opts, array[]::text[])))
  then
    raise exception 'probe_reconnect_confidentiality aborted: chain_properties_participant differs from 20260725140000';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) assign_property_ea_branch: no existence or buyer-branch signal
--    (copied from 20261011090000)
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

  -- Unknown and foreign ids get the same answer (no existence oracle).
  if v_property.id is null
     or not public.is_property_seller_side_homeowner(p_property_id)
  then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if v_property.stage = 'searching' then
    return jsonb_build_object('ok', false, 'error', 'invalid_property');
  end if;

  -- An assignment represents this row's seller side only. Another
  -- household's sale in the chain may use the same branch, and whether it
  -- does is never read here (Business Rules 3.4, 19.23).

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
  'The seller-side homeowner appoints an EA branch to their row (one active branch; an existing different branch is revoked in the same transaction). Estate agents, buyers, participants and plain members cannot appoint. Another household''s sale in the same chain may use the same branch; the answer never depends on other rows'' assignments (Business Rules 3.4, 19.23). Unknown and foreign property ids both return not_authorized. Only a branch listed in ea_branch_directory (Rules 17.15 and 25.16) can be newly appointed or given delegated updates; otherwise branch_not_found. An existing assignment is never revoked or altered for eligibility.';

-- ---------------------------------------------------------------------------
-- 2) Reconnection: fail closed (Business Rules 7.8, 24.7)
-- ---------------------------------------------------------------------------

create or replace function public.reconnect_returning_ea_branch(
  p_property_id bigint,
  p_branch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email_gate jsonb;
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  -- Business Rules 7.8 / 24.7: a former branch cannot re-appoint itself; only
  -- the homeowner appoints an Estate Agent. Same answer for every input.
  return jsonb_build_object('ok', false, 'error', 'not_reconnectable');
end;
$$;

alter function public.reconnect_returning_ea_branch(bigint, uuid) owner to postgres;

comment on function public.reconnect_returning_ea_branch(bigint, uuid) is
  'Disabled (Business Rules 7.8, 24.7): a former branch cannot re-appoint itself; the homeowner appoints the Estate Agent. Always not_reconnectable after the sign-in and email checks. property_ea_reconnection_events is retained for audit.';

revoke all on function public.reconnect_returning_ea_branch(bigint, uuid) from public, anon;
grant execute on function public.reconnect_returning_ea_branch(bigint, uuid) to authenticated;

create or replace function public.list_reconnectable_ea_properties()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email_gate jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  -- Business Rules 24.7: a former branch keeps no address or other
  -- identifiable property information.
  return jsonb_build_object('ok', true, 'properties', '[]'::jsonb);
end;
$$;

alter function public.list_reconnectable_ea_properties() owner to postgres;

comment on function public.list_reconnectable_ea_properties() is
  'Disabled (Business Rules 7.8, 24.7): always an empty list after the sign-in and email checks. A former branch receives no address, postcode or branch-history data.';

revoke all on function public.list_reconnectable_ea_properties() from public, anon;
grant execute on function public.list_reconnectable_ea_properties() to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Internal helpers: no end-user execute
-- ---------------------------------------------------------------------------

revoke all on function public.get_active_ea_branch_invitation(uuid, text) from public, anon, authenticated;
grant execute on function public.get_active_ea_branch_invitation(uuid, text) to service_role;

revoke all on function public.user_has_ea_branch_membership(uuid) from public, anon, authenticated;
grant execute on function public.user_has_ea_branch_membership(uuid) to service_role;

revoke all on function public.user_email_has_ea_branch_membership(text) from public, anon, authenticated;
grant execute on function public.user_email_has_ea_branch_membership(text) to service_role;

revoke all on function public.resolve_convertible_searching_placeholder_for_sale(bigint) from public, anon, authenticated;
grant execute on function public.resolve_convertible_searching_placeholder_for_sale(bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 4) chain_properties_participant: own creator id only
--    (copied from 20260725140000)
-- ---------------------------------------------------------------------------

create or replace view public.chain_properties_participant
with (security_invoker = false)
as
select
  p.id,
  p.chain_id,
  p.chain_position,
  p.stage,
  p.status,
  p.relationship_type,
  p.linked_property_id,
  p.is_searching,
  p.buyer_connected,
  p.seller_connected,
  p.awaiting_buyer,
  case
    when p.created_by_user_id = auth.uid() then p.created_by_user_id
    else null
  end as created_by_user_id,
  case
    when public.is_property_member(p.id) then p.address
    when public.is_ea_assigned_to_property(p.id) then p.address
    else null
  end as address,
  case
    when public.is_property_member(p.id) then p.postcode
    when public.is_ea_assigned_to_property(p.id) then p.postcode
    else null
  end as postcode,
  public.current_user_property_role(p.id) as current_user_role,
  public.is_property_member(p.id) as is_own_property,
  exists (
    select 1
    from public.property_members pm2
    where pm2.property_id = p.id
  ) as has_members,
  p.stage_entered_at
from public.properties p
where
  auth.uid() is not null
  and public.is_chain_operational_viewer(p.chain_id);

comment on view public.chain_properties_participant is
  'Operational chain topology for members and assignment-scoped estate agents; address visible only for own or assigned properties; created_by_user_id only when it is the caller (Business Rules 3.4, 19.23); stage_entered_at exposed for chain intelligence timing.';

revoke all on public.chain_properties_participant from public;
revoke all on public.chain_properties_participant from anon;
grant select on public.chain_properties_participant to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Postflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_src text;
  v_acl text;
  v_owner text;
  v_definer boolean;
  v_config text[];
  v_auth integer;
  v_searching integer;
  v_check integer;
  v_revoke integer;
  v_insert integer;
  v_fn text;
begin
  select
    p.prosrc,
    coalesce(p.proacl::text, ''),
    pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.proconfig
  into v_src, v_acl, v_owner, v_definer, v_config
  from pg_proc p
  where p.oid = to_regprocedure('public.assign_property_ea_branch(bigint, uuid, boolean)');

  if v_owner is distinct from 'postgres'
     or v_definer is distinct from true
     or v_config is distinct from array['search_path=public']
     or v_acl is distinct from current_setting('moveloop.assign_property_ea_branch_acl', true)
  then
    raise exception 'probe_reconnect_confidentiality postflight: assign_property_ea_branch owner, definer, search_path or grants changed';
  end if;

  v_auth := strpos(v_src, 'or not public.is_property_seller_side_homeowner(p_property_id)');
  v_searching := strpos(v_src, 'if v_property.stage = ''searching'' then');
  v_check := strpos(v_src, 'from public.ea_branch_directory d');
  v_revoke := strpos(v_src, 'revocation_reason = ''replaced''');
  v_insert := strpos(v_src, 'insert into public.property_ea_assignments');

  if v_src like '%branch_acts_for_buyer%'
     or v_src like '%property_not_found%'
     or v_src like '%linked_property_id%'
     or v_src like '%spea%'
     or v_auth = 0 or v_searching = 0
     or v_check = 0 or v_revoke = 0 or v_insert = 0
     or not (v_auth < v_searching and v_searching < v_check
             and v_check < v_revoke and v_revoke < v_insert)
  then
    raise exception 'probe_reconnect_confidentiality postflight: assign_property_ea_branch checks missing or out of order';
  end if;

  perform set_config('moveloop.assign_property_ea_branch_acl', '', false);

  foreach v_fn in array array[
    'public.get_active_ea_branch_invitation(uuid, text)',
    'public.user_has_ea_branch_membership(uuid)',
    'public.user_email_has_ea_branch_membership(text)',
    'public.resolve_convertible_searching_placeholder_for_sale(bigint)'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or not has_function_privilege('service_role', v_fn, 'execute')
    then
      raise exception 'probe_reconnect_confidentiality postflight: % grants not as intended', v_fn;
    end if;
  end loop;

  foreach v_fn in array array[
    'public.reconnect_returning_ea_branch(bigint, uuid)',
    'public.list_reconnectable_ea_properties()'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or not has_function_privilege('authenticated', v_fn, 'execute')
    then
      raise exception 'probe_reconnect_confidentiality postflight: % grants changed', v_fn;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.chain_properties_participant', 'select')
     or not has_table_privilege('authenticated', 'public.chain_properties_participant', 'select')
  then
    raise exception 'probe_reconnect_confidentiality postflight: chain_properties_participant grants changed';
  end if;
end;
$$;
