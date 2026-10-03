-- M2: seller-side authority and awaiting connection.
--
-- Authority model:
--   The seller side of a row is the person selling it: the operational identity
--   holder on a sale; the active counterparty seller on a purchase. A row with
--   a seller-side homeowner is operated by that homeowner, and by their actively
--   assigned EA branch only while homeowner_only_updates is false. A row with no
--   seller-side homeowner is operated by its actively assigned EA branch (EA-only).
--   Buyers, plain members and viewers never operate a row they are buying or
--   viewing. EA authority on one row never extends to the row it links to.
--
--   _property_seller_side_user_id(bigint)            (new, service_role)
--   is_property_seller_side_homeowner(bigint)        (new predicate)
--   can_operate_property(bigint)                     (new predicate)
--   property_counterparty_participants_one_active_role_idx
--     One active counterparty per (property, role). Aborts if existing data violates it.
--   _converge_onward_purchase_after_seller_join(bigint, uuid)   (new, service_role)
--     When a seller joins a purchase, an onward row linked from it that the
--     purchase's assigned EA branch created, and that has never been owned,
--     follows the joining seller as buyer.
--   _grant_counterparty_participation_core           [20261001130000]
--     Opposite side must be represented (replaces no_operational_homeowner);
--     slot_held when the role is taken; seller join converges the onward row.
--   join_chain_property                              [20260729120000]
--     Address and postcode compared on the normalised match keys.
--   connect_ea_to_awaiting_property(text, text, text, uuid)     (new RPC)
--     The seller's EA connects to an awaiting_seller purchase by access code.
--     Writes the assignment only.
--   ea_operational_assignments                       [20260612000000]
--     subject_user_id is the seller-side homeowner.
--   create_searching_placeholder_for_sale            [20261001110000]
--   link_sale_to_searching_placeholder               [20261001130000]
--   convert_searching_placeholder_for_sale           [20261001130000]
--     Anchor may be a sale or a purchase row the caller can operate; the new
--     purchase's buyer is the anchor's seller-side homeowner, else unowned.
--     Link keeps its sale-row member / delegated EA / creator arms.
--   _create_ea_operational_property_core             [20260905120000]
--     Sale only: create_ea_operational_property and join_ea_operational_chain
--     reject relationship_type = 'purchase'.
--
-- Requires: 20261005100000_address_reservation_classifier.sql.

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text[] := array[]::text[];
  v_name text;
  v_src text;
  v_view text;
  v_duplicates integer;
begin
  foreach v_name in array array[
    'auth.uid()',
    'public._address_match_key(text)',
    'public._postcode_match_key(text)',
    'public._property_side_representation(bigint)',
    'public._property_reservation_state(bigint)',
    'public._is_estate_agent_account(uuid)',
    'public._establish_operational_homeowner_core(bigint, uuid, text, boolean)',
    'public._upsert_property_membership_row(bigint, uuid, text)',
    'public._access_code_lookup_candidates(text)',
    'public._rate_limit_is_blocked(text, text, integer, integer)',
    'public._rate_limit_record_attempt(text, text, integer)',
    'public._require_verified_email_for_transaction()',
    'public._ea_assign_originated_property(bigint, uuid, boolean, text, text, text)',
    'public.is_ea_branch_member(uuid)',
    'public.is_property_member(bigint)',
    'public.is_ea_delegated_editor_on_property(bigint)',
    'public.get_next_chain_position(bigint)',
    'public.property_exists_for_onboarding(text, text, bigint)'
  ]
  loop
    if to_regprocedure(v_name) is null then
      v_missing := array_append(v_missing, v_name);
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception
      'seller_side_authority aborted: missing dependencies (%)',
      array_to_string(v_missing, ', ');
  end if;

  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public._grant_counterparty_participation_core(bigint, uuid)');

  if v_src not like '%''no_operational_homeowner''%'
     or v_src not like '%''estate_agent_cannot_be_counterparty''%'
  then
    raise exception
      'seller_side_authority aborted: _grant_counterparty_participation_core body differs from 20261001130000';
  end if;

  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public.join_chain_property(text, text, text)');

  if v_src not like '%and p.address = p_address%'
     or v_src not like '%''join_chain_failed''%'
  then
    raise exception
      'seller_side_authority aborted: join_chain_property body differs from 20260729120000';
  end if;

  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public.create_searching_placeholder_for_sale(bigint)');

  if v_src not like '%public.is_ea_assigned_to_property(p_sale_property_id)%'
     or v_src not like '%''sale_already_linked''%'
  then
    raise exception
      'seller_side_authority aborted: create_searching_placeholder_for_sale body differs from 20261001110000';
  end if;

  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public.link_sale_to_searching_placeholder(bigint, bigint)');

  if v_src not like '%v_sale.relationship_type <> ''sale''%'
     or v_src not like '%''placeholder_owner_mismatch''%'
  then
    raise exception
      'seller_side_authority aborted: link_sale_to_searching_placeholder body differs from 20261001130000';
  end if;

  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public.convert_searching_placeholder_for_sale(bigint, text, text)');

  if v_src not like '%public.is_property_operational_homeowner(p_sale_property_id)%'
     or v_src not like '%''convert_placeholder''%'
  then
    raise exception
      'seller_side_authority aborted: convert_searching_placeholder_for_sale body differs from 20261001130000';
  end if;

  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public._create_ea_operational_property_core(bigint, text, text, text, uuid, boolean, text, text, boolean)');

  if v_src not like '%p_relationship_type not in (''sale'', ''purchase'')%' then
    raise exception
      'seller_side_authority aborted: _create_ea_operational_property_core body differs from 20260905120000';
  end if;

  v_view := pg_get_viewdef('public.ea_operational_assignments'::regclass, true);

  if v_view not like '%get_property_operational_owner_user_id(pea.property_id) AS subject_user_id%' then
    raise exception
      'seller_side_authority aborted: ea_operational_assignments differs from 20260612000000';
  end if;

  select count(*)
  into v_duplicates
  from (
    select cp.property_id, cp.counterparty_role
    from public.property_counterparty_participants cp
    where cp.status = 'active'
    group by cp.property_id, cp.counterparty_role
    having count(*) > 1
  ) d;

  if v_duplicates > 0 then
    raise exception
      'seller_side_authority aborted: % properties have more than one active counterparty in the same role',
      v_duplicates;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Seller-side helpers
-- ---------------------------------------------------------------------------

create or replace function public._property_seller_side_user_id(p_property_id bigint)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case p.relationship_type
    when 'sale' then (
      select poi.homeowner_user_id
      from public.property_operational_identities poi
      where poi.property_id = p.id
        and poi.status = 'active'
    )
    when 'purchase' then (
      select case when count(*) = 1 then (array_agg(cp.user_id))[1] end
      from public.property_counterparty_participants cp
      where cp.property_id = p.id
        and cp.counterparty_role = 'seller'
        and cp.status = 'active'
    )
  end
  from public.properties p
  where p.id = p_property_id;
$$;

comment on function public._property_seller_side_user_id(bigint) is
  'The seller-side homeowner of a row: the active identity holder on a sale; the single active counterparty seller on a purchase. Null when there is none. Internal; service_role only.';

revoke all on function public._property_seller_side_user_id(bigint) from public, anon, authenticated;
grant execute on function public._property_seller_side_user_id(bigint) to service_role;

create or replace function public.is_property_seller_side_homeowner(p_property_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and coalesce(public._property_seller_side_user_id(p_property_id) = auth.uid(), false);
$$;

comment on function public.is_property_seller_side_homeowner(bigint) is
  'True when the caller is the seller-side homeowner of the row (sale identity holder, or purchase counterparty seller).';

revoke all on function public.is_property_seller_side_homeowner(bigint) from public, anon;
grant execute on function public.is_property_seller_side_homeowner(bigint) to authenticated, service_role;

create or replace function public.can_operate_property(p_property_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select
      p.id,
      public._property_seller_side_user_id(p.id) as seller_user_id
    from public.properties p
    where p.id = p_property_id
      and p.stage is distinct from 'searching'
  )
  select auth.uid() is not null
    and exists (
      select 1
      from target t
      where t.seller_user_id = auth.uid()
        or exists (
          select 1
          from public.property_ea_assignments pea
          inner join public.ea_branch_members bm
            on bm.branch_id = pea.branch_id
          where pea.property_id = t.id
            and pea.status = 'active'
            and bm.user_id = auth.uid()
            and (
              pea.homeowner_only_updates = false
              or t.seller_user_id is null
            )
        )
    );
$$;

comment on function public.can_operate_property(bigint) is
  'True when the caller may operate the row: its seller-side homeowner, or a member of its actively assigned EA branch when the homeowner allows EA updates or no seller-side homeowner is connected (EA-only). Searching placeholders are never operable.';

revoke all on function public.can_operate_property(bigint) from public, anon;
grant execute on function public.can_operate_property(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) One active counterparty per (property, role)
-- ---------------------------------------------------------------------------

create unique index if not exists property_counterparty_participants_one_active_role_idx
  on public.property_counterparty_participants (property_id, counterparty_role)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- 3) Seller join convergence
-- ---------------------------------------------------------------------------

create or replace function public._converge_onward_purchase_after_seller_join(
  p_purchase_property_id bigint,
  p_seller_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase public.properties%rowtype;
  v_onward public.properties%rowtype;
  v_grant jsonb;
begin
  select *
  into v_purchase
  from public.properties
  where id = p_purchase_property_id;

  if v_purchase.id is null
     or v_purchase.relationship_type is distinct from 'purchase'
     or v_purchase.linked_property_id is null
  then
    return jsonb_build_object('ok', true, 'onward_claimed', false);
  end if;

  select *
  into v_onward
  from public.properties
  where id = v_purchase.linked_property_id;

  if v_onward.id is null
     or v_onward.chain_id is distinct from v_purchase.chain_id
     or v_onward.relationship_type is distinct from 'purchase'
     or not public._is_estate_agent_account(v_onward.created_by_user_id)
  then
    return jsonb_build_object('ok', true, 'onward_claimed', false);
  end if;

  if not exists (
    select 1
    from public.property_ea_assignments pea
    inner join public.ea_branch_members bm
      on bm.branch_id = pea.branch_id
    where pea.property_id = v_purchase.id
      and pea.status = 'active'
      and bm.user_id = v_onward.created_by_user_id
  ) then
    return jsonb_build_object('ok', true, 'onward_claimed', false);
  end if;

  if exists (
    select 1
    from public.property_operational_identities poi
    where poi.property_id = v_onward.id
  ) then
    return jsonb_build_object('ok', true, 'onward_claimed', false);
  end if;

  v_grant := public._establish_operational_homeowner_core(
    v_onward.id,
    p_seller_user_id,
    'ea_origination_claim',
    false
  );

  if not coalesce((v_grant ->> 'ok')::boolean, false) then
    return jsonb_build_object(
      'ok', false,
      'onward_claimed', false,
      'error', coalesce(v_grant ->> 'error', 'grant_failed')
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'onward_claimed', true,
    'onward_property_id', v_onward.id
  );
end;
$$;

comment on function public._converge_onward_purchase_after_seller_join(bigint, uuid) is
  'Internal: after a seller joins a purchase, grants the linked same-chain onward purchase to the seller when it was created by a member of the purchase''s assigned EA branch and has never been owned.';

revoke all on function public._converge_onward_purchase_after_seller_join(bigint, uuid) from public, anon, authenticated;
grant execute on function public._converge_onward_purchase_after_seller_join(bigint, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4) _grant_counterparty_participation_core: opposite-side rule, slot_held
-- ---------------------------------------------------------------------------

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
  'Internal: grants the counterparty role on a row (buyer on a sale, seller on a purchase). The opposite side must be represented, the role must be free, and estate agents and the row''s own homeowner are refused. A seller joining a purchase converges its EA-created, never-owned onward purchase.';

revoke all on function public._grant_counterparty_participation_core(bigint, uuid) from public, anon, authenticated;
grant execute on function public._grant_counterparty_participation_core(bigint, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5) join_chain_property: normalised address match
-- ---------------------------------------------------------------------------

create or replace function public.join_chain_property(
  p_access_code text,
  p_address text,
  p_postcode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_property public.properties%rowtype;
  v_counterparty_role text;
  v_grant jsonb;
  v_email_gate jsonb;
  v_candidates text[];
  v_subject text;
  c_scope constant text := 'join_chain_failed';
  c_limit constant integer := 10;
  c_window constant integer := 900;
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_subject := v_user_id::text;

  -- Check BEFORE match so throttled valid/invalid codes are indistinguishable.
  if public._rate_limit_is_blocked(c_scope, v_subject, c_limit, c_window) then
    return jsonb_build_object('ok', false, 'error', 'join_details_not_matched');
  end if;

  v_candidates := public._access_code_lookup_candidates(p_access_code);

  if coalesce(array_length(v_candidates, 1), 0) = 0 then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'join_details_not_matched');
  end if;

  select p.*
  into v_property
  from public.properties p
  inner join public.chains c
    on c.id = p.chain_id
  where c.access_code = any (v_candidates)
    and public._address_match_key(p.address) = public._address_match_key(p_address)
    and public._postcode_match_key(p.postcode) = public._postcode_match_key(p_postcode)
  limit 1;

  if v_property.id is null then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'join_details_not_matched');
  end if;

  v_grant := public._grant_counterparty_participation_core(
    v_property.id,
    v_user_id
  );

  if not coalesce((v_grant ->> 'ok')::boolean, false) then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'join_details_not_matched');
  end if;

  v_counterparty_role := v_grant ->> 'counterparty_role';

  update public.properties
  set
    status = 'healthy',
    buyer_connected = case
      when v_property.relationship_type in ('sale', 'purchase') then true
      else buyer_connected
    end,
    seller_connected = case
      when v_property.relationship_type = 'purchase' then true
      else seller_connected
    end
  where id = v_property.id;

  select *
  into v_property
  from public.properties
  where id = v_property.id;

  -- Successful joins do not consume failed-attempt allowance.
  return jsonb_build_object(
    'ok', true,
    'property_id', v_property.id,
    'chain_id', v_property.chain_id,
    'linked_property_id', v_property.linked_property_id,
    'relationship_type', v_property.relationship_type,
    'joining_role', v_counterparty_role
  );
end;
$$;

comment on function public.join_chain_property(text, text, text) is
  'Join via access code + address + postcode (normalised match keys). Failed attempts rate-limited 10/15min/user; public failures remain join_details_not_matched.';

revoke all on function public.join_chain_property(text, text, text) from public;
grant execute on function public.join_chain_property(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) connect_ea_to_awaiting_property
-- ---------------------------------------------------------------------------
-- Shares the join_chain_failed budget so the two access-code entry points
-- cannot be combined to probe codes faster.

create or replace function public.connect_ea_to_awaiting_property(
  p_access_code text,
  p_address text,
  p_postcode text,
  p_branch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email_gate jsonb;
  v_user_id uuid;
  v_subject text;
  v_candidates text[];
  v_row record;
  v_property public.properties%rowtype;
  c_scope constant text := 'join_chain_failed';
  c_limit constant integer := 10;
  c_window constant integer := 900;
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_branch_id is null or not public.is_ea_branch_member(p_branch_id) then
    return jsonb_build_object('ok', false, 'error', 'not_ea_branch_member');
  end if;

  v_subject := v_user_id::text;

  if public._rate_limit_is_blocked(c_scope, v_subject, c_limit, c_window) then
    return jsonb_build_object('ok', false, 'error', 'join_details_not_matched');
  end if;

  v_candidates := public._access_code_lookup_candidates(p_access_code);

  if coalesce(array_length(v_candidates, 1), 0) = 0 then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'join_details_not_matched');
  end if;

  for v_row in
    select p.id
    from public.properties p
    inner join public.chains c
      on c.id = p.chain_id
    where c.access_code = any (v_candidates)
      and p.relationship_type = 'purchase'
      and public._address_match_key(p.address) = public._address_match_key(p_address)
      and public._postcode_match_key(p.postcode) = public._postcode_match_key(p_postcode)
    order by p.id
  loop
    if public._property_reservation_state(v_row.id) = 'awaiting_seller' then
      select *
      into v_property
      from public.properties
      where id = v_row.id
      for update;

      exit;
    end if;
  end loop;

  if v_property.id is null
     or public._property_reservation_state(v_property.id) is distinct from 'awaiting_seller'
     or exists (
       select 1
       from public.property_ea_assignments pea
       where pea.property_id = v_property.id
         and pea.status = 'active'
     )
     -- The branch acting for the buyer's sale cannot also take the seller side.
     or exists (
       select 1
       from public.properties s
       inner join public.property_ea_assignments spea
         on spea.property_id = s.id
       where s.chain_id = v_property.chain_id
         and s.linked_property_id = v_property.id
         and spea.branch_id = p_branch_id
         and spea.status = 'active'
     )
  then
    perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
    return jsonb_build_object('ok', false, 'error', 'join_details_not_matched');
  end if;

  begin
    insert into public.property_ea_assignments (
      property_id,
      branch_id,
      status,
      assigned_by_user_id
    )
    values (
      v_property.id,
      p_branch_id,
      'active',
      v_user_id
    );
  exception
    when unique_violation then
      perform public._rate_limit_record_attempt(c_scope, v_subject, c_window);
      return jsonb_build_object('ok', false, 'error', 'join_details_not_matched');
  end;

  return jsonb_build_object(
    'ok', true,
    'property_id', v_property.id,
    'chain_id', v_property.chain_id
  );
end;
$$;

comment on function public.connect_ea_to_awaiting_property(text, text, text, uuid) is
  'The seller''s EA connects a branch to a purchase awaiting its seller, proven by chain access code + normalised address. Writes the assignment only (homeowner_only_updates takes the table default); no identity, no claim metadata. Refuses rows with any active assignment and the branch acting for the buyer''s sale. Failures are generic and share the join_chain_failed budget.';

revoke all on function public.connect_ea_to_awaiting_property(text, text, text, uuid) from public, anon;
grant execute on function public.connect_ea_to_awaiting_property(text, text, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) ea_operational_assignments: seller-side subject
-- ---------------------------------------------------------------------------
-- Inlines _property_seller_side_user_id: functions called by a view are
-- checked against the querying role, and the helper is service_role only.

create or replace view public.ea_operational_assignments
with (security_invoker = false)
as
select
  pea.property_id,
  p.chain_id,
  pea.homeowner_only_updates,
  case p.relationship_type
    when 'sale' then (
      select poi.homeowner_user_id
      from public.property_operational_identities poi
      where poi.property_id = pea.property_id
        and poi.status = 'active'
    )
    when 'purchase' then (
      select case when count(*) = 1 then (array_agg(cp.user_id))[1] end
      from public.property_counterparty_participants cp
      where cp.property_id = pea.property_id
        and cp.counterparty_role = 'seller'
        and cp.status = 'active'
    )
  end as subject_user_id,
  coalesce(pcm.claim_status, 'claimed') as claim_status,
  pcm.origin_type
from public.property_ea_assignments pea
inner join public.properties p
  on p.id = pea.property_id
left join public.property_claim_metadata pcm
  on pcm.property_id = pea.property_id
where
  auth.uid() is not null
  and pea.status = 'active'
  and exists (
    select 1
    from public.ea_branch_members bm
    where bm.branch_id = pea.branch_id
      and bm.user_id = auth.uid()
  );

comment on view public.ea_operational_assignments is
  'Branch-scoped EA assignments with the seller-side homeowner as subject (sale identity holder, or purchase counterparty seller) and claim status.';

-- ---------------------------------------------------------------------------
-- 8) create_searching_placeholder_for_sale: operable sale or purchase anchor
-- ---------------------------------------------------------------------------

create or replace function public.create_searching_placeholder_for_sale(
  p_sale_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email_gate jsonb;
  v_sale public.properties%rowtype;
  v_linked public.properties%rowtype;
  v_owner uuid;
  v_placeholder_id bigint;
  v_grant jsonb;
begin
  v_email_gate := public._require_verified_email_for_transaction();

  if v_email_gate is not null then
    return v_email_gate;
  end if;

  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select *
  into v_sale
  from public.properties
  where id = p_sale_property_id
  for update;

  if v_sale.id is null then
    return jsonb_build_object('ok', false, 'error', 'sale_not_found');
  end if;

  if v_sale.relationship_type is null
     or v_sale.relationship_type not in ('sale', 'purchase')
     or v_sale.stage = 'searching'
     or v_sale.chain_id is null
  then
    return jsonb_build_object('ok', false, 'error', 'invalid_sale');
  end if;

  if not public.can_operate_property(p_sale_property_id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  if v_sale.linked_property_id is not null then
    select *
    into v_linked
    from public.properties
    where id = v_sale.linked_property_id;

    if v_linked.id is not null
       and v_linked.chain_id = v_sale.chain_id
       and v_linked.stage = 'searching'
       and v_linked.address is null
       and v_linked.postcode is null
    then
      return jsonb_build_object(
        'ok', true,
        'property_id', v_linked.id,
        'created', false
      );
    end if;

    return jsonb_build_object('ok', false, 'error', 'sale_already_linked');
  end if;

  v_owner := public._property_seller_side_user_id(p_sale_property_id);

  if v_owner is not null and public._is_estate_agent_account(v_owner) then
    v_owner := null;
  end if;

  begin
    insert into public.properties (
      chain_id,
      chain_position,
      stage,
      address,
      postcode,
      relationship_type,
      status,
      created_by_user_id,
      linked_property_id,
      awaiting_buyer,
      buyer_connected,
      seller_connected,
      is_searching,
      is_current_user,
      last_updated_days
    )
    values (
      v_sale.chain_id,
      public.get_next_chain_position(v_sale.chain_id),
      'searching',
      null,
      null,
      'purchase',
      'pending_connection',
      auth.uid(),
      null,
      false,
      false,
      true,
      true,
      true,
      0
    )
    returning id
    into v_placeholder_id;

    update public.properties
    set linked_property_id = v_placeholder_id
    where id = p_sale_property_id;

    if v_owner is not null then
      v_grant := public._establish_operational_homeowner_core(
        v_placeholder_id,
        v_owner,
        case when v_owner = auth.uid() then 'start_move' else 'ea_origination_claim' end,
        false
      );

      if not coalesce((v_grant ->> 'ok')::boolean, false) then
        raise exception using
          errcode = 'SP001',
          message = coalesce(v_grant ->> 'error', 'grant_failed');
      end if;
    end if;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'searching_placeholder_exists');
    when sqlstate 'SP001' then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;

  return jsonb_build_object(
    'ok', true,
    'property_id', v_placeholder_id,
    'created', true,
    'owned', v_owner is not null
  );
end;
$$;

comment on function public.create_searching_placeholder_for_sale(bigint) is
  'Creates (or returns) the searching placeholder linked from an anchor row: a sale, or a purchase the caller sells. Authorised by can_operate_property on the anchor. Grants an identity only to the anchor''s seller-side homeowner; estate agents never receive one.';

revoke all on function public.create_searching_placeholder_for_sale(bigint) from public, anon;
grant execute on function public.create_searching_placeholder_for_sale(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 9) link_sale_to_searching_placeholder: operable anchor; sale arms kept
-- ---------------------------------------------------------------------------

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

  v_sale_owner := public._property_seller_side_user_id(p_sale_property_id);

  if not (
    public.can_operate_property(p_sale_property_id)
    or (
      v_sale.relationship_type = 'sale'
      and (
        public.is_property_member(p_sale_property_id)
        or public.is_ea_delegated_editor_on_property(p_sale_property_id)
        or (
          v_sale.created_by_user_id = auth.uid()
          and v_sale_owner is null
        )
      )
    )
  ) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

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
  'Links an anchor row (sale, or purchase the caller sells) to a stage-authoritative searching placeholder. Authorised by can_operate_property; sale anchors also keep the member, delegated EA editor and unowned-creator arms. The placeholder must be unowned or owned by the anchor''s seller-side homeowner.';

revoke all on function public.link_sale_to_searching_placeholder(bigint, bigint) from public, anon;
grant execute on function public.link_sale_to_searching_placeholder(bigint, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 10) convert_searching_placeholder_for_sale: operable anchor
-- ---------------------------------------------------------------------------

create or replace function public.convert_searching_placeholder_for_sale(
  p_sale_property_id bigint,
  p_address text,
  p_postcode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.properties%rowtype;
  v_placeholder_id bigint;
  v_placeholder public.properties%rowtype;
  v_converted_id bigint;
  v_address text;
  v_postcode text;
  v_updated_by text;
  v_buyer_user_id uuid;
  v_placeholder_owner uuid;
  v_address_exists boolean;
  v_grant jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  v_address := nullif(trim(p_address), '');
  v_postcode := nullif(trim(p_postcode), '');

  if v_address is null or v_postcode is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_address');
  end if;

  select *
  into v_sale
  from public.properties
  where id = p_sale_property_id;

  if v_sale.id is null then
    return jsonb_build_object('ok', false, 'error', 'sale_not_found');
  end if;

  if v_sale.relationship_type is null
     or v_sale.relationship_type not in ('sale', 'purchase')
     or v_sale.stage = 'searching'
  then
    return jsonb_build_object('ok', false, 'error', 'invalid_sale');
  end if;

  if not public.can_operate_property(p_sale_property_id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  v_placeholder_id := v_sale.linked_property_id;

  if v_placeholder_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_placeholder');
  end if;

  select *
  into v_placeholder
  from public.properties
  where id = v_placeholder_id;

  if v_placeholder.id is null then
    return jsonb_build_object('ok', false, 'error', 'placeholder_not_found');
  end if;

  if v_placeholder.stage is distinct from 'searching'
    or v_placeholder.address is not null
    or v_placeholder.postcode is not null
  then
    return jsonb_build_object('ok', false, 'error', 'not_searching_placeholder');
  end if;

  if v_placeholder.chain_id is distinct from v_sale.chain_id then
    return jsonb_build_object('ok', false, 'error', 'chain_mismatch');
  end if;

  select public.property_exists_for_onboarding(
    v_address,
    v_postcode,
    v_placeholder_id
  )
  into v_address_exists;

  if v_address_exists then
    return jsonb_build_object('ok', false, 'error', 'duplicate_address');
  end if;

  v_buyer_user_id :=
    public._property_seller_side_user_id(p_sale_property_id);
  v_placeholder_owner :=
    public.get_property_operational_owner_user_id(v_placeholder_id);

  if v_placeholder_owner is not null
     and v_placeholder_owner is distinct from v_buyer_user_id
  then
    return jsonb_build_object('ok', false, 'error', 'placeholder_owner_mismatch');
  end if;

  select case
    when p.account_type = 'estate_agent' then 'estate_agent'
    else 'homeowner'
  end
  into v_updated_by
  from public.profiles p
  where p.id = auth.uid();

  v_updated_by := coalesce(v_updated_by, 'homeowner');

  begin
    update public.properties
    set
      stage = 'offer_accepted',
      address = v_address,
      postcode = v_postcode,
      status = 'pending_connection',
      relationship_type = 'purchase',
      buyer_connected = true,
      seller_connected = false,
      is_searching = false,
      is_current_user = true,
      awaiting_buyer = false
    where id = v_placeholder_id
      and stage = 'searching'
      and address is null
      and postcode is null
    returning id
    into v_converted_id;

    if v_converted_id is null then
      raise exception using
        errcode = 'SP001',
        message = 'update_failed';
    end if;

    if v_buyer_user_id is not null then
      v_grant := public._establish_operational_homeowner_core(
        v_converted_id,
        v_buyer_user_id,
        'convert_placeholder',
        false
      );

      if not coalesce((v_grant ->> 'ok')::boolean, false) then
        raise exception using
          errcode = 'SP001',
          message = coalesce(v_grant ->> 'error', 'grant_failed');
      end if;
    end if;

    insert into public.activities (
      property_id,
      update,
      updated_by
    )
    values (
      v_converted_id,
      'Onward purchase added',
      v_updated_by
    );
  exception
    when sqlstate 'SP001' then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;

  return jsonb_build_object(
    'ok', true,
    'property_id', v_converted_id,
    'chain_id', v_sale.chain_id
  );
end;
$$;

comment on function public.convert_searching_placeholder_for_sale(bigint, text, text) is
  'Converts the searching placeholder linked from an anchor row (sale, or purchase the caller sells). Authorised by can_operate_property on the anchor. The purchase is owned by the anchor''s seller-side homeowner, or unowned when there is none. Atomic.';

revoke all on function public.convert_searching_placeholder_for_sale(bigint, text, text) from public, anon;
grant execute on function public.convert_searching_placeholder_for_sale(bigint, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11) _create_ea_operational_property_core: sale only
-- ---------------------------------------------------------------------------

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
      and p.address = v_address
      and p.postcode = v_postcode
  ) then
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
  'Internal EA operational sale insert (purchase rows refused). Callers must establish chain authorisation (assignment, empty self-originated chain, or access-code join).';

revoke all on function public._create_ea_operational_property_core(
  bigint, text, text, text, uuid, boolean, text, text, boolean
) from public, anon, authenticated;

grant execute on function public._create_ea_operational_property_core(
  bigint, text, text, text, uuid, boolean, text, text, boolean
) to service_role;
