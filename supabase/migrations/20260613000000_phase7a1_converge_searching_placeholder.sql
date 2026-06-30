-- Phase 7A.1: Link sale to searching placeholder (shared Start Move + EA origination)

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

  if v_sale.relationship_type <> 'sale' then
    return jsonb_build_object('ok', false, 'error', 'invalid_sale');
  end if;

  if v_searching.stage <> 'searching'
    or v_searching.address is not null
    or v_searching.postcode is not null then
    return jsonb_build_object('ok', false, 'error', 'invalid_searching_placeholder');
  end if;

  if not (
    public.is_property_member(p_sale_property_id)
    or public.is_ea_assigned_to_property(p_sale_property_id)
    or v_sale.created_by_user_id = auth.uid()
  ) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.properties
  set linked_property_id = p_searching_property_id
  where id = p_sale_property_id;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.link_sale_to_searching_placeholder(bigint, bigint) is
  'Links a sale property to a stage-authoritative searching placeholder. Used by Start Move and EA origination.';

revoke all on function public.link_sale_to_searching_placeholder(bigint, bigint) from public;
grant execute on function public.link_sale_to_searching_placeholder(bigint, bigint) to authenticated;
