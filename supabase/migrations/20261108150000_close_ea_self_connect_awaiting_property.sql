-- Close Estate Agent self-attachment to a purchase awaiting its seller.
--
-- connect_ea_to_awaiting_property (20261005110000, revised by 20261005140000)
-- inserted an active seller-side assignment for any verified member of any
-- branch, proven only by the chain access code and a matching address and
-- postcode. Business Rules 5.18, 17.10 and 19.1-19.3: an access code and an
-- address do not by themselves give an Estate Agent seller-side
-- representation authority.
--
-- The function keeps its signature, jsonb result, SECURITY DEFINER,
-- search_path and grants, and always returns the generic
-- join_details_not_matched failure. It reads and writes nothing.
--
-- The approved route is unchanged: the seller connects (join_chain_property)
-- and then appoints an Estate Agent (assign_property_ea_branch).
--
-- No data is changed. Existing assignments are left as they are.

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_src text;
  v_result text;
begin
  if to_regprocedure('public.connect_ea_to_awaiting_property(text, text, text, uuid)') is null then
    raise exception 'close_ea_self_connect_awaiting_property aborted: connect_ea_to_awaiting_property(text, text, text, uuid) is missing';
  end if;

  select p.prosrc, pg_catalog.format_type(p.prorettype, null)
  into v_src, v_result
  from pg_proc p
  where p.oid = to_regprocedure('public.connect_ea_to_awaiting_property(text, text, text, uuid)');

  if v_result is distinct from 'jsonb' then
    raise exception 'close_ea_self_connect_awaiting_property aborted: connect_ea_to_awaiting_property does not return jsonb';
  end if;

  if v_src not like '%insert into public.property_ea_assignments%'
     or v_src not like '%buyer_side from public._property_side_representation(v_property.id) s) = ''none''%'
  then
    raise exception
      'close_ea_self_connect_awaiting_property aborted: connect_ea_to_awaiting_property differs from 20261005140000';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) connect_ea_to_awaiting_property: generic refusal
-- ---------------------------------------------------------------------------

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
begin
  return jsonb_build_object('ok', false, 'error', 'join_details_not_matched');
end;
$$;

comment on function public.connect_ea_to_awaiting_property(text, text, text, uuid) is
  'Closed: always returns the generic join_details_not_matched failure and reads or writes nothing. An access code and address do not give an Estate Agent seller-side authority (Business Rules 5.18, 17.10, 19.1-19.3); the seller connects and then appoints an Estate Agent through assign_property_ea_branch.';

revoke all on function public.connect_ea_to_awaiting_property(text, text, text, uuid) from public, anon;
grant execute on function public.connect_ea_to_awaiting_property(text, text, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Postflight
-- ---------------------------------------------------------------------------

do $$
declare
  v_src text;
  v_result text;
  v_definer boolean;
begin
  select p.prosrc, pg_catalog.format_type(p.prorettype, null), p.prosecdef
  into v_src, v_result, v_definer
  from pg_proc p
  where p.oid = to_regprocedure('public.connect_ea_to_awaiting_property(text, text, text, uuid)');

  if v_src is null
     or v_src like '%property_ea_assignments%'
     or v_src ~* '\m(insert|update|delete|perform|select)\M'
     or v_src not like '%''join_details_not_matched''%'
  then
    raise exception 'close_ea_self_connect_awaiting_property postflight: connect_ea_to_awaiting_property not replaced';
  end if;

  if v_result is distinct from 'jsonb' or v_definer is distinct from true then
    raise exception 'close_ea_self_connect_awaiting_property postflight: connect_ea_to_awaiting_property signature changed';
  end if;

  if has_function_privilege('anon', 'public.connect_ea_to_awaiting_property(text, text, text, uuid)', 'execute') then
    raise exception 'close_ea_self_connect_awaiting_property postflight: connect_ea_to_awaiting_property is anon-executable';
  end if;

  if not has_function_privilege('authenticated', 'public.connect_ea_to_awaiting_property(text, text, text, uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.connect_ea_to_awaiting_property(text, text, text, uuid)', 'execute')
  then
    raise exception 'close_ea_self_connect_awaiting_property postflight: connect_ea_to_awaiting_property grants changed';
  end if;
end;
$$;
