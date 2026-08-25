-- Corrective: defence-in-depth shared transaction safety at address redaction time.
--
-- 1. _gdpr_shared_transaction_safety_block must evaluate live DB state for
--    REDACT_SOLE_PARTICIPANT_PROPERTY_ADDRESS (not bypass via early return).
-- 2. _gdpr_redact_sole_participant_property_address must consult the safety
--    helper immediately before redaction (not approval snapshot).
-- 3. Grant service_role execute on safety helpers for controlled verification.

create or replace function public._gdpr_shared_transaction_safety_block(
  p_subject_user_id uuid,
  p_property_id bigint,
  p_action_type text
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_other_homeowners integer := 0;
  v_other_counterparties integer := 0;
  v_other_delegates integer := 0;
  v_active_ea integer := 0;
  v_buyer_connected boolean := false;
  v_seller_connected boolean := false;
begin
  -- Manual review actions are never blocked by this helper.
  if p_action_type = 'REVIEW_SHARED_PROPERTY_ADDRESS' then
    return null;
  end if;

  select
    coalesce(p.buyer_connected, false),
    coalesce(p.seller_connected, false)
  into v_buyer_connected, v_seller_connected
  from public.properties p
  where p.id = p_property_id;

  select count(*)::int
  into v_other_homeowners
  from public.property_operational_identities poi
  where poi.property_id = p_property_id
    and poi.status = 'active'
    and poi.homeowner_user_id <> p_subject_user_id;

  select count(*)::int
  into v_other_counterparties
  from public.property_counterparty_participants pcp
  where pcp.property_id = p_property_id
    and pcp.status = 'active'
    and pcp.user_id <> p_subject_user_id;

  select count(*)::int
  into v_other_delegates
  from public.property_delegates pd
  where pd.property_id = p_property_id
    and pd.status in ('pending', 'active')
    and pd.delegate_user_id <> p_subject_user_id
    and pd.invited_by_user_id <> p_subject_user_id;

  select count(*)::int
  into v_active_ea
  from public.property_ea_assignments pea
  where pea.property_id = p_property_id
    and pea.status = 'active';

  if v_other_homeowners > 0
     or v_other_counterparties > 0
     or v_other_delegates > 0
     or v_active_ea > 0
     or (v_buyer_connected and v_seller_connected) then
    if p_action_type = 'REDACT_SOLE_PARTICIPANT_PROPERTY_ADDRESS' then
      return 'SHARED_TRANSACTION_SAFETY_BLOCK';
    end if;
  end if;

  return null;
end;
$$;

create or replace function public._gdpr_redact_sole_participant_property_address(
  p_property_id bigint,
  p_erasure_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_address text;
  v_postcode text;
  v_subject uuid;
  v_safety text;
begin
  select r.subject_user_id
  into v_subject
  from public.gdpr_erasure_requests r
  where r.id = p_erasure_request_id;

  if v_subject is null then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;

  v_safety := public._gdpr_shared_transaction_safety_block(
    v_subject,
    p_property_id,
    'REDACT_SOLE_PARTICIPANT_PROPERTY_ADDRESS'
  );

  if v_safety is not null then
    return jsonb_build_object('ok', false, 'error', v_safety, 'property_id', p_property_id);
  end if;

  select p.address, p.postcode
  into v_address, v_postcode
  from public.properties p
  where p.id = p_property_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'property_not_found');
  end if;

  if v_address = '[Released property]' and v_postcode = 'REDACTED' then
    return jsonb_build_object('ok', true, 'idempotent', true, 'property_id', p_property_id);
  end if;

  update public.property_claim_metadata pcm
  set
    invite_email = null,
    invite_display_name = null,
    updated_at = now()
  where pcm.property_id = p_property_id;

  update public.properties
  set
    address = '[Released property]',
    postcode = 'REDACTED',
    created_by_user_id = null
  where id = p_property_id;

  perform public._gdpr_erasure_audit(
    p_erasure_request_id,
    'address_redacted',
    jsonb_build_object(
      'property_id', p_property_id,
      'gdpr_scope', 'rtbf_sole_participant_address_redaction'
    )
  );

  return jsonb_build_object('ok', true, 'property_id', p_property_id);
end;
$$;

comment on function public._gdpr_redact_sole_participant_property_address(bigint, uuid) is
  'GDPR sole-participant address redaction with live shared-transaction safety re-check.';

revoke all on function public._gdpr_redact_sole_participant_property_address(bigint, uuid) from public;
grant execute on function public._gdpr_shared_transaction_safety_block(uuid, bigint, text) to service_role;
grant execute on function public._gdpr_redact_sole_participant_property_address(bigint, uuid) to service_role;
