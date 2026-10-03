-- M3: operational authority enforcement and address reservation enforcement.
--
-- Operational writes require operational authority, never plain membership.
--   can_operate_property(bigint)  (M2) is the single row-level rule:
--     the seller-side homeowner; their actively assigned EA branch while
--     homeowner_only_updates is false; the assigned EA branch on a row with no
--     seller-side homeowner (EA-only). Searching placeholders are excluded.
--   A Buyer Ready node is operated by its owner (chain_nodes.user_id) only.
--   Buyers, connected participants, viewers and plain property_members rows
--   never authorise an operational write.
--
--   can_operate_in_chain(bigint)                      (new predicate)
--     Caller can operate a property in the chain, or owns its Buyer Ready node.
--   owns_chain_node(bigint)                           (new predicate)
--   caller_may_place_property_in_chain(bigint)        [20261001120000]
--     Chain creator, or an active identity / counterparty / Buyer Ready owner
--     in the chain. Plain membership no longer qualifies.
--   _trg_properties_guard_direct_writes()             [20261001120000]
--     chain_id moves use caller_may_place_property_in_chain.
--   Policies replaced:
--     properties_update_member                  -> properties_update_operator
--     activities_insert_participant             -> activities_insert_operator
--     chain_nodes_insert_participant            -> chain_nodes_insert_owner
--     chain_nodes_update_participant            -> chain_nodes_update_owner
--     chains_update_participants                -> chains_update_operator
--     chain_completion_events_insert_participants
--                                               -> chain_completion_events_insert_operator
--     property_ea_assignments_insert_homeowner  (dropped; RPC only)
--     property_ea_assignments_update_homeowner  (dropped; RPC only)
--   RPCs re-authorised:
--     break_chain_connection                    [20261001120000]
--     report_operational_delay                  [20260820200000]
--     resolve_operational_delay                 [20260820200000]
--     link_sale_to_searching_placeholder        [20261005110000]
--     establish_connected_hop                   [20260831200000]
--     upsert_operational_summaries              (live definition)
--   RPCs added:
--     assign_property_ea_branch(bigint, uuid, boolean)
--       Seller-side homeowner only. Refuses the branch acting for the sale that
--       links to this row (the buyer's EA never takes the seller side).
--     set_property_ea_update_permission(bigint, boolean)
--
-- Address reservation (uses the M1 classifier):
--   _address_reservation_conflict(text, text, bigint)   (new, service_role)
--     Takes a transaction advisory lock on the normalised address + postcode,
--     then reports whether another row reserves that address.
--   trg_properties_address_reservation                  (new trigger)
--     BEFORE INSERT / UPDATE OF address, postcode, linked_property_id, chain_id
--     on properties, every role. Refuses (23505 property_address_reserved) when
--     another row reserves the address, or when the row links to a stale
--     same-chain purchase whose address another row reserves. Rows without an
--     address key and key-preserving edits pass.
--   establish_operational_homeowner_for_created_property [20261001120000]
--     A new row only reserves once its identity is granted, so the grant takes
--     the same lock and refuses (address_reserved) if another row reserves it.
--   _create_ea_operational_property_core               [20261005110000]
--     Duplicate check is global (reservation) as well as same-chain.
--   _establish_operational_homeowner_core              [20261001130000]
--   _grant_counterparty_participation_core             [20261005110000]
--     Archived / released / anonymised rows are refused (property_released).
--     An identity grant on a stale row re-checks the reservation
--     (address_reserved); a sale's stale onward purchase whose address another
--     row now reserves is unlinked instead of re-reserved.
--   _execute_participation_delink                      [20261005100000]
--     Locks the property row (FOR UPDATE) first. Each operation removes only
--     the departing authority:
--       homeowner_self on a sale with an assigned EA: the homeowner identity,
--         membership and delegates go; the EA, counterparties, connected
--         flags and links stay; the claim becomes unclaimed (any origin).
--       homeowner_self / estate_agent_remove_branch by the last seller-side
--         representative: released at once only for a mistake reason
--         (wrong_property, added_by_mistake, duplicate_property) when nothing
--         depends on the row; otherwise the row stays in the chain as an
--         unrepresented placeholder (counterparties, links, flags and valid
--         invitations kept).
--       homeowner_self on a purchase (the buyer leaving): the leaver's own
--         sale is unlinked; released at once only with no seller side, no
--         dependants, no open invitation and no counterparty.
--       homeowner_remove_ea: seller-side homeowner only (a buyer on a
--         purchase cannot remove the seller's EA).
--       estate_agent_remove_homeowner: decided by
--         _ea_homeowner_withdrawal_status (current authority, not origin).
--     Every EA revocation records property_ea_assignments.revocation_reason.
--   _ea_homeowner_withdrawal_status(bigint)           (new, service_role)
--     Whether the assigned EA may withdraw the homeowner association of a
--     sale: an open claim with an invitation, or an identity that came from
--     the claim / invitation process (or an EA-originated row) without
--     meaningful participation. A homeowner who created the transaction is
--     never withdrawable; purchase rows are refused (their identity holder is
--     the buyer, never the seller side).
--   get_participation_delink_options                   [20260714170000]
--     Offers exactly what _execute_participation_delink allows:
--     homeowner_remove_ea to the seller-side homeowner only;
--     estate_agent_remove_homeowner by _ea_homeowner_withdrawal_status.
--   _property_placeholder_has_dependants(bigint, bigint) (new, service_role)
--   property_ea_assignments.revocation_reason          (new column)
--   reconnect_returning_ea_branch(bigint, uuid)        (new RPC)
--     A branch whose assignment ended through the homeowner-leave cascade
--     (homeowner_left_cascade) may reconnect to the unreleased, unrepresented
--     row when no other branch has been assigned since. Verified, branch
--     member, rate limited, audited (property_ea_reconnection_events).
--   list_reconnectable_ea_properties()                 (new RPC, read-only)
--     The caller's own branches' rows that reconnect_returning_ea_branch
--     would currently accept. No input, no writes, grants nothing; the RPC
--     re-checks every condition under lock.
--   _gdpr_remove_subject_property_links                [20260718130000]
--     Tags the EA revocations it makes (homeowner_left_cascade /
--     branch_member_erased). Otherwise unchanged.
--   claim_operational_property                         [20261001130000]
--   discover_claimable_properties                      [20260712120000]
--   update_property_claim_invite_email                 [20260706000000]
--     An unclaimed row is claimable / invitable when it is EA-originated, has
--     an active EA assignment, or (claim only) holds a valid invitation, so a
--     homeowner-created row handed to its EA can be claimed by a replacement
--     homeowner. Archived, released and anonymised rows are not listed.
--   is_allowed_structured_activity_update              [20260910210000]
--     Allows the fixed onward-purchase unlink notice and the delink /
--     reconnection notices above.
--   properties_address_match_key_idx                     (new index)
--
-- Requires: 20261005110000_seller_side_authority_and_awaiting_connection.sql.

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text[] := array[]::text[];
  v_name text;
  v_src text;
  v_check record;
begin
  foreach v_name in array array[
    'auth.uid()',
    'public.can_operate_property(bigint)',
    'public.is_property_seller_side_homeowner(bigint)',
    'public.get_property_operational_owner_user_id(bigint)',
    'public.property_in_caller_accessible_chain(bigint, bigint)',
    'public.caller_owns_unshared_chain(bigint)',
    'public.is_valid_operational_delay_reason(text)',
    'public._rate_limit_try_consume(text, text, integer, integer)',
    'public._address_match_key(text)',
    'public._postcode_match_key(text)',
    'public.property_address_is_reserved(bigint)',
    'public._establish_operational_homeowner_core(bigint, uuid, text, boolean)',
    'public._require_verified_email_for_transaction()',
    'public._is_estate_agent_account(uuid)',
    'public._ea_assign_originated_property(bigint, uuid, boolean, text, text, text)',
    'public.is_ea_branch_member(uuid)',
    'public._property_reservation_state(bigint)',
    'public._property_side_representation(bigint)',
    'public._upsert_property_membership_row(bigint, uuid, text)',
    'public._sync_property_claim_on_homeowner_grant(bigint, uuid)',
    'public._converge_onward_purchase_after_seller_join(bigint, uuid)',
    'public._insert_participation_delink_activity(bigint, text, text)',
    'public._revoke_open_property_claim_invitations(bigint)',
    'public.record_property_lifecycle_transition(bigint, text, text, text, text, jsonb)',
    'public.get_auth_user_email()',
    'public.get_active_property_claim_invitation(bigint)',
    'public._notify_chain_participants_of_delink(bigint, bigint, text)',
    'public._release_converged_onward_purchase_with_sale(bigint, uuid, text)',
    'public._converge_onward_purchase_after_claim(bigint, uuid)',
    'public.establish_operational_homeowner(bigint, text)',
    'public.is_ea_assigned_to_property(bigint)',
    'public.is_valid_participation_delink_reason_code(text, text)',
    'public.property_invitation_is_pending(bigint)',
    'public.homeowner_has_meaningful_participation(bigint)',
    'public._rate_limit_is_blocked(text, text, integer, integer)',
    'public._rate_limit_record_attempt(text, text, integer)',
    'public.hash_invitation_token(text)',
    'public._gdpr_shared_transaction_safety_block(uuid, bigint, text)',
    'public._gdpr_erasure_audit(uuid, text, jsonb)'
  ]
  loop
    if to_regprocedure(v_name) is null then
      v_missing := array_append(v_missing, v_name);
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception
      'operational_authority aborted: missing dependencies (%)',
      array_to_string(v_missing, ', ');
  end if;

  for v_check in
    select *
    from (values
      ('public.caller_may_place_property_in_chain(bigint)', '%public.is_chain_participant(p_chain_id)%'),
      ('public._trg_properties_guard_direct_writes()', '%not public.is_chain_participant(new.chain_id)%'),
      ('public.break_chain_connection(bigint, text)', '%public.is_ea_delegated_editor_on_property(v_property.id)%'),
      ('public.report_operational_delay(text, bigint, bigint, text)', '%public.is_chain_participant(v_node.chain_id)%'),
      ('public.resolve_operational_delay(bigint, text)', '%public.is_chain_participant(v_delay.chain_id)%'),
      ('public.link_sale_to_searching_placeholder(bigint, bigint)', '%v_sale_owner is null%'),
      ('public.establish_connected_hop(bigint)', '%public.is_property_operational_participant(v_purchase.id)%'),
      ('public.upsert_operational_summaries(jsonb, jsonb)', '%public.is_chain_operational_viewer(v_chain_id)%'),
      ('public.establish_operational_homeowner_for_created_property(bigint)', '%public.caller_may_place_property_in_chain(p.chain_id)%'),
      ('public._create_ea_operational_property_core(bigint, text, text, text, uuid, boolean, text, text, boolean)', '%and p.address = v_address%'),
      ('public._establish_operational_homeowner_core(bigint, uuid, text, boolean)', '%where id = p_property_id;%operational_homeowner_exists%'),
      ('public._grant_counterparty_participation_core(bigint, uuid)', '%opposite_side_unrepresented%'),
      ('public._execute_participation_delink(bigint, text, text, uuid)', '%participation_delink_lifecycle_transition_failed%Estate agent branch released operational management of this property.%'),
      ('public.is_allowed_structured_activity_update(text)', '%Property released for future transactions. Historic chain data retained.%'),
      ('public.discover_claimable_properties()', '%pcm.claim_status in (''unclaimed'', ''claim_invited'')%invitation_rejected_by_user_id%'),
      ('public.resolve_claim_invitation_token(text)', '%invitation_revoked_at is not null%invitation_expires_at <= now()%email_mismatch%'),
      ('public.claim_operational_property(bigint, text)', '%pcm.origin_type = ''estate_agent''%not_claimable%_converge_onward_purchase_after_claim%'),
      ('public.update_property_claim_invite_email(bigint, text)', '%v_metadata.origin_type <> ''estate_agent''%'),
      ('public.get_participation_delink_options(bigint)', '%homeowner_remove_ea%estate_agent_remove_branch%pcm.origin_type = ''estate_agent''%estate_agent_remove_homeowner%'),
      ('public._gdpr_remove_subject_property_links(uuid, bigint, uuid)', '%pea.assigned_by_user_id = p_subject_user_id%gdpr_rtbf_not_participation_delink%')
    ) as t(signature, fingerprint)
  loop
    if to_regprocedure(v_check.signature) is null then
      raise exception 'operational_authority aborted: % missing', v_check.signature;
    end if;

    select p.prosrc into v_src
    from pg_proc p
    where p.oid = to_regprocedure(v_check.signature);

    if v_src not like v_check.fingerprint then
      raise exception
        'operational_authority aborted: % body differs from the expected source',
        v_check.signature;
    end if;
  end loop;

  for v_check in
    select *
    from (values
      ('properties', 'properties_update_member'),
      ('activities', 'activities_insert_participant'),
      ('chain_nodes', 'chain_nodes_insert_participant'),
      ('chain_nodes', 'chain_nodes_update_participant'),
      ('chains', 'chains_update_participants'),
      ('chain_completion_events', 'chain_completion_events_insert_participants'),
      ('property_ea_assignments', 'property_ea_assignments_insert_homeowner'),
      ('property_ea_assignments', 'property_ea_assignments_update_homeowner')
    ) as t(table_name, policy_name)
  loop
    if not exists (
      select 1
      from pg_policies pol
      where pol.schemaname = 'public'
        and pol.tablename = v_check.table_name
        and pol.policyname = v_check.policy_name
    ) then
      raise exception
        'operational_authority aborted: policy %.% missing',
        v_check.table_name,
        v_check.policy_name;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Predicates
-- ---------------------------------------------------------------------------

create or replace function public.can_operate_in_chain(p_chain_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and p_chain_id is not null
    and (
      exists (
        select 1
        from public.properties p
        where p.chain_id = p_chain_id
          and public.can_operate_property(p.id)
      )
      or exists (
        select 1
        from public.chain_nodes cn
        where cn.chain_id = p_chain_id
          and cn.node_type = 'buyer_ready'
          and cn.user_id = auth.uid()
      )
    );
$$;

alter function public.can_operate_in_chain(bigint) owner to postgres;

comment on function public.can_operate_in_chain(bigint) is
  'True when the caller can operate a property in the chain (can_operate_property) or owns the chain''s Buyer Ready node. Gates chain-level writes: completion dates, completion events, operational summaries.';

revoke all on function public.can_operate_in_chain(bigint) from public, anon;
grant execute on function public.can_operate_in_chain(bigint) to authenticated, service_role;

create or replace function public.owns_chain_node(p_chain_node_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.chain_nodes cn
      where cn.id = p_chain_node_id
        and cn.user_id = auth.uid()
    );
$$;

alter function public.owns_chain_node(bigint) owner to postgres;

comment on function public.owns_chain_node(bigint) is
  'True when the caller owns the chain node (chain_nodes.user_id). Buyer Ready nodes are operated by their owner only.';

revoke all on function public.owns_chain_node(bigint) from public, anon;
grant execute on function public.owns_chain_node(bigint) to authenticated, service_role;

create or replace function public.caller_may_place_property_in_chain(
  p_chain_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and p_chain_id is not null
    and (
      exists (
        select 1
        from public.chains c
        where c.id = p_chain_id
          and c.created_by_user_id = auth.uid()
      )
      or exists (
        select 1
        from public.properties p
        inner join public.property_operational_identities poi
          on poi.property_id = p.id
          and poi.status = 'active'
          and poi.homeowner_user_id = auth.uid()
        where p.chain_id = p_chain_id
      )
      or exists (
        select 1
        from public.properties p
        inner join public.property_counterparty_participants cp
          on cp.property_id = p.id
          and cp.status = 'active'
          and cp.user_id = auth.uid()
        where p.chain_id = p_chain_id
      )
      or exists (
        select 1
        from public.chain_nodes cn
        where cn.chain_id = p_chain_id
          and cn.node_type = 'buyer_ready'
          and cn.user_id = auth.uid()
      )
    );
$$;

comment on function public.caller_may_place_property_in_chain(bigint) is
  'True when the caller created the chain or holds an active role in it (operational identity, counterparty participant, Buyer Ready owner). Plain membership does not qualify. Gates placing the caller''s own rows: direct property inserts, chain_id moves, linked_property_id targets, Buyer Ready node inserts, establish_operational_homeowner_for_created_property. Estate agents place properties only through SECURITY DEFINER RPCs.';

-- ---------------------------------------------------------------------------
-- 2) properties direct-write guard: chain moves use the placement rule
-- ---------------------------------------------------------------------------

create or replace function public._trg_properties_guard_direct_writes()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid;
begin
  if current_user = 'anon' then
    raise exception 'properties_direct_write_not_authenticated'
      using errcode = '42501';
  end if;

  if current_user <> 'authenticated' then
    return new;
  end if;

  v_uid := auth.uid();

  if v_uid is null then
    raise exception 'properties_direct_write_not_authenticated'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.created_by_user_id is distinct from v_uid then
      raise exception 'properties_insert_creator_mismatch'
        using errcode = '42501';
    end if;

    if not public.caller_may_place_property_in_chain(new.chain_id) then
      raise exception 'properties_insert_chain_not_authorised'
        using errcode = '42501';
    end if;

    if new.linked_property_id is not null
       and not public.property_in_caller_accessible_chain(
         new.linked_property_id,
         new.chain_id
       )
    then
      raise exception 'properties_linked_property_not_in_chain'
        using errcode = '42501';
    end if;

    return new;
  end if;

  if new.created_by_user_id is distinct from old.created_by_user_id then
    raise exception 'properties_created_by_immutable'
      using errcode = '42501';
  end if;

  if new.chain_id is distinct from old.chain_id then
    if new.chain_id is null
       or old.created_by_user_id is distinct from v_uid
       or not public.caller_owns_unshared_chain(old.chain_id)
       or not public.caller_may_place_property_in_chain(new.chain_id)
    then
      raise exception 'properties_chain_move_not_authorised'
        using errcode = '42501';
    end if;
  end if;

  if new.linked_property_id is not null
     and (
       new.linked_property_id is distinct from old.linked_property_id
       or new.chain_id is distinct from old.chain_id
     )
     and not public.property_in_caller_accessible_chain(
       new.linked_property_id,
       new.chain_id
     )
  then
    raise exception 'properties_linked_property_not_in_chain'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Table policies
-- ---------------------------------------------------------------------------

-- properties: operator of the row; the owner of a searching placeholder may
-- move it (Join Chain migration). The placeholder arm cannot leave 'searching'.
drop policy if exists properties_update_member on public.properties;
drop policy if exists properties_update_operator on public.properties;

create policy properties_update_operator
  on public.properties
  for update
  to authenticated
  using (
    public.can_operate_property(id)
    or (
      stage = 'searching'
      and public.get_property_operational_owner_user_id(id) = auth.uid()
    )
  )
  with check (
    public.can_operate_property(id)
    or (
      stage = 'searching'
      and public.get_property_operational_owner_user_id(id) = auth.uid()
    )
  );

drop policy if exists activities_insert_participant on public.activities;
drop policy if exists activities_insert_operator on public.activities;

create policy activities_insert_operator
  on public.activities
  for insert
  to authenticated
  with check (
    (
      property_id is not null
      and chain_node_id is null
      and public.can_operate_property(property_id)
    )
    or (
      chain_node_id is not null
      and property_id is null
      and public.owns_chain_node(chain_node_id)
    )
  );

drop policy if exists chain_nodes_insert_participant on public.chain_nodes;
drop policy if exists chain_nodes_insert_owner on public.chain_nodes;

create policy chain_nodes_insert_owner
  on public.chain_nodes
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and node_type = 'buyer_ready'
    and public.caller_may_place_property_in_chain(chain_id)
    and (
      linked_property_id is null
      or public.property_in_caller_accessible_chain(linked_property_id, chain_id)
    )
  );

drop policy if exists chain_nodes_update_participant on public.chain_nodes;
drop policy if exists chain_nodes_update_owner on public.chain_nodes;

create policy chain_nodes_update_owner
  on public.chain_nodes
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and public.caller_may_place_property_in_chain(chain_id)
    and (
      linked_property_id is null
      or public.property_in_caller_accessible_chain(linked_property_id, chain_id)
    )
  );

drop policy if exists chains_update_participants on public.chains;
drop policy if exists chains_update_operator on public.chains;

create policy chains_update_operator
  on public.chains
  for update
  to authenticated
  using (public.can_operate_in_chain(id))
  with check (public.can_operate_in_chain(id));

drop policy if exists chain_completion_events_insert_participants on public.chain_completion_events;
drop policy if exists chain_completion_events_insert_operator on public.chain_completion_events;

create policy chain_completion_events_insert_operator
  on public.chain_completion_events
  for insert
  to authenticated
  with check (
    actor_user_id = auth.uid()
    and public.can_operate_in_chain(chain_id)
  );

-- property_ea_assignments: client writes only through the RPCs in section 5.
drop policy if exists property_ea_assignments_insert_homeowner on public.property_ea_assignments;
drop policy if exists property_ea_assignments_update_homeowner on public.property_ea_assignments;

revoke insert, update, delete on public.property_ea_assignments from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) RPCs: operational authority replaces membership
-- ---------------------------------------------------------------------------

create or replace function public.break_chain_connection(
  p_property_id bigint,
  p_break_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property public.properties%rowtype;
  v_upstream_id bigint;
  v_inbound public.properties%rowtype;
  v_update_message text;
  v_updated_by text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  if not public.can_operate_property(v_property.id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  select case
    when p.account_type = 'estate_agent' then 'estate_agent'
    else 'homeowner'
  end
  into v_updated_by
  from public.profiles p
  where p.id = auth.uid();

  v_updated_by := coalesce(v_updated_by, 'homeowner');

  v_update_message := case
    when p_break_reason = 'buyer_side'
      then 'Chain Connection Broken - Buyer Side'
    else 'Chain Connection Broken - Seller Side'
  end;

  if p_break_reason = 'seller_side' then
    v_upstream_id := v_property.linked_property_id;

    update public.properties
    set
      status = 'broken_connection',
      linked_property_id = null,
      seller_connected = false
    where id = v_property.id;

    if v_upstream_id is not null then
      update public.properties
      set buyer_connected = false
      where id = v_upstream_id
        and chain_id = v_property.chain_id;
    end if;
  else
    update public.properties
    set
      status = 'broken_connection',
      buyer_connected = false
    where id = v_property.id;

    for v_inbound in
      select *
      from public.properties
      where linked_property_id = v_property.id
        and chain_id = v_property.chain_id
    loop
      update public.properties
      set
        linked_property_id = null,
        seller_connected = false
      where id = v_inbound.id;
    end loop;
  end if;

  insert into public.activities (
    property_id,
    update,
    updated_by
  )
  values (
    v_property.id,
    v_update_message,
    v_updated_by
  );

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.break_chain_connection(bigint, text) is
  'Breaks the buyer-side or seller-side connection of a row. Authorised by can_operate_property; same-chain updates only.';

create or replace function public.report_operational_delay(
  p_reason text,
  p_property_id bigint default null,
  p_chain_node_id bigint default null,
  p_actor_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_chain_id bigint;
  v_property public.properties%rowtype;
  v_node public.chain_nodes%rowtype;
  v_delay public.operational_delays%rowtype;
  v_activity_message text;
  v_actor_role text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.is_valid_operational_delay_reason(p_reason) then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;

  if (p_property_id is null and p_chain_node_id is null)
     or (p_property_id is not null and p_chain_node_id is not null) then
    return jsonb_build_object('ok', false, 'error', 'invalid_target');
  end if;

  v_actor_role := nullif(btrim(coalesce(p_actor_role, '')), '');

  if p_property_id is not null then
    select * into v_property
    from public.properties
    where id = p_property_id;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'property_not_found');
    end if;

    if not public.can_operate_property(p_property_id) then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;

    v_chain_id := v_property.chain_id;

    if exists (
      select 1
      from public.operational_delays d
      where d.property_id = p_property_id
        and d.status = 'active'
    ) then
      return jsonb_build_object('ok', false, 'error', 'delay_already_active');
    end if;
  else
    select * into v_node
    from public.chain_nodes
    where id = p_chain_node_id;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'chain_node_not_found');
    end if;

    if v_node.node_type is distinct from 'buyer_ready' then
      return jsonb_build_object('ok', false, 'error', 'invalid_target');
    end if;

    if v_node.user_id is distinct from v_uid then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;

    v_chain_id := v_node.chain_id;

    if exists (
      select 1
      from public.operational_delays d
      where d.chain_node_id = p_chain_node_id
        and d.status = 'active'
    ) then
      return jsonb_build_object('ok', false, 'error', 'delay_already_active');
    end if;
  end if;

  v_activity_message := 'Delay reported — ' || p_reason;

  insert into public.operational_delays (
    chain_id,
    property_id,
    chain_node_id,
    reason,
    status,
    created_by_user_id,
    created_by_role
  )
  values (
    v_chain_id,
    p_property_id,
    p_chain_node_id,
    p_reason,
    'active',
    v_uid,
    v_actor_role
  )
  returning * into v_delay;

  insert into public.activities (
    property_id,
    chain_node_id,
    update,
    updated_by
  )
  values (
    p_property_id,
    p_chain_node_id,
    v_activity_message,
    coalesce(v_actor_role, 'participant')
  );

  return jsonb_build_object(
    'ok', true,
    'delay_id', v_delay.id,
    'status', v_delay.status,
    'reason', v_delay.reason,
    'created_at', v_delay.created_at,
    'activity_message', v_activity_message
  );
end;
$$;

comment on function public.report_operational_delay(text, bigint, bigint, text) is
  'Create an ACTIVE structured operational delay and timeline activity. No free text. Property targets require can_operate_property; Buyer Ready targets require the node owner.';

create or replace function public.resolve_operational_delay(
  p_delay_id bigint,
  p_actor_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_delay public.operational_delays%rowtype;
  v_activity_message text;
  v_actor_role text;
  v_allowed boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select * into v_delay
  from public.operational_delays
  where id = p_delay_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'delay_not_found');
  end if;

  -- Idempotent: already resolved — do not corrupt state or insert duplicate activity.
  if v_delay.status = 'resolved' then
    return jsonb_build_object(
      'ok', true,
      'delay_id', v_delay.id,
      'status', 'resolved',
      'reason', v_delay.reason,
      'resolved_at', v_delay.resolved_at,
      'already_resolved', true
    );
  end if;

  if v_delay.property_id is not null then
    v_allowed := public.can_operate_property(v_delay.property_id);
  elsif v_delay.chain_node_id is not null then
    v_allowed := exists (
      select 1
      from public.chain_nodes cn
      where cn.id = v_delay.chain_node_id
        and cn.user_id = v_uid
    );
  end if;

  if not v_allowed then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_actor_role := nullif(btrim(coalesce(p_actor_role, '')), '');
  v_activity_message := 'Delay resolved — ' || v_delay.reason;

  update public.operational_delays
  set
    status = 'resolved',
    resolved_at = timezone('utc', now()),
    resolved_by_user_id = v_uid,
    resolved_by_role = v_actor_role
  where id = v_delay.id
  returning * into v_delay;

  insert into public.activities (
    property_id,
    chain_node_id,
    update,
    updated_by
  )
  values (
    v_delay.property_id,
    v_delay.chain_node_id,
    v_activity_message,
    coalesce(v_actor_role, 'participant')
  );

  return jsonb_build_object(
    'ok', true,
    'delay_id', v_delay.id,
    'status', v_delay.status,
    'reason', v_delay.reason,
    'resolved_at', v_delay.resolved_at,
    'activity_message', v_activity_message,
    'already_resolved', false
  );
end;
$$;

comment on function public.resolve_operational_delay(bigint, text) is
  'Resolve an ACTIVE operational delay. Idempotent; retains history; inserts resolve timeline activity. Property targets require can_operate_property; Buyer Ready targets require the node owner.';

create or replace function public.link_sale_to_searching_placeholder(
  p_sale_property_id bigint,
  p_searching_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.properties%rowtype;
  v_searching public.properties%rowtype;
  v_sale_owner uuid;
  v_searching_owner uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select *
  into v_sale
  from public.properties
  where id = p_sale_property_id;

  select *
  into v_searching
  from public.properties
  where id = p_searching_property_id;

  if v_sale.id is null or v_searching.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  if v_sale.chain_id <> v_searching.chain_id then
    return jsonb_build_object('ok', false, 'error', 'chain_mismatch');
  end if;

  if v_sale.relationship_type is null
     or v_sale.relationship_type not in ('sale', 'purchase')
     or v_sale.stage = 'searching'
  then
    return jsonb_build_object('ok', false, 'error', 'invalid_sale');
  end if;

  if v_searching.stage <> 'searching'
    or v_searching.address is not null
    or v_searching.postcode is not null then
    return jsonb_build_object('ok', false, 'error', 'invalid_searching_placeholder');
  end if;

  if not public.can_operate_property(p_sale_property_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_sale_owner := public._property_seller_side_user_id(p_sale_property_id);
  v_searching_owner := public.get_property_operational_owner_user_id(p_searching_property_id);

  if v_searching_owner is not null
     and v_searching_owner is distinct from v_sale_owner
  then
    return jsonb_build_object('ok', false, 'error', 'placeholder_owner_mismatch');
  end if;

  update public.properties
  set linked_property_id = p_searching_property_id
  where id = p_sale_property_id;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.link_sale_to_searching_placeholder(bigint, bigint) is
  'Links an anchor row (sale, or purchase the caller sells) to a stage-authoritative searching placeholder. Authorised by can_operate_property only. The placeholder must be unowned or owned by the anchor''s seller-side homeowner.';

create or replace function public.establish_connected_hop(p_purchase_property_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_purchase public.properties%rowtype;
  v_host_buyer_user_id uuid;
  v_host_sale public.properties%rowtype;
  v_previous_downstream_id bigint;
  v_downstream_after_purchase_id bigint;
  v_existing_downstream public.properties%rowtype;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select *
  into v_purchase
  from public.properties
  where id = p_purchase_property_id;

  if v_purchase.id is null then
    return jsonb_build_object('ok', false, 'error', 'purchase_not_found');
  end if;

  if v_purchase.relationship_type is distinct from 'purchase' then
    return jsonb_build_object('ok', false, 'error', 'not_purchase');
  end if;

  if not public.can_operate_property(v_purchase.id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  update public.properties
  set
    status = 'healthy',
    seller_connected = true,
    buyer_connected = true
  where id = v_purchase.id;

  select poi.homeowner_user_id
  into v_host_buyer_user_id
  from public.property_operational_identities poi
  where poi.property_id = v_purchase.id
    and poi.status = 'active'
    and poi.operational_role = 'buyer';

  if v_host_buyer_user_id is null then
    return jsonb_build_object('ok', true, 'linked', false);
  end if;

  select p.*
  into v_host_sale
  from public.properties p
  inner join public.property_operational_identities poi
    on poi.property_id = p.id
    and poi.status = 'active'
    and poi.operational_role = 'seller'
    and poi.homeowner_user_id = v_host_buyer_user_id
  where p.chain_id = v_purchase.chain_id
    and p.relationship_type = 'sale'
  limit 1;

  if v_host_sale.id is null then
    return jsonb_build_object('ok', true, 'linked', false);
  end if;

  v_previous_downstream_id := v_host_sale.linked_property_id;
  v_downstream_after_purchase_id := null;

  if v_previous_downstream_id is not null
    and v_previous_downstream_id <> v_purchase.id then
    select *
    into v_existing_downstream
    from public.properties
    where id = v_previous_downstream_id;

    if v_existing_downstream.id is not null
      and v_existing_downstream.stage = 'searching'
      and v_existing_downstream.address is null
      and v_existing_downstream.postcode is null then
      v_downstream_after_purchase_id := v_existing_downstream.id;
    end if;
  end if;

  if v_purchase.linked_property_id is not null
    and v_purchase.linked_property_id <> v_downstream_after_purchase_id then
    select *
    into v_existing_downstream
    from public.properties
    where id = v_purchase.linked_property_id;

    if v_existing_downstream.id is not null
      and v_existing_downstream.stage = 'searching'
      and v_existing_downstream.address is null
      and v_existing_downstream.postcode is null then
      v_downstream_after_purchase_id := v_existing_downstream.id;
    end if;
  end if;

  -- Host sale: link into the connected purchase hop. Preserve buyer_connected so
  -- an unrelated unresolved purchaser (Awaiting Buyer) is not cleared.
  update public.properties
  set
    status = 'healthy',
    seller_connected = true,
    linked_property_id = v_purchase.id
  where id = v_host_sale.id;

  update public.properties
  set
    status = 'healthy',
    seller_connected = true,
    buyer_connected = true,
    linked_property_id = v_downstream_after_purchase_id
  where id = v_purchase.id;

  return jsonb_build_object('ok', true, 'linked', true);
end;
$$;

comment on function public.establish_connected_hop(bigint) is
  'After a seller joins a purchase: marks the hop connected and links the buyer''s host sale to it. Authorised by can_operate_property on the purchase (its seller-side homeowner or their permitted EA).';

create or replace function public.upsert_operational_summaries(
  p_chain_summary jsonb,
  p_property_summaries jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chain_id bigint;
  v_property jsonb;
  v_subject text;
  c_scope constant text := 'upsert_operational_summaries';
  c_limit constant integer := 60;
  c_window constant integer := 900;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  v_chain_id := (p_chain_summary->>'chain_id')::bigint;

  if v_chain_id is null then
    raise exception 'chain_id is required';
  end if;

  if not public.can_operate_in_chain(v_chain_id) then
    raise exception 'access denied';
  end if;

  v_subject := auth.uid()::text || ':' || v_chain_id::text;

  if not public._rate_limit_try_consume(
    c_scope,
    v_subject,
    c_limit,
    c_window
  ) then
    raise exception 'rate_limited';
  end if;

  insert into public.chain_operational_summary (
    chain_id,
    confidence_score,
    confidence_band,
    confidence_unavailable,
    data_coverage_status,
    coverage_label,
    estimated_completion_window,
    next_recalculation_at,
    confidence_algorithm_version,
    eta_algorithm_version,
    health_status,
    blocked_count,
    delay_count,
    stale_count,
    buyer_ready_stale,
    requires_replacement_buyer,
    computed_at,
    summary_version
  )
  values (
    v_chain_id,
    nullif(p_chain_summary->>'confidence_score', '')::integer,
    nullif(p_chain_summary->>'confidence_band', ''),
    coalesce((p_chain_summary->>'confidence_unavailable')::boolean, false),
    nullif(p_chain_summary->>'data_coverage_status', ''),
    nullif(p_chain_summary->>'coverage_label', ''),
    nullif(p_chain_summary->>'estimated_completion_window', ''),
    nullif(p_chain_summary->>'next_recalculation_at', '')::timestamptz,
    nullif(p_chain_summary->>'confidence_algorithm_version', ''),
    nullif(p_chain_summary->>'eta_algorithm_version', ''),
    p_chain_summary->>'health_status',
    coalesce((p_chain_summary->>'blocked_count')::integer, 0),
    coalesce((p_chain_summary->>'delay_count')::integer, 0),
    coalesce((p_chain_summary->>'stale_count')::integer, 0),
    coalesce((p_chain_summary->>'buyer_ready_stale')::boolean, false),
    coalesce((p_chain_summary->>'requires_replacement_buyer')::boolean, false),
    coalesce((p_chain_summary->>'computed_at')::timestamptz, now()),
    coalesce((p_chain_summary->>'summary_version')::integer, 2)
  )
  on conflict (chain_id) do update
  set
    confidence_score = excluded.confidence_score,
    confidence_band = excluded.confidence_band,
    confidence_unavailable = excluded.confidence_unavailable,
    data_coverage_status = excluded.data_coverage_status,
    coverage_label = excluded.coverage_label,
    estimated_completion_window = excluded.estimated_completion_window,
    next_recalculation_at = excluded.next_recalculation_at,
    confidence_algorithm_version = excluded.confidence_algorithm_version,
    eta_algorithm_version = excluded.eta_algorithm_version,
    health_status = excluded.health_status,
    blocked_count = excluded.blocked_count,
    delay_count = excluded.delay_count,
    stale_count = excluded.stale_count,
    buyer_ready_stale = excluded.buyer_ready_stale,
    requires_replacement_buyer = excluded.requires_replacement_buyer,
    computed_at = excluded.computed_at,
    summary_version = excluded.summary_version;

  for v_property in
    select value
    from jsonb_array_elements(p_property_summaries)
  loop
    if not exists (
      select 1
      from public.properties p
      where p.id = (v_property->>'property_id')::bigint
        and p.chain_id = v_chain_id
    ) then
      raise exception
        'property % does not belong to chain %',
        v_property->>'property_id',
        v_chain_id;
    end if;

    insert into public.property_operational_summary (
      property_id,
      chain_id,
      current_stage,
      property_status,
      last_update_at,
      days_since_last_update,
      stale_update,
      buyer_ready_stage,
      buyer_ready_status,
      buyer_ready_last_update,
      buyer_ready_delayed,
      buyer_ready_stale,
      completion_status,
      completion_scheduled,
      completion_confirmed,
      operational_alerts,
      needs_attention,
      next_recommended_action,
      computed_at,
      summary_version,
      derived_from_activity_at
    )
    values (
      (v_property->>'property_id')::bigint,
      v_chain_id,
      v_property->>'current_stage',
      v_property->>'property_status',
      nullif(v_property->>'last_update_at', '')::timestamptz,
      coalesce((v_property->>'days_since_last_update')::integer, 0),
      coalesce((v_property->>'stale_update')::boolean, false),
      nullif(v_property->>'buyer_ready_stage', ''),
      nullif(v_property->>'buyer_ready_status', ''),
      nullif(v_property->>'buyer_ready_last_update', '')::timestamptz,
      coalesce((v_property->>'buyer_ready_delayed')::boolean, false),
      coalesce((v_property->>'buyer_ready_stale')::boolean, false),
      nullif(v_property->>'completion_status', ''),
      coalesce((v_property->>'completion_scheduled')::boolean, false),
      coalesce((v_property->>'completion_confirmed')::boolean, false),
      coalesce(v_property->'operational_alerts', '[]'::jsonb),
      coalesce((v_property->>'needs_attention')::boolean, false),
      v_property->'next_recommended_action',
      coalesce((v_property->>'computed_at')::timestamptz, now()),
      coalesce((v_property->>'summary_version')::integer, 2),
      nullif(v_property->>'derived_from_activity_at', '')::timestamptz
    )
    on conflict (property_id) do update
    set
      chain_id = excluded.chain_id,
      current_stage = excluded.current_stage,
      property_status = excluded.property_status,
      last_update_at = excluded.last_update_at,
      days_since_last_update = excluded.days_since_last_update,
      stale_update = excluded.stale_update,
      buyer_ready_stage = excluded.buyer_ready_stage,
      buyer_ready_status = excluded.buyer_ready_status,
      buyer_ready_last_update = excluded.buyer_ready_last_update,
      buyer_ready_delayed = excluded.buyer_ready_delayed,
      buyer_ready_stale = excluded.buyer_ready_stale,
      completion_status = excluded.completion_status,
      completion_scheduled = excluded.completion_scheduled,
      completion_confirmed = excluded.completion_confirmed,
      operational_alerts = excluded.operational_alerts,
      needs_attention = excluded.needs_attention,
      next_recommended_action = excluded.next_recommended_action,
      computed_at = excluded.computed_at,
      summary_version = excluded.summary_version,
      derived_from_activity_at = excluded.derived_from_activity_at;
  end loop;
end;
$$;

comment on function public.upsert_operational_summaries(jsonb, jsonb) is
  'Client persistence of derived chain and property operational summaries after an operational write. Authorised by can_operate_in_chain; rate limited per caller and chain.';

-- ---------------------------------------------------------------------------
-- 5) RPCs: EA appointment by the seller-side homeowner
-- ---------------------------------------------------------------------------

-- Why an assignment ended. Only homeowner_left_cascade allows the branch to
-- reconnect itself (reconnect_returning_ea_branch).
alter table public.property_ea_assignments
  add column if not exists revocation_reason text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.property_ea_assignments'::regclass
      and c.conname = 'property_ea_assignments_revocation_reason_check'
  ) then
    alter table public.property_ea_assignments
      add constraint property_ea_assignments_revocation_reason_check
      check (
        revocation_reason is null
        or revocation_reason in (
          'homeowner_removed_ea',
          'branch_left',
          'replaced',
          'homeowner_left_cascade',
          'branch_member_erased',
          'unspecified'
        )
      );
  end if;
end;
$$;

comment on column public.property_ea_assignments.revocation_reason is
  'Why the assignment ended: homeowner_removed_ea, branch_left, replaced, homeowner_left_cascade (the appointing homeowner left; the branch may reconnect), branch_member_erased, or unspecified (archive and legacy paths). Null while active.';

create or replace function public._trg_property_ea_assignments_revocation_reason()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'active' then
    new.revocation_reason := null;
  elsif old.status = 'active' and new.revocation_reason is null then
    new.revocation_reason := 'unspecified';
  end if;

  return new;
end;
$$;

revoke all on function public._trg_property_ea_assignments_revocation_reason() from public, anon, authenticated;

drop trigger if exists trg_property_ea_assignments_revocation_reason on public.property_ea_assignments;
create trigger trg_property_ea_assignments_revocation_reason
  before update of status on public.property_ea_assignments
  for each row
  execute function public._trg_property_ea_assignments_revocation_reason();

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

  if v_existing.id is not null
     and v_existing.branch_id = p_branch_id
  then
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

alter function public.assign_property_ea_branch(bigint, uuid, boolean) owner to postgres;

comment on function public.assign_property_ea_branch(bigint, uuid, boolean) is
  'The seller-side homeowner appoints an EA branch to their row (one active branch; an existing different branch is revoked in the same transaction). Estate agents, buyers, participants and plain members cannot appoint. Refuses the branch acting for the buyer''s sale.';

revoke all on function public.assign_property_ea_branch(bigint, uuid, boolean) from public, anon;
grant execute on function public.assign_property_ea_branch(bigint, uuid, boolean) to authenticated;

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

alter function public.set_property_ea_update_permission(bigint, boolean) owner to postgres;

comment on function public.set_property_ea_update_permission(bigint, boolean) is
  'The seller-side homeowner sets whether their active EA branch may post operational updates (homeowner_only_updates).';

revoke all on function public.set_property_ea_update_permission(bigint, boolean) from public, anon;
grant execute on function public.set_property_ea_update_permission(bigint, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) Address reservation enforcement
-- ---------------------------------------------------------------------------

create index if not exists properties_address_match_key_idx
  on public.properties (
    public._postcode_match_key(postcode),
    public._address_match_key(address)
  );

create or replace function public._address_reservation_conflict(
  p_address text,
  p_postcode text,
  p_exclude_property_id bigint
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_address_key text := public._address_match_key(p_address);
  v_postcode_key text := public._postcode_match_key(p_postcode);
begin
  if v_address_key is null or v_postcode_key is null then
    return false;
  end if;

  -- Held to commit: concurrent writers of the same address are serialised.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'property_address_reservation:' || v_postcode_key || ':' || v_address_key,
      0
    )
  );

  return exists (
    select 1
    from public.properties p
    where public._postcode_match_key(p.postcode) = v_postcode_key
      and public._address_match_key(p.address) = v_address_key
      and p.id is distinct from p_exclude_property_id
      and public.property_address_is_reserved(p.id)
  );
end;
$$;

alter function public._address_reservation_conflict(text, text, bigint) owner to postgres;

comment on function public._address_reservation_conflict(text, text, bigint) is
  'Locks the normalised address + postcode for the rest of the transaction, then returns true when another property row reserves it (property_address_is_reserved). Rows without an address key never conflict. Internal; service_role only.';

revoke all on function public._address_reservation_conflict(text, text, bigint) from public, anon, authenticated;
grant execute on function public._address_reservation_conflict(text, text, bigint) to service_role;

create or replace function public._trg_properties_address_reservation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.properties%rowtype;
begin
  if public._address_match_key(new.address) is not null
     and public._postcode_match_key(new.postcode) is not null
     and (
       tg_op = 'INSERT'
       or public._address_match_key(old.address) is distinct from public._address_match_key(new.address)
       or public._postcode_match_key(old.postcode) is distinct from public._postcode_match_key(new.postcode)
     )
     and public._address_reservation_conflict(new.address, new.postcode, new.id)
  then
    raise exception 'property_address_reserved'
      using errcode = '23505';
  end if;

  -- A sale linking to a stale same-chain purchase can make that purchase
  -- reserved (buyer side via the sale), so the purchase's address is checked.
  if new.linked_property_id is not null
     and (
       tg_op = 'INSERT'
       or new.linked_property_id is distinct from old.linked_property_id
       or new.chain_id is distinct from old.chain_id
     )
  then
    select *
    into v_target
    from public.properties
    where id = new.linked_property_id;

    if v_target.id is not null
       and v_target.id is distinct from new.id
       and v_target.relationship_type = 'purchase'
       and v_target.chain_id is not distinct from new.chain_id
       and public._property_reservation_state(v_target.id) = 'stale'
       and public._address_reservation_conflict(v_target.address, v_target.postcode, v_target.id)
    then
      raise exception 'property_address_reserved'
        using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

alter function public._trg_properties_address_reservation() owner to postgres;

comment on function public._trg_properties_address_reservation() is
  'Refuses a property insert, or an address/postcode change, when another row reserves the normalised address; and refuses linking to a stale same-chain purchase whose address another row reserves. Applies to every role, including SECURITY DEFINER RPCs.';

revoke all on function public._trg_properties_address_reservation() from public, anon, authenticated;
grant execute on function public._trg_properties_address_reservation() to service_role;

drop trigger if exists trg_properties_address_reservation on public.properties;

create trigger trg_properties_address_reservation
  before insert or update of address, postcode, linked_property_id, chain_id
  on public.properties
  for each row
  execute function public._trg_properties_address_reservation();

create or replace function public.establish_operational_homeowner_for_created_property(
  p_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email_gate jsonb;
  v_property public.properties%rowtype;
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if public._is_estate_agent_account(auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'estate_agent_cannot_be_homeowner');
  end if;

  if not exists (
    select 1
    from public.properties p
    where p.id = p_property_id
      and p.created_by_user_id = auth.uid()
      and p.relationship_type in ('sale', 'purchase')
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if not exists (
    select 1
    from public.properties p
    where p.id = p_property_id
      and public.caller_may_place_property_in_chain(p.chain_id)
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if public._address_reservation_conflict(
    v_property.address,
    v_property.postcode,
    v_property.id
  ) then
    return jsonb_build_object('ok', false, 'error', 'address_reserved');
  end if;

  return public._establish_operational_homeowner_core(
    p_property_id,
    auth.uid(),
    'start_move',
    false
  );
end;
$$;

comment on function public.establish_operational_homeowner_for_created_property(bigint) is
  'Start Move / bootstrap: grants operational homeowner only for properties the caller created, in a chain the caller may place properties in, and only while no other row reserves the address (address_reserved). Estate-agent accounts are rejected.';

create or replace function public._create_ea_operational_property_core(
  p_chain_id bigint,
  p_relationship_type text,
  p_address text,
  p_postcode text,
  p_branch_id uuid,
  p_homeowner_only_updates boolean default false,
  p_invite_email text default null,
  p_invite_display_name text default null,
  p_awaiting_buyer boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property_id bigint;
  v_chain_position integer;
  v_claim_status text;
  v_address text;
  v_postcode text;
  v_email_gate jsonb;
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.is_ea_branch_member(p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_ea_branch_member');
  end if;

  -- A purchase row's EA acts for its seller, who connects separately
  -- (connect_ea_to_awaiting_property); agents originate sales only.
  if p_relationship_type is distinct from 'sale' then
    return jsonb_build_object('ok', false, 'error', 'invalid_relationship_type');
  end if;

  v_address := nullif(trim(p_address), '');
  v_postcode := nullif(trim(p_postcode), '');

  if v_address is null or v_postcode is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_address');
  end if;

  if not exists (
    select 1
    from public.chains c
    where c.id = p_chain_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'chain_not_found');
  end if;

  if exists (
    select 1
    from public.properties p
    where p.chain_id = p_chain_id
      and public._address_match_key(p.address) = public._address_match_key(v_address)
      and public._postcode_match_key(p.postcode) = public._postcode_match_key(v_postcode)
  )
  or public._address_reservation_conflict(v_address, v_postcode, null)
  then
    return jsonb_build_object('ok', false, 'error', 'property_already_exists');
  end if;

  select coalesce(max(p.chain_position), 0) + 1
  into v_chain_position
  from public.properties p
  where p.chain_id = p_chain_id;

  v_claim_status := case
    when nullif(trim(p_invite_email), '') is not null then 'claim_invited'
    else 'unclaimed'
  end;

  insert into public.properties (
    chain_id,
    chain_position,
    address,
    postcode,
    stage,
    status,
    relationship_type,
    created_by_user_id,
    awaiting_buyer,
    buyer_connected,
    seller_connected,
    is_searching,
    is_current_user,
    last_updated_days
  )
  values (
    p_chain_id,
    v_chain_position,
    v_address,
    v_postcode,
    case
      when p_relationship_type = 'sale' then 'property_listed'
      else 'offer_accepted'
    end,
    'pending_connection',
    p_relationship_type,
    auth.uid(),
    case
      when p_relationship_type = 'sale' then coalesce(p_awaiting_buyer, false)
      else false
    end,
    false,
    case
      when p_relationship_type = 'sale' then true
      else false
    end,
    false,
    false,
    0
  )
  returning id into v_property_id;

  perform public._ea_assign_originated_property(
    v_property_id,
    p_branch_id,
    coalesce(p_homeowner_only_updates, false),
    p_invite_email,
    p_invite_display_name,
    v_claim_status
  );

  return jsonb_build_object(
    'ok', true,
    'property_id', v_property_id,
    'chain_id', p_chain_id,
    'claim_status', v_claim_status
  );
end;
$$;

comment on function public._create_ea_operational_property_core(
  bigint, text, text, text, uuid, boolean, text, text, boolean
) is
  'Internal EA operational sale insert (purchase rows refused). property_already_exists when the normalised address is already in this chain or reserved anywhere. Callers must establish chain authorisation (assignment, empty self-originated chain, or access-code join).';

-- ---------------------------------------------------------------------------
-- 6b) Grants onto existing rows: closed rows refused, stale rows re-checked
-- ---------------------------------------------------------------------------
-- Every identity grant (Start Move, claim, convert, both onward convergences)
-- and every counterparty grant (join) runs through these cores, so a row that
-- is archived, released or anonymised can no longer be made operational, and a
-- stale row only becomes reserved again while no other row reserves its
-- address. A sale's stale onward purchase whose address has since been taken
-- is unlinked instead of being re-reserved through the sale.

create or replace function public._establish_operational_homeowner_core(
  p_property_id bigint,
  p_homeowner_user_id uuid,
  p_granted_via text,
  p_sync_claim boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property public.properties%rowtype;
  v_operational_role text;
  v_existing public.property_operational_identities%rowtype;
  v_onward public.properties%rowtype;
begin
  if p_homeowner_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'homeowner_required');
  end if;

  if public._is_estate_agent_account(p_homeowner_user_id) then
    return jsonb_build_object('ok', false, 'error', 'estate_agent_cannot_be_homeowner');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id
  for update;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  v_operational_role := case
    when v_property.relationship_type = 'sale' then 'seller'
    when v_property.relationship_type = 'purchase' then 'buyer'
    else null
  end;

  if v_operational_role is null then
    return jsonb_build_object('ok', false, 'error', 'not_operational_property');
  end if;

  if exists (
    select 1
    from public.property_lifecycle_states pls
    where pls.property_id = p_property_id
      and pls.operational_state in ('archived', 'released', 'anonymised')
  ) then
    return jsonb_build_object('ok', false, 'error', 'property_released');
  end if;

  select *
  into v_existing
  from public.property_operational_identities poi
  where poi.property_id = p_property_id;

  if v_existing.property_id is not null then
    if v_existing.status = 'active' then
      if v_existing.homeowner_user_id = p_homeowner_user_id then
        perform public._upsert_property_membership_row(
          p_property_id,
          p_homeowner_user_id,
          v_operational_role
        );

        if p_sync_claim then
          perform public._sync_property_claim_on_homeowner_grant(
            p_property_id,
            p_homeowner_user_id
          );
        end if;

        return jsonb_build_object(
          'ok', true,
          'property_id', p_property_id,
          'idempotent', true
        );
      end if;

      return jsonb_build_object('ok', false, 'error', 'operational_homeowner_exists');
    end if;
  end if;

  if public._property_reservation_state(p_property_id) = 'stale'
     and public._address_reservation_conflict(
       v_property.address,
       v_property.postcode,
       p_property_id
     )
  then
    return jsonb_build_object('ok', false, 'error', 'address_reserved');
  end if;

  if v_property.relationship_type = 'sale'
     and v_property.linked_property_id is not null
  then
    select *
    into v_onward
    from public.properties
    where id = v_property.linked_property_id;

    if v_onward.id is not null
       and v_onward.relationship_type = 'purchase'
       and v_onward.chain_id is not distinct from v_property.chain_id
       and public._property_reservation_state(v_onward.id) = 'stale'
       and public._address_reservation_conflict(
         v_onward.address,
         v_onward.postcode,
         v_onward.id
       )
    then
      update public.properties
      set linked_property_id = null
      where id = v_property.id;

      perform public._insert_participation_delink_activity(
        v_property.id,
        'The onward purchase was unlinked from this sale because that address is now part of another MoveLoop chain.',
        'system'
      );
    end if;
  end if;

  if v_existing.property_id is not null then
    update public.property_operational_identities
    set
      homeowner_user_id = p_homeowner_user_id,
      operational_role = v_operational_role,
      granted_via = p_granted_via,
      status = 'active',
      granted_at = now(),
      delinked_at = null,
      updated_at = now()
    where property_id = p_property_id;
  else
    insert into public.property_operational_identities (
      property_id,
      homeowner_user_id,
      operational_role,
      granted_via,
      status,
      granted_at
    )
    values (
      p_property_id,
      p_homeowner_user_id,
      v_operational_role,
      p_granted_via,
      'active',
      now()
    );
  end if;

  perform public._upsert_property_membership_row(
    p_property_id,
    p_homeowner_user_id,
    v_operational_role
  );

  if p_sync_claim then
    perform public._sync_property_claim_on_homeowner_grant(
      p_property_id,
      p_homeowner_user_id
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id
  );
end;
$$;

comment on function public._establish_operational_homeowner_core(bigint, uuid, text, boolean) is
  'Internal: grants or re-activates the operational homeowner. Refuses archived, released and anonymised rows (property_released) and, on a stale row, an address another row reserves (address_reserved, under the address lock). A sale''s stale onward purchase whose address another row now reserves is unlinked rather than re-reserved.';

revoke all on function public._establish_operational_homeowner_core(bigint, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public._establish_operational_homeowner_core(bigint, uuid, text, boolean) to service_role;

create or replace function public._grant_counterparty_participation_core(
  p_property_id bigint,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property public.properties%rowtype;
  v_counterparty_role text;
  v_is_homeowner boolean;
  v_sides record;
  v_onward jsonb;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if public._is_estate_agent_account(p_user_id) then
    return jsonb_build_object('ok', false, 'error', 'estate_agent_cannot_be_counterparty');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id
  for update;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  if exists (
    select 1
    from public.property_lifecycle_states pls
    where pls.property_id = p_property_id
      and pls.operational_state in ('archived', 'released', 'anonymised')
  ) then
    return jsonb_build_object('ok', false, 'error', 'property_released');
  end if;

  v_counterparty_role := case
    when v_property.relationship_type = 'sale' then 'buyer'
    when v_property.relationship_type = 'purchase' then 'seller'
    else null
  end;

  if v_counterparty_role is null or v_property.stage = 'searching' then
    return jsonb_build_object('ok', false, 'error', 'not_counterparty_property');
  end if;

  select exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.homeowner_user_id = p_user_id
      and poi.status = 'active'
  )
  into v_is_homeowner;

  if v_is_homeowner then
    return jsonb_build_object('ok', false, 'error', 'homeowner_cannot_be_counterparty');
  end if;

  select *
  into v_sides
  from public._property_side_representation(p_property_id);

  if (v_counterparty_role = 'buyer' and v_sides.seller_side = 'none')
     or (v_counterparty_role = 'seller' and v_sides.buyer_side = 'none')
  then
    return jsonb_build_object('ok', false, 'error', 'opposite_side_unrepresented');
  end if;

  if exists (
    select 1
    from public.property_counterparty_participants cp
    where cp.property_id = p_property_id
      and cp.counterparty_role = v_counterparty_role
      and cp.status = 'active'
      and cp.user_id <> p_user_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'slot_held');
  end if;

  begin
    insert into public.property_counterparty_participants (
      property_id,
      user_id,
      counterparty_role,
      granted_via,
      status,
      granted_at
    )
    values (
      p_property_id,
      p_user_id,
      v_counterparty_role,
      'join_chain_property',
      'active',
      now()
    )
    on conflict (property_id, user_id) do update
    set
      counterparty_role = excluded.counterparty_role,
      status = 'active',
      delinked_at = null;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'slot_held');
  end;

  perform public._upsert_property_membership_row(
    p_property_id,
    p_user_id,
    v_counterparty_role
  );

  v_onward := jsonb_build_object('ok', true, 'onward_claimed', false);

  -- Isolated: a convergence failure must not roll back the join.
  if v_counterparty_role = 'seller' then
    begin
      v_onward := public._converge_onward_purchase_after_seller_join(
        p_property_id,
        p_user_id
      );
    exception
      when others then
        v_onward := jsonb_build_object('ok', false, 'onward_claimed', false);
    end;
  end if;

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'counterparty_role', v_counterparty_role,
    'onward_claimed', coalesce((v_onward ->> 'onward_claimed')::boolean, false)
  );
end;
$$;

comment on function public._grant_counterparty_participation_core(bigint, uuid) is
  'Internal: grants the counterparty role on a row (buyer on a sale, seller on a purchase). Archived, released and anonymised rows are refused (property_released); the opposite side must be represented, the role must be free, and estate agents and the row''s own homeowner are refused. A seller joining a purchase converges its EA-created, never-owned onward purchase.';

revoke all on function public._grant_counterparty_participation_core(bigint, uuid) from public, anon, authenticated;
grant execute on function public._grant_counterparty_participation_core(bigint, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6c) _execute_participation_delink: remove only the departing authority
-- ---------------------------------------------------------------------------
-- The property row is locked (FOR UPDATE) before anything is read, so a
-- concurrent claim, join, delink or lifecycle action on the same row waits.
--
-- homeowner_self, sale:
--   EA assigned        -> the homeowner identity, their membership and the
--                         delegates go; the EA, counterparties, connected
--                         flags and links stay. The claim becomes unclaimed
--                         (any origin) so the EA can invite a replacement.
--   no EA, mistake reason (wrong_property) and no dependants
--                      -> released now.
--   otherwise          -> the row stays in the chain as an unrepresented
--                         placeholder (counterparties, links, flags and valid
--                         invitations kept). The lifecycle owns what happens
--                         next.
-- homeowner_self, purchase (the buyer leaving):
--   The leaver's own linking sale is unlinked in the same transaction and is
--   not counted as a dependant. Released now only when the row has no seller
--   side, no dependants, no open invitation and no counterparty; otherwise
--   it stays as a placeholder.
-- homeowner_remove_ea: the seller-side homeowner only. A buyer on a purchase
--   cannot remove the seller's EA.
-- estate_agent_remove_branch: revokes the assignment (branch_left). With a
--   homeowner still on the seller side nothing else changes. When the branch
--   is the last seller-side representative the row is released now only for
--   a mistake reason (added_by_mistake, duplicate_property) with no
--   dependants; otherwise it stays as a placeholder.
-- estate_agent_remove_homeowner: the caller's branch must be actively assigned
--   to this row; _ea_homeowner_withdrawal_status decides the rest (current
--   seller-side authority, not who created the row). Effects unchanged.
--
-- Dependants (_property_placeholder_has_dependants): buyer_connected on a
-- sale; an active identity or counterparty other than the leaver; a Buyer
-- Ready node linked to the row (other than the leaver's); a represented row
-- linking to it (other than the leaver's own sale); a represented onward row.

create or replace function public._property_placeholder_has_dependants(
  p_property_id bigint,
  p_leaving_user_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.properties p
    where p.id = p_property_id
      and (
        (p.relationship_type = 'sale' and coalesce(p.buyer_connected, false))
        or exists (
          select 1
          from public.property_operational_identities poi
          where poi.property_id = p.id
            and poi.status = 'active'
            and poi.homeowner_user_id is distinct from p_leaving_user_id
        )
        or exists (
          select 1
          from public.property_counterparty_participants cp
          where cp.property_id = p.id
            and cp.status = 'active'
            and cp.user_id is distinct from p_leaving_user_id
        )
        or exists (
          select 1
          from public.chain_nodes cn
          where cn.linked_property_id = p.id
            and cn.node_type = 'buyer_ready'
            and cn.user_id is distinct from p_leaving_user_id
        )
        or exists (
          select 1
          from public.properties q
          where q.linked_property_id = p.id
            and q.id <> p.id
            and not exists (
              select 1
              from public.property_operational_identities lq
              where lq.property_id = q.id
                and lq.status = 'active'
                and p_leaving_user_id is not null
                and lq.homeowner_user_id = p_leaving_user_id
            )
            and (
              exists (
                select 1
                from public.property_operational_identities qi
                where qi.property_id = q.id
                  and qi.status = 'active'
              )
              or exists (
                select 1
                from public.property_counterparty_participants qc
                where qc.property_id = q.id
                  and qc.status = 'active'
              )
              or exists (
                select 1
                from public.property_ea_assignments qa
                where qa.property_id = q.id
                  and qa.status = 'active'
              )
            )
        )
        or exists (
          select 1
          from public.properties o
          where o.id = p.linked_property_id
            and o.id <> p.id
            and (
              exists (
                select 1
                from public.property_operational_identities oi
                where oi.property_id = o.id
                  and oi.status = 'active'
              )
              or exists (
                select 1
                from public.property_counterparty_participants oc
                where oc.property_id = o.id
                  and oc.status = 'active'
              )
              or exists (
                select 1
                from public.property_ea_assignments oa
                where oa.property_id = o.id
                  and oa.status = 'active'
              )
            )
        )
      )
  );
$$;

comment on function public._property_placeholder_has_dependants(bigint, uuid) is
  'Internal: true when someone other than the leaver still depends on the row: buyer_connected on a sale, an active identity or counterparty, a linked Buyer Ready node, a represented linking row (the leaver''s own sale is ignored) or a represented onward row. A row with dependants is never released by a delink.';

revoke all on function public._property_placeholder_has_dependants(bigint, uuid) from public, anon, authenticated;
grant execute on function public._property_placeholder_has_dependants(bigint, uuid) to service_role;

-- Whether the actively assigned EA may withdraw a sale's homeowner
-- association (estate_agent_remove_homeowner). Callers check the assignment.
-- Returns 'invitation_pending' or 'removable' when allowed, otherwise the
-- error code. Authority comes from the current seller-side representation,
-- not from who created the row:
--   purchase rows                        -> not_seller_side_row (the identity
--                                           holder is the buyer)
--   no identity, open claim with an
--   invitation (or EA-originated)        -> invitation_pending
--   no identity otherwise                -> no_homeowner_to_remove
--   identity the homeowner created
--   themselves (start_move, convert_placeholder, backfill on a row that is
--   not EA-originated)                   -> homeowner_not_invited
--   meaningful participation             -> homeowner_actively_participating
--   otherwise                            -> removable
create or replace function public._ea_homeowner_withdrawal_status(
  p_property_id bigint
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case
        when p.relationship_type is distinct from 'sale' then 'not_seller_side_row'
        when poi.homeowner_user_id is null then
          case
            when coalesce(pcm.claim_status, 'claimed') in ('unclaimed', 'claim_invited')
              and (
                pcm.origin_type = 'estate_agent'
                or nullif(trim(pcm.invite_email), '') is not null
                or (public.get_active_property_claim_invitation(p.id)).id is not null
              )
            then 'invitation_pending'
            else 'no_homeowner_to_remove'
          end
        when not (
          pcm.origin_type is not distinct from 'estate_agent'
          or poi.granted_via in ('claim_operational_property', 'ea_origination_claim')
        ) then 'homeowner_not_invited'
        when public.homeowner_has_meaningful_participation(p.id) then 'homeowner_actively_participating'
        else 'removable'
      end
      from public.properties p
      left join public.property_claim_metadata pcm
        on pcm.property_id = p.id
      left join public.property_operational_identities poi
        on poi.property_id = p.id
       and poi.status = 'active'
      where p.id = p_property_id
    ),
    'property_not_found'
  );
$$;

comment on function public._ea_homeowner_withdrawal_status(bigint) is
  'Internal: whether the assigned EA may withdraw a sale''s homeowner association (invitation_pending / removable) or the refusal code. Current seller-side authority, not origin: a self-created homeowner is never withdrawable; purchase rows are refused.';

revoke all on function public._ea_homeowner_withdrawal_status(bigint) from public, anon, authenticated;
grant execute on function public._ea_homeowner_withdrawal_status(bigint) to service_role;

create or replace function public._execute_participation_delink(
  p_property_id bigint,
  p_operation text,
  p_reason_code text,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_property public.properties%rowtype;
  v_chain_id bigint;
  v_branch_id uuid;
  v_activity_message text;
  v_identity public.property_operational_identities%rowtype;
  v_transition jsonb;
  v_sides record;
  v_mistake boolean;
  v_dependants boolean := false;
  v_release boolean := false;
  v_homeowner_remains boolean;
  v_sale_id bigint;
  v_unlinked_sale_ids bigint[] := array[]::bigint[];
  v_withdrawal text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_operation not in (
    'homeowner_self',
    'homeowner_remove_ea',
    'estate_agent_remove_branch',
    'estate_agent_remove_homeowner'
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_operation');
  end if;

  if not public.is_valid_participation_delink_reason_code(
    p_operation,
    p_reason_code
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason_code');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id
  for update;

  if v_property.id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  v_chain_id := v_property.chain_id;
  v_mistake := p_reason_code in ('wrong_property', 'added_by_mistake', 'duplicate_property');

  if p_operation = 'homeowner_self' then
    select *
    into v_identity
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.homeowner_user_id = v_uid
      and poi.status = 'active';

    if v_identity.property_id is null then
      return jsonb_build_object('ok', false, 'error', 'not_operational_homeowner');
    end if;

    insert into public.property_delink_events (
      property_id,
      chain_id,
      actor_user_id,
      actor_type,
      reason_code,
      metadata
    )
    values (
      p_property_id,
      v_chain_id,
      v_uid,
      'homeowner',
      p_reason_code,
      jsonb_build_object(
        'operation', p_operation,
        'relationship_type', v_property.relationship_type
      )
    );

    -- The buyer leaving a purchase.
    if v_property.relationship_type = 'purchase' then
      -- The leaver's own linking sales, locked after the purchase row.
      perform 1
      from public.properties s
      where s.chain_id is not distinct from v_chain_id
        and s.linked_property_id = p_property_id
        and s.id <> p_property_id
        and exists (
          select 1
          from public.property_operational_identities spoi
          where spoi.property_id = s.id
            and spoi.homeowner_user_id = v_uid
            and spoi.status = 'active'
        )
      order by s.id
      for update;

      select *
      into v_sides
      from public._property_side_representation(p_property_id);

      v_dependants := public._property_placeholder_has_dependants(p_property_id, v_uid);

      v_release := v_sides.seller_side = 'none'
        and not v_dependants
        and (public.get_active_property_claim_invitation(p_property_id)).id is null
        and not exists (
          select 1
          from public.property_counterparty_participants cp
          where cp.property_id = p_property_id
            and cp.status = 'active'
        );

      if v_release then
        v_transition := public.record_property_lifecycle_transition(
          p_property_id,
          'released',
          'homeowner_delink',
          null,
          p_reason_code,
          jsonb_build_object(
            'operation', p_operation,
            'reason_code', p_reason_code,
            'buyer_left', true
          )
        );

        if coalesce((v_transition ->> 'ok')::boolean, false) is not true then
          raise exception 'participation_delink_lifecycle_transition_failed: %',
            coalesce(v_transition ->> 'error', 'unknown');
        end if;
      end if;

      for v_sale_id in
        update public.properties s
        set linked_property_id = null
        where s.chain_id is not distinct from v_chain_id
          and s.linked_property_id = p_property_id
          and s.id <> p_property_id
          and exists (
            select 1
            from public.property_operational_identities spoi
            where spoi.property_id = s.id
              and spoi.homeowner_user_id = v_uid
              and spoi.status = 'active'
          )
        returning s.id
      loop
        v_unlinked_sale_ids := array_append(v_unlinked_sale_ids, v_sale_id);

        perform public._insert_participation_delink_activity(
          v_sale_id,
          'The onward purchase was unlinked from this sale because the buyer left that purchase.',
          'system'
        );
      end loop;

      delete from public.property_members pm
      where pm.property_id = p_property_id
        and (
          pm.user_id = v_uid
          or pm.user_id in (
            select pd.delegate_user_id
            from public.property_delegates pd
            where pd.property_id = p_property_id
              and pd.status in ('pending', 'active')
          )
        );

      update public.property_delegates
      set
        status = 'revoked',
        revoked_at = now(),
        updated_at = now()
      where property_id = p_property_id
        and status in ('pending', 'active');

      update public.property_operational_identities
      set
        status = 'released',
        delinked_at = now(),
        updated_at = now()
      where property_id = p_property_id
        and status = 'active';

      if v_release then
        delete from public.property_members
        where property_id = p_property_id;

        perform public._revoke_open_property_claim_invitations(p_property_id);

        update public.property_claim_metadata pcm
        set
          claim_status = case
            when pcm.origin_type = 'estate_agent' then 'unclaimed'
            else pcm.claim_status
          end,
          claimed_by_user_id = case
            when pcm.origin_type = 'estate_agent' then null
            else pcm.claimed_by_user_id
          end,
          claimed_at = case
            when pcm.origin_type = 'estate_agent' then null
            else pcm.claimed_at
          end,
          updated_at = now()
        where pcm.property_id = p_property_id;

        update public.properties
        set
          status = 'pending_connection',
          buyer_connected = false,
          seller_connected = false
        where id = p_property_id;

        v_activity_message :=
          'Homeowner left this transaction. The property has been released.';
      else
        v_activity_message := 'The buyer left this purchase.';
      end if;

      perform public._notify_chain_participants_of_delink(
        p_property_id,
        v_chain_id,
        v_activity_message
      );

      return jsonb_build_object(
        'ok', true,
        'property_id', p_property_id,
        'operation', p_operation,
        'reason_code', p_reason_code,
        'lifecycle_state', case when v_release then 'released' else 'active' end,
        'placeholder', not v_release,
        'unlinked_sale_ids', to_jsonb(v_unlinked_sale_ids)
      );
    end if;

    -- The seller side leaving a sale (or an untyped row).
    if exists (
      select 1
      from public.property_ea_assignments pea
      where pea.property_id = p_property_id
        and pea.status = 'active'
    ) then
      v_release := false;
    else
      v_dependants := public._property_placeholder_has_dependants(p_property_id, v_uid);
      v_release := v_mistake and not v_dependants;
    end if;

    if v_release then
      v_transition := public.record_property_lifecycle_transition(
        p_property_id,
        'released',
        'homeowner_delink',
        null,
        p_reason_code,
        jsonb_build_object('operation', p_operation, 'reason_code', p_reason_code)
      );

      if coalesce((v_transition ->> 'ok')::boolean, false) is not true then
        raise exception 'participation_delink_lifecycle_transition_failed: %',
          coalesce(v_transition ->> 'error', 'unknown');
      end if;
    end if;

    delete from public.property_members pm
    where pm.property_id = p_property_id
      and (
        pm.user_id = v_uid
        or pm.user_id in (
          select pd.delegate_user_id
          from public.property_delegates pd
          where pd.property_id = p_property_id
            and pd.status in ('pending', 'active')
        )
      );

    update public.property_delegates
    set
      status = 'revoked',
      revoked_at = now(),
      updated_at = now()
    where property_id = p_property_id
      and status in ('pending', 'active');

    update public.property_operational_identities
    set
      status = 'released',
      delinked_at = now(),
      updated_at = now()
    where property_id = p_property_id
      and status = 'active';

    if v_release then
      update public.property_counterparty_participants
      set
        status = 'delinked',
        delinked_at = now()
      where property_id = p_property_id
        and status = 'active';

      delete from public.property_members
      where property_id = p_property_id;

      perform public._revoke_open_property_claim_invitations(p_property_id);

      update public.property_claim_metadata pcm
      set
        claim_status = case
          when pcm.origin_type = 'estate_agent' then 'unclaimed'
          else pcm.claim_status
        end,
        claimed_by_user_id = case
          when pcm.origin_type = 'estate_agent' then null
          else pcm.claimed_by_user_id
        end,
        claimed_at = case
          when pcm.origin_type = 'estate_agent' then null
          else pcm.claimed_at
        end,
        updated_at = now()
      where pcm.property_id = p_property_id;

      update public.properties
      set
        status = 'pending_connection',
        buyer_connected = false,
        seller_connected = false
      where id = p_property_id;

      v_activity_message :=
        'Homeowner left this transaction. The property has been released.';
    else
      -- The seller side is open again: a replacement homeowner can be invited
      -- (by the remaining EA) or can claim with a valid invitation.
      insert into public.property_claim_metadata (
        property_id,
        claim_status,
        claimed_at,
        claimed_by_user_id
      )
      values (
        p_property_id,
        'unclaimed',
        null,
        null
      )
      on conflict (property_id) do update
      set
        claim_status = case
          when public.property_claim_metadata.claim_status = 'claim_invited' then 'claim_invited'
          else 'unclaimed'
        end,
        claimed_at = null,
        claimed_by_user_id = null,
        updated_at = now();

      v_activity_message := case
        when exists (
          select 1
          from public.property_ea_assignments pea
          where pea.property_id = p_property_id
            and pea.status = 'active'
        ) then 'Homeowner left this transaction. The estate agent continues to manage the property.'
        else 'Homeowner left this transaction. The property is awaiting its seller.'
      end;
    end if;

    perform public._notify_chain_participants_of_delink(
      p_property_id,
      v_chain_id,
      v_activity_message
    );

    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'operation', p_operation,
      'reason_code', p_reason_code,
      'lifecycle_state', case when v_release then 'released' else 'active' end,
      'ea_retained', exists (
        select 1
        from public.property_ea_assignments pea
        where pea.property_id = p_property_id
          and pea.status = 'active'
      ),
      'placeholder', not v_release and not exists (
        select 1
        from public.property_ea_assignments pea
        where pea.property_id = p_property_id
          and pea.status = 'active'
      )
    );
  end if;

  if p_operation = 'homeowner_remove_ea' then
    if not public.is_property_seller_side_homeowner(p_property_id) then
      return jsonb_build_object('ok', false, 'error', 'not_operational_homeowner');
    end if;

    select pea.branch_id
    into v_branch_id
    from public.property_ea_assignments pea
    where pea.property_id = p_property_id
      and pea.status = 'active'
    limit 1;

    if v_branch_id is null then
      return jsonb_build_object('ok', false, 'error', 'no_active_ea_assignment');
    end if;

    if p_branch_id is not null and p_branch_id is distinct from v_branch_id then
      return jsonb_build_object('ok', false, 'error', 'branch_mismatch');
    end if;

    insert into public.property_delink_events (
      property_id,
      chain_id,
      actor_user_id,
      actor_type,
      reason_code,
      metadata
    )
    values (
      p_property_id,
      v_chain_id,
      v_uid,
      'homeowner',
      p_reason_code,
      jsonb_build_object(
        'operation', p_operation,
        'branch_id', v_branch_id
      )
    );

    update public.property_ea_assignments
    set
      status = 'revoked',
      revoked_at = now(),
      revocation_reason = 'homeowner_removed_ea',
      updated_at = now()
    where property_id = p_property_id
      and branch_id = v_branch_id
      and status = 'active';

    v_activity_message :=
      'Homeowner removed the estate agent branch from this property.';

    perform public._notify_chain_participants_of_delink(
      p_property_id,
      v_chain_id,
      v_activity_message
    );

    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'operation', p_operation,
      'reason_code', p_reason_code,
      'branch_id', v_branch_id
    );
  end if;

  if p_operation = 'estate_agent_remove_branch' then
    if p_branch_id is null then
      select pea.branch_id
      into v_branch_id
      from public.property_ea_assignments pea
      inner join public.ea_branch_members bm
        on bm.branch_id = pea.branch_id
      where pea.property_id = p_property_id
        and pea.status = 'active'
        and bm.user_id = v_uid
      limit 1;
    else
      v_branch_id := p_branch_id;
    end if;

    if v_branch_id is null then
      return jsonb_build_object('ok', false, 'error', 'branch_required');
    end if;

    if not exists (
      select 1
      from public.property_ea_assignments pea
      inner join public.ea_branch_members bm
        on bm.branch_id = pea.branch_id
      where pea.property_id = p_property_id
        and pea.branch_id = v_branch_id
        and pea.status = 'active'
        and bm.user_id = v_uid
    ) then
      return jsonb_build_object('ok', false, 'error', 'not_assigned_ea');
    end if;

    insert into public.property_delink_events (
      property_id,
      chain_id,
      actor_user_id,
      actor_type,
      reason_code,
      metadata
    )
    values (
      p_property_id,
      v_chain_id,
      v_uid,
      'estate_agent',
      p_reason_code,
      jsonb_build_object(
        'operation', p_operation,
        'branch_id', v_branch_id
      )
    );

    v_homeowner_remains := public._property_seller_side_user_id(p_property_id) is not null;

    if not v_homeowner_remains then
      v_dependants := public._property_placeholder_has_dependants(p_property_id, null);
      v_release := v_mistake and not v_dependants;
    end if;

    -- Recorded while the caller is still the assigned EA, so the lifecycle
    -- transition is authorised.
    if v_release then
      v_transition := public.record_property_lifecycle_transition(
        p_property_id,
        'released',
        'ea_delink_no_homeowner',
        null,
        p_reason_code,
        jsonb_build_object(
          'operation', p_operation,
          'reason_code', p_reason_code,
          'branch_id', v_branch_id
        )
      );

      if coalesce((v_transition ->> 'ok')::boolean, false) is not true then
        raise exception 'participation_delink_lifecycle_transition_failed: %',
          coalesce(v_transition ->> 'error', 'unknown');
      end if;

      update public.property_delegates
      set
        status = 'revoked',
        revoked_at = now(),
        updated_at = now()
      where property_id = p_property_id
        and status in ('pending', 'active');

      update public.property_counterparty_participants
      set
        status = 'delinked',
        delinked_at = now()
      where property_id = p_property_id
        and status = 'active';

      delete from public.property_members
      where property_id = p_property_id;

      perform public._revoke_open_property_claim_invitations(p_property_id);

      update public.property_claim_metadata pcm
      set
        claim_status = 'unclaimed',
        claimed_by_user_id = null,
        claimed_at = null,
        updated_at = now()
      where pcm.property_id = p_property_id;

      update public.properties
      set
        status = 'pending_connection',
        buyer_connected = false,
        seller_connected = false
      where id = p_property_id;
    end if;

    update public.property_ea_assignments
    set
      status = 'revoked',
      revoked_at = now(),
      revocation_reason = 'branch_left',
      updated_at = now()
    where property_id = p_property_id
      and branch_id = v_branch_id
      and status = 'active';

    if v_release then
      perform public._insert_participation_delink_activity(
        p_property_id,
        'Property released for future transactions. Historic chain data retained.',
        'system'
      );
    end if;

    v_activity_message :=
      'Estate agent branch released operational management of this property.';

    perform public._notify_chain_participants_of_delink(
      p_property_id,
      v_chain_id,
      v_activity_message
    );

    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'operation', p_operation,
      'reason_code', p_reason_code,
      'branch_id', v_branch_id,
      'lifecycle_state', case when v_release then 'released' else 'active' end,
      'placeholder', not v_homeowner_remains and not v_release
    );
  end if;

  if p_operation = 'estate_agent_remove_homeowner' then
    select pea.branch_id
    into v_branch_id
    from public.property_ea_assignments pea
    inner join public.ea_branch_members bm
      on bm.branch_id = pea.branch_id
    where pea.property_id = p_property_id
      and pea.status = 'active'
      and bm.user_id = v_uid
    limit 1;

    if v_branch_id is null then
      return jsonb_build_object('ok', false, 'error', 'not_assigned_ea');
    end if;

    if p_branch_id is not null and p_branch_id is distinct from v_branch_id then
      return jsonb_build_object('ok', false, 'error', 'branch_mismatch');
    end if;

    v_withdrawal := public._ea_homeowner_withdrawal_status(p_property_id);

    if v_withdrawal not in ('invitation_pending', 'removable') then
      return jsonb_build_object('ok', false, 'error', v_withdrawal);
    end if;

    insert into public.property_delink_events (
      property_id,
      chain_id,
      actor_user_id,
      actor_type,
      reason_code,
      metadata
    )
    values (
      p_property_id,
      v_chain_id,
      v_uid,
      'estate_agent',
      p_reason_code,
      jsonb_build_object(
        'operation', p_operation,
        'branch_id', v_branch_id,
        'invitation_pending', v_withdrawal = 'invitation_pending'
      )
    );

    update public.property_delegates
    set
      status = 'revoked',
      revoked_at = now(),
      updated_at = now()
    where property_id = p_property_id
      and status in ('pending', 'active');

    select *
    into v_identity
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.status = 'active';

    if v_identity.property_id is not null then
      delete from public.property_members
      where property_id = p_property_id
        and user_id = v_identity.homeowner_user_id;

      update public.property_operational_identities
      set
        status = 'released',
        delinked_at = now(),
        updated_at = now()
      where property_id = p_property_id
        and status = 'active';

      perform public._release_converged_onward_purchase_with_sale(
        p_property_id,
        v_identity.homeowner_user_id,
        p_reason_code
      );
    end if;

    update public.property_claim_invitations pci
    set
      invitation_revoked_at = coalesce(pci.invitation_revoked_at, now()),
      updated_at = now()
    where pci.property_id = p_property_id
      and pci.invitation_used_at is null
      and pci.invitation_revoked_at is null;

    update public.property_claim_metadata pcm
    set
      claim_status = 'claim_invited',
      claimed_by_user_id = null,
      claimed_at = null,
      updated_at = now()
    where pcm.property_id = p_property_id;

    v_activity_message :=
      'Estate agent withdrew the homeowner association for this property. The invitation can be re-sent.';

    perform public._notify_chain_participants_of_delink(
      p_property_id,
      v_chain_id,
      v_activity_message
    );

    return jsonb_build_object(
      'ok', true,
      'property_id', p_property_id,
      'operation', p_operation,
      'reason_code', p_reason_code,
      'branch_id', v_branch_id,
      'invitation_reset', true
    );
  end if;

  return jsonb_build_object('ok', false, 'error', 'unsupported_operation');
end;
$$;

revoke all on function public._execute_participation_delink(bigint, text, text, uuid) from public, anon, authenticated;
grant execute on function public._execute_participation_delink(bigint, text, text, uuid) to service_role;

-- get_participation_delink_options: offers exactly what
-- _execute_participation_delink allows. homeowner_remove_ea only to the
-- seller-side homeowner (not a buyer identity holder on a purchase);
-- estate_agent_remove_homeowner by _ea_homeowner_withdrawal_status for a
-- member of the actively assigned branch. Otherwise unchanged from
-- 20260714170000.
create or replace function public.get_participation_delink_options(
  p_property_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_options jsonb := '[]'::jsonb;
  v_branch_id uuid;
  v_caller_branch_id uuid;
  v_is_homeowner boolean;
  v_is_seller_side_homeowner boolean;
  v_has_ea boolean;
  v_invitation_pending boolean;
  v_meaningful boolean;
  v_withdrawal text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not exists (
    select 1 from public.properties p where p.id = p_property_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  select exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.homeowner_user_id = auth.uid()
      and poi.status = 'active'
  )
  into v_is_homeowner;

  v_is_seller_side_homeowner := public.is_property_seller_side_homeowner(p_property_id);

  select pea.branch_id
  into v_branch_id
  from public.property_ea_assignments pea
  where pea.property_id = p_property_id
    and pea.status = 'active'
  limit 1;

  v_has_ea := v_branch_id is not null;

  select pea.branch_id
  into v_caller_branch_id
  from public.property_ea_assignments pea
  inner join public.ea_branch_members bm
    on bm.branch_id = pea.branch_id
  where pea.property_id = p_property_id
    and pea.status = 'active'
    and bm.user_id = auth.uid()
  limit 1;

  v_invitation_pending :=
    public.property_invitation_is_pending(p_property_id);

  v_meaningful :=
    public.homeowner_has_meaningful_participation(p_property_id);

  if v_is_homeowner then
    v_options := v_options || jsonb_build_array(
      jsonb_build_object(
        'operation', 'homeowner_self',
        'label', 'Leave this transaction',
        'requires_confirmation', true,
        'branch_id', null,
        'reason_codes', to_jsonb(
          public.participation_delink_reason_codes_for_operation('homeowner_self')
        )
      )
    );
  end if;

  if v_is_seller_side_homeowner and v_has_ea then
    v_options := v_options || jsonb_build_array(
      jsonb_build_object(
        'operation', 'homeowner_remove_ea',
        'label', 'Remove estate agent',
        'requires_confirmation', true,
        'branch_id', v_branch_id,
        'reason_codes', to_jsonb(
          public.participation_delink_reason_codes_for_operation('homeowner_remove_ea')
        )
      )
    );
  end if;

  if v_caller_branch_id is not null then
    v_options := v_options || jsonb_build_array(
      jsonb_build_object(
        'operation', 'estate_agent_remove_branch',
        'label', 'Release branch management',
        'requires_confirmation', true,
        'branch_id', v_caller_branch_id,
        'reason_codes', to_jsonb(
          public.participation_delink_reason_codes_for_operation('estate_agent_remove_branch')
        )
      )
    );

    v_withdrawal := public._ea_homeowner_withdrawal_status(p_property_id);

    if v_withdrawal in ('invitation_pending', 'removable') then
      v_options := v_options || jsonb_build_array(
        jsonb_build_object(
          'operation', 'estate_agent_remove_homeowner',
          'label', 'Withdraw homeowner association',
          'requires_confirmation', true,
          'branch_id', v_caller_branch_id,
          'invitation_pending', v_withdrawal = 'invitation_pending',
          'reason_codes', to_jsonb(
            public.participation_delink_reason_codes_for_operation('estate_agent_remove_homeowner')
          )
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'options', v_options,
    'signals', jsonb_build_object(
      'invitation_pending', v_invitation_pending,
      'meaningful_participation', v_meaningful,
      'is_operational_homeowner', v_is_homeowner
    )
  );
end;
$$;

comment on function public.get_participation_delink_options(bigint) is
  'Participation de-link options for the caller. Mirrors _execute_participation_delink: homeowner_remove_ea for the seller-side homeowner only; estate_agent_remove_homeowner for the assigned branch per _ea_homeowner_withdrawal_status.';

revoke all on function public.get_participation_delink_options(bigint) from public, anon;
grant execute on function public.get_participation_delink_options(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 6d) Structured activity allowlist: unlink, delink and reconnection notices
-- ---------------------------------------------------------------------------
-- Adds the fixed notices written by _establish_operational_homeowner_core
-- (stale onward purchase unlinked), _execute_participation_delink (seller
-- side left with the EA retained or the row awaiting its seller; the buyer
-- leaving a purchase and their sale unlinked) and
-- reconnect_returning_ea_branch. Otherwise unchanged from 20260910210000.

create or replace function public.is_allowed_structured_activity_update(
  p_update text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_text text := p_update;
  v_reason text;
  v_delay_reason text;
begin
  if v_text is null or length(trim(v_text)) = 0 then
    return false;
  end if;

  -- Title-cased stage values (property page) and catalogue labels (buyer ready / stages).
  if v_text in (
    'Searching',
    'Next Home Search',
    'Property Listed',
    'Offer Accepted',
    'Solicitors Instructed',
    'Searches Ordered',
    'Survey Booked',
    'Searches Returned',
    'Survey Completed',
    'Mortgage Offer Received',
    'Enquiries Raised',
    'Enquiries Fully Answered',
    'Contracts Issued',
    'Ready To Exchange',
    'Contracts Exchanged',
    'Completion Date Agreed',
    'Completed',
    'Mortgage In Principle',
    'Mortgage Application',
    'Mortgage Application Submitted',
    'Solicitor Instructed',
    'Enquiries Reviewed',
    'Contracts Signed',
    'Exchange Contracts',
    'Onward purchase added',
    'Chain Connection Broken - Buyer Side',
    'Chain Connection Broken - Seller Side',
    'Homeowner left this transaction. The property has been released.',
    'Homeowner removed the estate agent branch from this property.',
    'Estate agent branch released operational management of this property.',
    'Estate agent withdrew the homeowner association for this property. The invitation can be re-sent.',
    'Property operational participation archived by lifecycle automation.',
    'Property released for future transactions. Historic chain data retained.',
    'The onward purchase was unlinked from this sale because that address is now part of another MoveLoop chain.',
    'Homeowner left this transaction. The estate agent continues to manage the property.',
    'Homeowner left this transaction. The property is awaiting its seller.',
    'The buyer left this purchase.',
    'The onward purchase was unlinked from this sale because the buyer left that purchase.',
    'Estate agent branch reconnected to this property.',
    E'Completion Confirmed\n\nTransaction marked as completed.'
  ) then
    return true;
  end if;

  -- Operational delay activities (allowlisted reasons only).
  if v_text like 'Delay reported — %' then
    v_delay_reason := substr(v_text, length('Delay reported — ') + 1);
    return v_delay_reason in (
      'Awaiting Searches',
      'Awaiting Mortgage Offer',
      'Awaiting Signed Documents',
      'Awaiting Survey Results',
      'Awaiting Management Pack'
    );
  end if;

  if v_text like 'Delay resolved — %' then
    v_delay_reason := substr(v_text, length('Delay resolved — ') + 1);
    return v_delay_reason in (
      'Awaiting Searches',
      'Awaiting Mortgage Offer',
      'Awaiting Signed Documents',
      'Awaiting Survey Results',
      'Awaiting Management Pack'
    );
  end if;

  -- Completion date amendment template (dates variable; reason labels finite).
  if v_text ~ E'^Completion date updated\\n\\n.+\\n\\nReason:\\n.+$' then
    v_reason := split_part(v_text, E'Reason:\n', 2);
    return v_reason in (
      'Solicitors agreed a revised completion date',
      'Chain dependency required date adjustment',
      'Mortgage or lender timing required date adjustment',
      'Removal or logistics availability required date adjustment',
      'Developer or new-build timing required date adjustment',
      'Completion date entered incorrectly',
      'Administrative correction'
    );
  end if;

  return false;
end;
$$;

comment on function public.is_allowed_structured_activity_update(text) is
  'True when activities.update matches structured/system producers. Rejects arbitrary free text.';

revoke all on function public.is_allowed_structured_activity_update(text) from public, anon, authenticated;
grant execute on function public.is_allowed_structured_activity_update(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6e) discover_claimable_properties: closed rows are not offered; rows handed
--     to their EA are offered
-- ---------------------------------------------------------------------------
-- Archived, released and anonymised rows cannot be claimed (the identity core
-- refuses them), so listing them sent the invitee to a dead-end claim page on
-- every sign-in. A homeowner-created row whose homeowner left while the EA
-- stayed is listed like an EA-originated row (an active assignment is
-- enough). Rows that already have an operational homeowner are not listed.
-- Otherwise unchanged from 20260712120000.

create or replace function public.discover_claimable_properties()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text;
  v_results jsonb;
begin
  if auth.uid() is null then
    return '[]'::jsonb;
  end if;

  if not exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.account_type = 'homeowner'
  ) then
    return '[]'::jsonb;
  end if;

  v_email := public.get_auth_user_email();

  if v_email is null or v_email = '' then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'property_id', rows.property_id,
        'address', rows.address,
        'postcode', rows.postcode,
        'branch_name', rows.branch_name,
        'in_chain', rows.in_chain,
        'claim_status', rows.claim_status
      )
      order by rows.property_id
    ),
    '[]'::jsonb
  )
  into v_results
  from (
    select
      pcm.property_id,
      p.address,
      p.postcode,
      coalesce(b.name, 'Estate agent branch') as branch_name,
      exists (
        select 1
        from public.properties p2
        where p2.chain_id = p.chain_id
          and p2.id <> p.id
      ) as in_chain,
      pcm.claim_status
    from public.property_claim_metadata pcm
    inner join public.properties p
      on p.id = pcm.property_id
    left join lateral (
      select pea.branch_id
      from public.property_ea_assignments pea
      where pea.property_id = pcm.property_id
        and pea.status = 'active'
      order by pea.assigned_at desc nulls last
      limit 1
    ) active_assignment
      on true
    left join public.ea_branches b
      on b.id = active_assignment.branch_id
    where (
        pcm.origin_type = 'estate_agent'
        or active_assignment.branch_id is not null
      )
      and pcm.claim_status in ('unclaimed', 'claim_invited')
      and pcm.invite_email is not null
      and lower(trim(pcm.invite_email)) = v_email
      and not exists (
        select 1
        from public.property_lifecycle_states pls
        where pls.property_id = pcm.property_id
          and pls.operational_state in ('archived', 'released', 'anonymised')
      )
      and not exists (
        select 1
        from public.property_operational_identities poi
        where poi.property_id = pcm.property_id
          and poi.status = 'active'
      )
      and not exists (
        select 1
        from public.property_members pm
        where pm.property_id = pcm.property_id
          and pm.user_id = auth.uid()
      )
      and not exists (
        select 1
        from public.property_claim_invitations pci
        where pci.property_id = pcm.property_id
          and pci.invitation_rejected_by_user_id = auth.uid()
          and pci.invitation_rejected_at is not null
          and (public.get_active_property_claim_invitation(pcm.property_id)).id is null
      )
  ) as rows;

  return coalesce(v_results, '[]'::jsonb);
end;
$$;

revoke all on function public.discover_claimable_properties() from public, anon;
grant execute on function public.discover_claimable_properties() to authenticated;

-- An invitation link for a closed row reports property_released instead of
-- offering a claim that would be refused. Otherwise unchanged from
-- 20260712120000.
create or replace function public.resolve_claim_invitation_token(
  p_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text;
  v_hash text;
  v_invitation public.property_claim_invitations%rowtype;
  v_metadata public.property_claim_metadata%rowtype;
  v_property public.properties%rowtype;
  v_branch_name text;
  v_in_chain boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.account_type = 'homeowner'
  ) then
    return jsonb_build_object('ok', false, 'error', 'homeowner_only');
  end if;

  v_email := public.get_auth_user_email();

  if v_email is null or v_email = '' then
    return jsonb_build_object('ok', false, 'error', 'email_required');
  end if;

  if nullif(trim(p_token), '') is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  v_hash := public.hash_invitation_token(p_token);

  select *
  into v_invitation
  from public.property_claim_invitations pci
  where pci.invitation_token_hash = v_hash
  order by pci.invitation_created_at desc
  limit 1;

  if v_invitation.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  if v_invitation.invitation_used_at is not null then
    return jsonb_build_object('ok', false, 'error', 'already_used');
  end if;

  if v_invitation.invitation_rejected_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invitation_declined');
  end if;

  if v_invitation.invitation_revoked_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  if v_invitation.invitation_expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  if exists (
    select 1
    from public.property_lifecycle_states pls
    where pls.property_id = v_invitation.property_id
      and pls.operational_state in ('archived', 'released', 'anonymised')
  ) then
    return jsonb_build_object('ok', false, 'error', 'property_released');
  end if;

  select *
  into v_metadata
  from public.property_claim_metadata pcm
  where pcm.property_id = v_invitation.property_id;

  if v_metadata.claim_status = 'claimed' then
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;

  if v_metadata.invite_email is null
    or lower(trim(v_metadata.invite_email)) <> v_email then
    return jsonb_build_object('ok', false, 'error', 'email_mismatch');
  end if;

  if exists (
    select 1
    from public.property_members pm
    where pm.property_id = v_invitation.property_id
      and pm.user_id = auth.uid()
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_member');
  end if;

  select *
  into v_property
  from public.properties
  where id = v_invitation.property_id;

  select coalesce(b.name, 'Estate agent branch')
  into v_branch_name
  from public.property_ea_assignments pea
  left join public.ea_branches b
    on b.id = pea.branch_id
  where pea.property_id = v_invitation.property_id
    and pea.status = 'active'
  order by pea.assigned_at desc nulls last
  limit 1;

  v_in_chain := exists (
    select 1
    from public.properties p2
    where p2.chain_id = v_property.chain_id
      and p2.id <> v_property.id
  );

  return jsonb_build_object(
    'ok', true,
    'property', jsonb_build_object(
      'property_id', v_property.id,
      'address', v_property.address,
      'postcode', v_property.postcode,
      'branch_name', v_branch_name,
      'in_chain', v_in_chain,
      'claim_status', v_metadata.claim_status
    )
  );
end;
$$;

revoke all on function public.resolve_claim_invitation_token(text) from public, anon;
grant execute on function public.resolve_claim_invitation_token(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6f) claim_operational_property: rows handed to their EA are claimable
-- ---------------------------------------------------------------------------
-- An unclaimed row whose invite email matches is claimable when it is
-- EA-originated, has an active EA assignment (a homeowner-created row whose
-- homeowner left while the EA stayed), or holds a valid, unexpired
-- invitation (a placeholder whose EA has also left keeps its invitation).
-- The identity core still refuses closed rows and reserved addresses.
-- Otherwise unchanged from 20261001130000.

create or replace function public.claim_operational_property(
  p_property_id bigint,
  p_invitation_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_property public.properties%rowtype;
  v_claimable boolean;
  v_hash text;
  v_invitation public.property_claim_invitations%rowtype;
  v_grant jsonb;
  v_onward jsonb;
  v_subject text;
  c_scope constant text := 'claim_property_failed';
  c_limit constant integer := 15;
  c_window constant integer := 900;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_subject := auth.uid()::text;

  -- Throttle checked before token/claimability evaluation → no token oracle.
  if public._rate_limit_is_blocked(c_scope, v_subject, c_limit, c_window) then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;

  if not exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.account_type = 'homeowner'
  ) then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'homeowner_only');
  end if;

  v_email := public.get_auth_user_email();

  if v_email is null or v_email = '' then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'email_required');
  end if;

  if nullif(trim(p_invitation_token), '') is not null then
    v_hash := public.hash_invitation_token(p_invitation_token);

    select *
    into v_invitation
    from public.property_claim_invitations pci
    where pci.property_id = p_property_id
      and pci.invitation_token_hash = v_hash
    order by pci.invitation_created_at desc
    limit 1;

    if v_invitation.id is null then
      perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
      return jsonb_build_object('ok', false, 'error', 'invalid_token');
    end if;

    if v_invitation.invitation_used_at is not null then
      perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
      return jsonb_build_object('ok', false, 'error', 'already_used');
    end if;

    if v_invitation.invitation_rejected_at is not null then
      perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
      return jsonb_build_object('ok', false, 'error', 'invitation_declined');
    end if;

    if v_invitation.invitation_revoked_at is not null then
      perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
      return jsonb_build_object('ok', false, 'error', 'invalid_token');
    end if;

    if v_invitation.invitation_expires_at <= now() then
      perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
      return jsonb_build_object('ok', false, 'error', 'expired');
    end if;
  end if;

  select exists (
    select 1
    from public.property_claim_metadata pcm
    where pcm.property_id = p_property_id
      and pcm.claim_status in ('unclaimed', 'claim_invited')
      and pcm.invite_email is not null
      and lower(trim(pcm.invite_email)) = v_email
      and (
        pcm.origin_type = 'estate_agent'
        or exists (
          select 1
          from public.property_ea_assignments pea
          where pea.property_id = pcm.property_id
            and pea.status = 'active'
        )
        or v_invitation.id is not null
        or (public.get_active_property_claim_invitation(pcm.property_id)).id is not null
      )
  )
  into v_claimable;

  if not v_claimable then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'not_claimable');
  end if;

  if exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = p_property_id
      and poi.status = 'active'
  ) then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id;

  if v_property.id is null then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  v_grant := public.establish_operational_homeowner(
    p_property_id,
    'claim_operational_property'
  );

  if not coalesce((v_grant ->> 'ok')::boolean, false) then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return v_grant;
  end if;

  if v_invitation.id is not null then
    update public.property_claim_invitations
    set
      invitation_used_at = now(),
      updated_at = now()
    where id = v_invitation.id
      and invitation_used_at is null;
  else
    update public.property_claim_invitations
    set
      invitation_used_at = now(),
      updated_at = now()
    where property_id = p_property_id
      and invitation_revoked_at is null
      and invitation_used_at is null
      and invitation_expires_at > now();
  end if;

  -- Isolated: a convergence failure must not roll back the claim.
  begin
    v_onward := public._converge_onward_purchase_after_claim(
      p_property_id,
      auth.uid()
    );
  exception
    when others then
      v_onward := jsonb_build_object('ok', false, 'onward_claimed', false);
  end;

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'chain_id', v_property.chain_id,
    'onward_claimed', coalesce((v_onward ->> 'onward_claimed')::boolean, false)
  );
end;
$$;

revoke all on function public.claim_operational_property(bigint, text) from public, anon;
grant execute on function public.claim_operational_property(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6g) update_property_claim_invite_email: the assigned EA of any unclaimed row
-- ---------------------------------------------------------------------------
-- The assigned branch may set the invite email of an EA-originated row (as
-- before) or of any row whose claim is open (a homeowner-created row whose
-- homeowner left while the EA stayed). A claimed row is refused. Otherwise
-- unchanged from 20260706000000.

create or replace function public.update_property_claim_invite_email(
  p_property_id bigint,
  p_invite_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_metadata public.property_claim_metadata%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.is_ea_assigned_to_property(p_property_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select *
  into v_metadata
  from public.property_claim_metadata pcm
  where pcm.property_id = p_property_id;

  if v_metadata.property_id is null then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  if v_metadata.origin_type <> 'estate_agent'
     and v_metadata.claim_status not in ('unclaimed', 'claim_invited')
  then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  v_email := nullif(trim(p_invite_email), '');

  update public.property_claim_metadata
  set
    invite_email = v_email,
    updated_at = now()
  where property_id = p_property_id;

  return jsonb_build_object(
    'ok', true,
    'invite_email', v_email
  );
end;
$$;

revoke all on function public.update_property_claim_invite_email(bigint, text) from public, anon;
grant execute on function public.update_property_claim_invite_email(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6h) reconnect_returning_ea_branch
-- ---------------------------------------------------------------------------
-- A branch whose assignment ended only because the appointing homeowner left
-- (revocation_reason = homeowner_left_cascade) may put itself back on the row
-- when: the row is not archived, released or anonymised; the seller side is
-- unrepresented now; the most recent assignment on the row is that branch's
-- (no other branch has been assigned since); the branch never acts for the
-- sale linking to the row; the caller is a verified member of the branch.
-- Rate limited; every success is audited. No access code or address is
-- accepted, so this is not a takeover path for other branches.

create table if not exists public.property_ea_reconnection_events (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties (id) on delete cascade,
  branch_id uuid not null references public.ea_branches (id) on delete restrict,
  actor_user_id uuid not null references auth.users (id),
  previous_assignment_id uuid not null references public.property_ea_assignments (id) on delete restrict,
  assignment_id uuid not null references public.property_ea_assignments (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists property_ea_reconnection_events_property_idx
  on public.property_ea_reconnection_events (property_id, created_at desc);

alter table public.property_ea_reconnection_events enable row level security;

revoke all on table public.property_ea_reconnection_events from public, anon, authenticated;
grant select, insert on table public.property_ea_reconnection_events to service_role;

comment on table public.property_ea_reconnection_events is
  'Audit of returning-branch reconnections (reconnect_returning_ea_branch). No client access.';

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
  v_uid uuid := auth.uid();
  v_property public.properties%rowtype;
  v_previous public.property_ea_assignments%rowtype;
  v_sides record;
  v_assignment_id uuid;
  c_scope constant text := 'reconnect_returning_ea_branch';
  c_limit constant integer := 10;
  c_window constant integer := 900;
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not public._rate_limit_try_consume(c_scope, v_uid::text, c_limit, c_window) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  if p_branch_id is null or not public.is_ea_branch_member(p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_ea_branch_member');
  end if;

  select *
  into v_property
  from public.properties
  where id = p_property_id
  for update;

  if v_property.id is null or v_property.stage = 'searching' then
    return jsonb_build_object('ok', false, 'error', 'not_reconnectable');
  end if;

  if exists (
    select 1
    from public.property_lifecycle_states pls
    where pls.property_id = v_property.id
      and pls.operational_state in ('archived', 'released', 'anonymised')
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_reconnectable');
  end if;

  select *
  into v_sides
  from public._property_side_representation(v_property.id);

  if v_sides.seller_side <> 'none' then
    return jsonb_build_object('ok', false, 'error', 'not_reconnectable');
  end if;

  select *
  into v_previous
  from public.property_ea_assignments pea
  where pea.property_id = v_property.id
  order by pea.assigned_at desc, pea.created_at desc
  limit 1
  for update;

  if v_previous.id is null
     or v_previous.branch_id is distinct from p_branch_id
     or v_previous.status = 'active'
     or v_previous.revocation_reason is distinct from 'homeowner_left_cascade'
  then
    return jsonb_build_object('ok', false, 'error', 'not_reconnectable');
  end if;

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
    return jsonb_build_object('ok', false, 'error', 'not_reconnectable');
  end if;

  insert into public.property_ea_assignments (
    property_id,
    branch_id,
    status,
    homeowner_only_updates,
    assigned_by_user_id
  )
  values (
    v_property.id,
    p_branch_id,
    'active',
    v_previous.homeowner_only_updates,
    v_uid
  )
  returning id into v_assignment_id;

  insert into public.property_ea_reconnection_events (
    property_id,
    branch_id,
    actor_user_id,
    previous_assignment_id,
    assignment_id
  )
  values (
    v_property.id,
    p_branch_id,
    v_uid,
    v_previous.id,
    v_assignment_id
  );

  perform public._insert_participation_delink_activity(
    v_property.id,
    'Estate agent branch reconnected to this property.',
    'system'
  );

  return jsonb_build_object(
    'ok', true,
    'property_id', v_property.id,
    'assignment_id', v_assignment_id
  );
end;
$$;

alter function public.reconnect_returning_ea_branch(bigint, uuid) owner to postgres;

comment on function public.reconnect_returning_ea_branch(bigint, uuid) is
  'A branch whose assignment ended through the homeowner-leave cascade reconnects to the same unreleased, seller-unrepresented row when no other branch has been assigned since. Verified branch member, rate limited, audited in property_ea_reconnection_events. Failures are generic (not_reconnectable).';

revoke all on function public.reconnect_returning_ea_branch(bigint, uuid) from public, anon;
grant execute on function public.reconnect_returning_ea_branch(bigint, uuid) to authenticated;

-- The returning-branch journey: the caller's own branches' rows that
-- reconnect_returning_ea_branch would currently accept, with only what the
-- branch already held (address, postcode, when its assignment ended). Takes
-- no input, so no address or access code can be used to discover a row.
-- Read-only and grants nothing; reconnect_returning_ea_branch re-checks
-- every condition under lock.
create index if not exists property_ea_assignments_homeowner_left_cascade_idx
  on public.property_ea_assignments (branch_id)
  where revocation_reason = 'homeowner_left_cascade';

create or replace function public.list_reconnectable_ea_properties()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email_gate jsonb;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  return jsonb_build_object(
    'ok', true,
    'properties', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'property_id', p.id,
          'branch_id', pea.branch_id,
          'branch_name', b.name,
          'address', p.address,
          'postcode', p.postcode,
          'assignment_ended_at', pea.revoked_at
        )
        order by pea.revoked_at desc nulls last, p.id
      )
      from public.ea_branch_members bm
      inner join public.property_ea_assignments pea
        on pea.branch_id = bm.branch_id
       and pea.revocation_reason = 'homeowner_left_cascade'
       and pea.status <> 'active'
      inner join public.ea_branches b
        on b.id = pea.branch_id
      inner join public.properties p
        on p.id = pea.property_id
      where bm.user_id = v_uid
        and p.stage is distinct from 'searching'
        and not exists (
          select 1
          from public.property_ea_assignments later
          where later.property_id = pea.property_id
            and later.id <> pea.id
            and (later.assigned_at, later.created_at) >= (pea.assigned_at, pea.created_at)
        )
        and not exists (
          select 1
          from public.property_lifecycle_states pls
          where pls.property_id = p.id
            and pls.operational_state in ('archived', 'released', 'anonymised')
        )
        and (
          select s.seller_side
          from public._property_side_representation(p.id) s
        ) = 'none'
        and not exists (
          select 1
          from public.properties s
          inner join public.property_ea_assignments spea
            on spea.property_id = s.id
          where s.chain_id = p.chain_id
            and s.linked_property_id = p.id
            and spea.branch_id = pea.branch_id
            and spea.status = 'active'
        )
    ), '[]'::jsonb)
  );
end;
$$;

alter function public.list_reconnectable_ea_properties() owner to postgres;

comment on function public.list_reconnectable_ea_properties() is
  'Read-only: the caller''s own branches'' rows that reconnect_returning_ea_branch would currently accept (latest assignment on the row was this branch''s, ended by homeowner_left_cascade; row not searching, archived, released or anonymised; seller side unrepresented; branch not acting for the linking sale). No input; grants nothing. Verified email required.';

revoke all on function public.list_reconnectable_ea_properties() from public, anon;
grant execute on function public.list_reconnectable_ea_properties() to authenticated;

-- ---------------------------------------------------------------------------
-- 6i) _gdpr_remove_subject_property_links: tag EA revocations
-- ---------------------------------------------------------------------------
-- An assignment revoked because the erased subject is a member of the branch
-- is tagged branch_member_erased; one revoked because the subject appointed
-- it (the homeowner leaving) is tagged homeowner_left_cascade, which lets the
-- branch reconnect. Otherwise unchanged from 20260718130000.

create or replace function public._gdpr_remove_subject_property_links(
  p_subject_user_id uuid,
  p_property_id bigint,
  p_erasure_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chain_id bigint;
  v_safety text;
begin
  v_safety := public._gdpr_shared_transaction_safety_block(
    p_subject_user_id,
    p_property_id,
    'REMOVE_PERSON_PROPERTY_LINK'
  );

  select chain_id into v_chain_id
  from public.properties
  where id = p_property_id;

  update public.property_operational_identities
  set
    status = 'released',
    delinked_at = coalesce(delinked_at, now()),
    updated_at = now()
  where property_id = p_property_id
    and homeowner_user_id = p_subject_user_id
    and status = 'active';

  delete from public.property_members
  where property_id = p_property_id
    and user_id = p_subject_user_id;

  update public.property_counterparty_participants
  set
    status = 'delinked',
    delinked_at = coalesce(delinked_at, now())
  where property_id = p_property_id
    and user_id = p_subject_user_id
    and status = 'active';

  update public.property_delegates
  set
    status = 'revoked',
    revoked_at = coalesce(revoked_at, now()),
    updated_at = now()
  where property_id = p_property_id
    and status in ('pending', 'active')
    and (delegate_user_id = p_subject_user_id or invited_by_user_id = p_subject_user_id);

  update public.property_ea_assignments pea
  set
    status = 'revoked',
    revoked_at = coalesce(revoked_at, now()),
    revocation_reason = case
      when exists (
        select 1
        from public.ea_branch_members bm
        where bm.branch_id = pea.branch_id
          and bm.user_id = p_subject_user_id
      ) then 'branch_member_erased'
      else 'homeowner_left_cascade'
    end,
    updated_at = now()
  where pea.property_id = p_property_id
    and pea.status = 'active'
    and (
      pea.assigned_by_user_id = p_subject_user_id
      or exists (
        select 1
        from public.ea_branch_members bm
        where bm.branch_id = pea.branch_id
          and bm.user_id = p_subject_user_id
      )
    );

  update public.property_claim_metadata pcm
  set
    invite_email = case
      when pcm.originated_by_user_id = p_subject_user_id
        or pcm.claimed_by_user_id = p_subject_user_id then null
      else pcm.invite_email
    end,
    invite_display_name = case
      when pcm.originated_by_user_id = p_subject_user_id
        or pcm.claimed_by_user_id = p_subject_user_id then null
      else pcm.invite_display_name
    end,
    originated_by_user_id = case
      when pcm.originated_by_user_id = p_subject_user_id then null
      else pcm.originated_by_user_id
    end,
    claimed_by_user_id = case
      when pcm.claimed_by_user_id = p_subject_user_id then null
      else pcm.claimed_by_user_id
    end,
    updated_at = now()
  where pcm.property_id = p_property_id;

  update public.properties
  set created_by_user_id = null
  where id = p_property_id
    and created_by_user_id = p_subject_user_id;

  perform public._gdpr_erasure_audit(
    p_erasure_request_id,
    'person_property_link_removed',
    jsonb_build_object(
      'property_id', p_property_id,
      'chain_id', v_chain_id,
      'subject_user_id', p_subject_user_id,
      'mechanism', 'gdpr_rtbf_not_participation_delink',
      'shared_safety_note', v_safety
    )
  );

  return jsonb_build_object(
    'ok', true,
    'property_id', p_property_id,
    'shared_safety_note', v_safety
  );
end;
$$;

comment on function public._gdpr_remove_subject_property_links(uuid, bigint, uuid) is
  'Removes subject person-property links for GDPR RTBF. Audits via gdpr_erasure_audit_events, not property_delink_events. EA revocations are tagged homeowner_left_cascade or branch_member_erased.';

revoke all on function public._gdpr_remove_subject_property_links(uuid, bigint, uuid) from public, anon, authenticated;
grant execute on function public._gdpr_remove_subject_property_links(uuid, bigint, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7) Postflight: no client write path is authorised by membership; the
--    reservation trigger is installed
-- ---------------------------------------------------------------------------

do $$
declare
  v_offenders text[];
begin
  select array_agg(pol.tablename || '.' || pol.policyname order by pol.tablename, pol.policyname)
  into v_offenders
  from pg_policies pol
  where pol.schemaname = 'public'
    and pol.tablename in (
      'properties',
      'activities',
      'chain_nodes',
      'chains',
      'chain_completion_events',
      'property_ea_assignments',
      'operational_delays'
    )
    and pol.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    and (
      coalesce(pol.qual, '') ~ '(is_property_member|is_chain_participant|is_ea_delegated_editor|is_chain_operational_viewer|property_members)'
      or coalesce(pol.with_check, '') ~ '(is_property_member|is_chain_participant|is_ea_delegated_editor|is_chain_operational_viewer|property_members)'
    );

  if v_offenders is not null then
    raise exception
      'operational_authority postflight: membership-based write policies remain (%)',
      array_to_string(v_offenders, ', ');
  end if;

  select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
  into v_offenders
  from pg_proc p
  where p.oid in (
      to_regprocedure('public.break_chain_connection(bigint, text)'),
      to_regprocedure('public.report_operational_delay(text, bigint, bigint, text)'),
      to_regprocedure('public.resolve_operational_delay(bigint, text)'),
      to_regprocedure('public.link_sale_to_searching_placeholder(bigint, bigint)'),
      to_regprocedure('public.establish_connected_hop(bigint)'),
      to_regprocedure('public.upsert_operational_summaries(jsonb, jsonb)'),
      to_regprocedure('public.caller_may_place_property_in_chain(bigint)'),
      to_regprocedure('public._trg_properties_guard_direct_writes()')
    )
    and p.prosrc ~ '(is_property_member|is_chain_participant|is_ea_delegated_editor|is_property_operational_participant|is_chain_operational_viewer)';

  if v_offenders is not null then
    raise exception
      'operational_authority postflight: membership-based RPC authority remains (%)',
      array_to_string(v_offenders, ', ');
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name = 'property_ea_assignments'
      and g.grantee in ('anon', 'authenticated')
      and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception
      'operational_authority postflight: client write grants remain on property_ea_assignments';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.properties'::regclass
      and t.tgname = 'trg_properties_address_reservation'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception
      'operational_authority postflight: trg_properties_address_reservation missing or disabled';
  end if;

  if not exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure('public._trg_properties_address_reservation()')
      and p.prosecdef
  ) then
    raise exception
      'operational_authority postflight: _trg_properties_address_reservation is not SECURITY DEFINER';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.properties'::regclass
      and t.tgname = 'trg_properties_address_reservation'
      and pg_get_triggerdef(t.oid) like '%linked_property_id%'
      and pg_get_triggerdef(t.oid) like '%chain_id%'
  ) then
    raise exception
      'operational_authority postflight: trg_properties_address_reservation does not fire on link or chain changes';
  end if;

  select array_agg(v_check.signature order by v_check.signature)
  into v_offenders
  from (values
    ('public._establish_operational_homeowner_core(bigint, uuid, text, boolean)', '%property_released%_address_reservation_conflict%'),
    ('public._grant_counterparty_participation_core(bigint, uuid)', '%property_released%'),
    ('public._execute_participation_delink(bigint, text, text, uuid)', '%for update%_property_placeholder_has_dependants%is_property_seller_side_homeowner%homeowner_removed_ea%branch_left%_ea_homeowner_withdrawal_status%'),
    ('public._ea_homeowner_withdrawal_status(bigint)', '%not_seller_side_row%homeowner_not_invited%homeowner_has_meaningful_participation%'),
    ('public.get_participation_delink_options(bigint)', '%is_property_seller_side_homeowner%_ea_homeowner_withdrawal_status%'),
    ('public.is_allowed_structured_activity_update(text)', '%The onward purchase was unlinked from this sale because that address is now part of another MoveLoop chain.%Estate agent branch reconnected to this property.%'),
    ('public.discover_claimable_properties()', '%active_assignment.branch_id is not null%operational_state in (''archived'', ''released'', ''anonymised'')%'),
    ('public.claim_operational_property(bigint, text)', '%pea.status = ''active''%get_active_property_claim_invitation%'),
    ('public.update_property_claim_invite_email(bigint, text)', '%claim_status not in (''unclaimed'', ''claim_invited'')%'),
    ('public.reconnect_returning_ea_branch(bigint, uuid)', '%for update%homeowner_left_cascade%property_ea_reconnection_events%'),
    ('public.list_reconnectable_ea_properties()', '%_require_verified_email_for_transaction%homeowner_left_cascade%bm.user_id = v_uid%operational_state in (''archived'', ''released'', ''anonymised'')%_property_side_representation%linked_property_id%'),
    ('public._gdpr_remove_subject_property_links(uuid, bigint, uuid)', '%branch_member_erased%homeowner_left_cascade%')
  ) as v_check(signature, fingerprint)
  where not exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure(v_check.signature)
      and p.prosrc like v_check.fingerprint
  );

  if v_offenders is not null then
    raise exception
      'operational_authority postflight: grant/delink hardening missing (%)',
      array_to_string(v_offenders, ', ');
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.property_ea_assignments'::regclass
      and t.tgname = 'trg_property_ea_assignments_revocation_reason'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception
      'operational_authority postflight: trg_property_ea_assignments_revocation_reason missing or disabled';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name = 'property_ea_reconnection_events'
      and g.grantee in ('anon', 'authenticated')
  ) then
    raise exception
      'operational_authority postflight: client grants on property_ea_reconnection_events';
  end if;

  if has_function_privilege('authenticated', 'public._ea_homeowner_withdrawal_status(bigint)', 'execute')
     or has_function_privilege('anon', 'public._ea_homeowner_withdrawal_status(bigint)', 'execute')
  then
    raise exception
      'operational_authority postflight: _ea_homeowner_withdrawal_status is client-executable';
  end if;

  if has_function_privilege('anon', 'public.list_reconnectable_ea_properties()', 'execute')
     or has_function_privilege('anon', 'public.reconnect_returning_ea_branch(bigint, uuid)', 'execute')
  then
    raise exception
      'operational_authority postflight: returning-branch reconnect is anon-executable';
  end if;

  if exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure('public.list_reconnectable_ea_properties()')
      and (p.provolatile <> 's' or p.pronargs <> 0)
  ) then
    raise exception
      'operational_authority postflight: list_reconnectable_ea_properties must be stable and take no input';
  end if;
end;
$$;
