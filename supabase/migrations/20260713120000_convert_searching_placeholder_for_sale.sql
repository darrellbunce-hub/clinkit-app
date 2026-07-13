-- Transaction-scoped onward purchase conversion.
-- Authorises against the operational sale; mutates downstream searching placeholder
-- server-side (mirrors break_chain_connection / link_sale_to_searching_placeholder).

-- ---------------------------------------------------------------------------
-- Helper: graph walk from operational sale to convertible searching placeholder.
-- Rules align with resolveConvertibleSearchingPlaceholder + walkLinkedPropertySegment.
-- ---------------------------------------------------------------------------

create or replace function public.resolve_convertible_searching_placeholder_for_sale(
  p_sale_property_id bigint
)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sale public.properties%rowtype;
  v_current public.properties%rowtype;
  v_linked public.properties%rowtype;
  v_visited bigint[] := array[]::bigint[];
  v_hops integer := 0;
  v_max_hops constant integer := 64;
begin
  select *
  into v_sale
  from public.properties
  where id = p_sale_property_id;

  if v_sale.id is null then
    return null;
  end if;

  if v_sale.relationship_type is distinct from 'sale' then
    return null;
  end if;

  -- Sale must be renderable (addressed) to start a topology walk.
  if v_sale.address is null then
    return null;
  end if;

  v_current := v_sale;

  loop
    if v_current.id = any (v_visited) then
      return null;
    end if;

    v_visited := array_append(v_visited, v_current.id);
    v_hops := v_hops + 1;

    if v_hops > v_max_hops then
      return null;
    end if;

    if v_current.stage = 'searching'
      and v_current.address is null
      and v_current.postcode is null then
      return v_current.id;
    end if;

    if v_current.linked_property_id is null then
      return null;
    end if;

    select *
    into v_linked
    from public.properties
    where id = v_current.linked_property_id
      and chain_id = v_sale.chain_id;

    if v_linked.id is null then
      return null;
    end if;

    -- Renderable topology hop: addressed property or active searching placeholder.
    if not (
      v_linked.address is not null
      or (
        v_linked.stage = 'searching'
        and v_linked.address is null
      )
    ) then
      return null;
    end if;

    v_current := v_linked;
  end loop;
end;
$$;

comment on function public.resolve_convertible_searching_placeholder_for_sale(bigint) is
  'Walks linked_property_id from an operational sale to the first active searching placeholder. Server-only resolver for onward purchase conversion.';

revoke all on function public.resolve_convertible_searching_placeholder_for_sale(bigint) from public;
grant execute on function public.resolve_convertible_searching_placeholder_for_sale(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: convert_searching_placeholder_for_sale
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

  v_is_delegated_ea :=
    public.is_ea_delegated_editor_on_property(p_sale_property_id);

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

  -- Buyer membership on the converted purchase (not the placeholder lifecycle).
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
