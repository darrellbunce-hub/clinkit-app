-- Searching placeholder ownership (1 of 3, additive): sale-scoped placeholder
-- creation RPC and chain-scoped read/insert policies for completion + delays.
--
-- Problem:
--   Since 20260714150000 the searching placeholder inserted during EA sale
--   origination grants an operational identity to its creator. When an estate
--   agent originates the sale, the estate agent becomes the placeholder's
--   operational homeowner (and owner-class member).
--
-- This migration (safe to apply before the application change):
--   _is_estate_agent_account(uuid)
--     Internal helper: profiles.account_type = 'estate_agent'.
--   create_searching_placeholder_for_sale(bigint)
--     Authorised through the SALE: its operational homeowner or any estate agent
--     with an active assignment on the sale (delegated or view-only; the
--     originating agent's branch is assigned by _ea_assign_originated_property).
--     Returns the sale's existing linked placeholder when present; otherwise
--     inserts a fixed searching placeholder (purchase / searching / null
--     address / null postcode / created_by = auth.uid()), links the sale to it,
--     and grants an operational identity only to the sale's existing
--     (non-estate-agent) homeowner. Estate agents never receive an identity.
--     All writes are one transaction; a failed grant rolls back insert + link.
--   chain_completion_events_insert_participants
--     chain member OR delegated EA editor on the chain, AND actor_user_id = auth.uid().
--   chain_completion_events_select_participants / operational_delays_select_participant
--     is_chain_operational_viewer(chain_id).
--
-- Follow-ups (apply after the application change that calls this RPC):
--   20261001120000_properties_chain_integrity_guard.sql
--   20261001130000_searching_placeholder_ownership_enforcement.sql

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text[] := array[]::text[];
  v_name text;
begin
  foreach v_name in array array[
    'public.properties',
    'public.profiles',
    'public.property_operational_identities',
    'public.chain_completion_events',
    'public.operational_delays'
  ]
  loop
    if to_regclass(v_name) is null then
      v_missing := array_append(v_missing, v_name);
    end if;
  end loop;

  foreach v_name in array array[
    'auth.uid()',
    'public._require_verified_email_for_transaction()',
    'public._establish_operational_homeowner_core(bigint, uuid, text, boolean)',
    'public.get_property_operational_owner_user_id(bigint)',
    'public.is_property_operational_homeowner(bigint)',
    'public.is_ea_assigned_to_property(bigint)',
    'public.is_ea_delegated_editor_on_chain(bigint)',
    'public.is_chain_operational_viewer(bigint)',
    'public.get_next_chain_position(bigint)'
  ]
  loop
    if to_regprocedure(v_name) is null then
      v_missing := array_append(v_missing, v_name);
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception
      'create_searching_placeholder_for_sale aborted: missing dependencies (%)',
      array_to_string(v_missing, ', ');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Helper: _is_estate_agent_account (internal)
-- ---------------------------------------------------------------------------

create or replace function public._is_estate_agent_account(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles pr
    where pr.id = p_user_id
      and pr.account_type = 'estate_agent'
  );
$$;

comment on function public._is_estate_agent_account(uuid) is
  'Internal: true when the user is an estate-agent account. Estate-agent accounts never hold operational homeowner identities or counterparty participation.';

revoke all on function public._is_estate_agent_account(uuid) from public, anon, authenticated;
grant execute on function public._is_estate_agent_account(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2) RPC: create_searching_placeholder_for_sale
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

  if v_sale.relationship_type is distinct from 'sale'
     or v_sale.chain_id is null
  then
    return jsonb_build_object('ok', false, 'error', 'invalid_sale');
  end if;

  if not (
    public.is_property_operational_homeowner(p_sale_property_id)
    or public.is_ea_assigned_to_property(p_sale_property_id)
  ) then
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

  v_owner := public.get_property_operational_owner_user_id(p_sale_property_id);

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
  'Creates (or returns) the searching placeholder linked from a sale. Authorised via the sale (operational homeowner or assigned EA). Grants an identity only to the sale''s existing homeowner; estate agents never receive one.';

revoke all on function public.create_searching_placeholder_for_sale(bigint) from public, anon;
grant execute on function public.create_searching_placeholder_for_sale(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Policies: chain_completion_events
-- ---------------------------------------------------------------------------

drop policy if exists chain_completion_events_select_participants
  on public.chain_completion_events;

create policy chain_completion_events_select_participants
  on public.chain_completion_events
  for select
  to authenticated
  using (
    public.is_chain_operational_viewer(chain_id)
  );

drop policy if exists chain_completion_events_insert_participants
  on public.chain_completion_events;

create policy chain_completion_events_insert_participants
  on public.chain_completion_events
  for insert
  to authenticated
  with check (
    actor_user_id = auth.uid()
    and (
      exists (
        select 1
        from public.properties p
        inner join public.property_members pm
          on pm.property_id = p.id
        where p.chain_id = chain_completion_events.chain_id
          and pm.user_id = auth.uid()
      )
      or public.is_ea_delegated_editor_on_chain(chain_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 4) Policies: operational_delays
-- ---------------------------------------------------------------------------

drop policy if exists operational_delays_select_participant
  on public.operational_delays;

create policy operational_delays_select_participant
  on public.operational_delays
  for select
  to authenticated
  using (
    public.is_chain_operational_viewer(chain_id)
  );
