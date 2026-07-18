-- Corrective: GDPR RTBF must not write participation de-link audit rows.
--
-- property_delink_events uses reason_code (not reason) and records voluntary
-- participation de-link semantics. GDPR person-property link removal is audited
-- in gdpr_erasure_audit_events instead.
--
-- Requires: 20260718120000_gdpr_erasure_execution_rpc.sql (already applied on Dev)

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
  'Removes subject person-property links for GDPR RTBF. Audits via gdpr_erasure_audit_events, not property_delink_events.';

revoke all on function public._gdpr_remove_subject_property_links(uuid, bigint, uuid) from public;
