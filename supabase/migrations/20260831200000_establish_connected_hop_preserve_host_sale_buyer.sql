-- P0.1 Part 3 chain-connection fix:
-- When a seller joins a purchase property, establish_connected_hop must NOT mark
-- the host participant's unrelated sale as buyer_connected.
--
-- Connecting User B as seller of User A's purchase (e.g. 10 Downing Street)
-- resolves only that purchase's seller connection. It must leave the host sale's
-- unresolved purchaser state (buyer_connected) unchanged (e.g. 1 Cuckoo Lane).
--
-- Idempotent CREATE OR REPLACE. Does not alter join_chain_property.
-- Catalog-aware catch-up: safe to apply via SQL Editor; do not blind db push.

create or replace function public.establish_connected_hop(
  p_purchase_property_id bigint
)
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

  if not public.is_property_operational_participant(v_purchase.id) then
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
  'After a seller joins a purchase: mark purchase connected and link host sale → purchase. Does not set host_sale.buyer_connected.';
