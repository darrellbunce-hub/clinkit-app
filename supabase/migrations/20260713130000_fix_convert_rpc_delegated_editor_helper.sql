-- Fix convert_searching_placeholder_for_sale delegated-editor call.
--
-- Live error 42883: function public.is_ea_delegated_editor_on_property(bigint) does not exist
-- when only the convert RPC migration was applied without Phase 5a helpers.
--
-- Canonical helper signature (Phase 5a): (p_property_id bigint) → boolean
-- Convert RPC already passes bigint; no cast or overload is required.
-- This migration idempotently ensures the helper exists and only evaluates it
-- for non-seller callers (same auth rules, avoids unnecessary helper resolution).

-- ---------------------------------------------------------------------------
-- Helper: is_ea_delegated_editor_on_property (Phase 5a)
-- ---------------------------------------------------------------------------

create or replace function public.is_ea_delegated_editor_on_property(
  p_property_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.property_ea_assignments pea
    inner join public.ea_branch_members bm
      on bm.branch_id = pea.branch_id
    where pea.property_id = p_property_id
      and pea.status = 'active'
      and pea.homeowner_only_updates = false
      and bm.user_id = auth.uid()
  );
$$;

comment on function public.is_ea_delegated_editor_on_property(bigint) is
  'True when the current user may post delegated updates on the assigned property.';

revoke all on function public.is_ea_delegated_editor_on_property(bigint) from public;
grant execute on function public.is_ea_delegated_editor_on_property(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: convert_searching_placeholder_for_sale (delegated check short-circuit)
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
  v_address_exists boolean;
  v_is_homeowner_seller boolean;
  v_is_delegated_ea boolean;
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

  if v_sale.relationship_type is distinct from 'sale' then
    return jsonb_build_object('ok', false, 'error', 'invalid_sale');
  end if;

  select exists (
    select 1
    from public.property_members pm
    where pm.property_id = p_sale_property_id
      and pm.user_id = auth.uid()
      and pm.role = 'seller'
  )
  into v_is_homeowner_seller;

  v_is_delegated_ea := false;

  if not v_is_homeowner_seller then
    v_is_delegated_ea :=
      public.is_ea_delegated_editor_on_property(p_sale_property_id);
  end if;

  if not (v_is_homeowner_seller or v_is_delegated_ea) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  v_placeholder_id :=
    public.resolve_convertible_searching_placeholder_for_sale(
      p_sale_property_id
    );

  if v_placeholder_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select *
  into v_placeholder
  from public.properties
  where id = v_placeholder_id;

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
    return jsonb_build_object('ok', false, 'error', 'update_failed');
  end if;

  if v_is_delegated_ea and not v_is_homeowner_seller then
    v_buyer_user_id :=
      public.get_property_operational_owner_user_id(p_sale_property_id);

    if v_buyer_user_id is null then
      v_buyer_user_id := auth.uid();
    end if;
  else
    v_buyer_user_id := auth.uid();
  end if;

  insert into public.property_members (
    property_id,
    user_id,
    role
  )
  values (
    v_converted_id,
    v_buyer_user_id,
    'buyer'
  )
  on conflict (property_id, user_id) do update
  set role = case
    when case public.property_members.role
      when 'seller' then 1
      when 'buyer' then 2
      when 'participant' then 3
      else 4
    end
    <= case excluded.role
      when 'seller' then 1
      when 'buyer' then 2
      when 'participant' then 3
      else 4
    end
    then public.property_members.role
    else excluded.role
  end;

  select case
    when p.account_type = 'estate_agent' then 'estate_agent'
    else 'homeowner'
  end
  into v_updated_by
  from public.profiles p
  where p.id = auth.uid();

  v_updated_by := coalesce(v_updated_by, 'homeowner');

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

  return jsonb_build_object(
    'ok', true,
    'property_id', v_converted_id,
    'chain_id', v_sale.chain_id
  );
end;
$$;

comment on function public.convert_searching_placeholder_for_sale(bigint, text, text) is
  'Converts the downstream searching placeholder for an operational sale. Authorised via sale seller membership or delegated EA editing on the sale.';

revoke all on function public.convert_searching_placeholder_for_sale(bigint, text, text) from public;
grant execute on function public.convert_searching_placeholder_for_sale(bigint, text, text) to authenticated;
