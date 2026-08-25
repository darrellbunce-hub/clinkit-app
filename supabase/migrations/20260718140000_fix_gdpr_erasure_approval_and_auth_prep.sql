-- Corrective: approve executable DB actions after request approval; strengthen
-- email redaction; clear all auth.users FK references before Auth deletion.
--
-- Root causes fixed:
-- 1. REDACT_EMAIL_REFERENCE stayed pending_manual because approve used impact
--    report requires_manual_review instead of action-type semantics.
-- 2. Auth delete failed on FK RESTRICT (e.g. chains.created_by_user_id) because
--    NULL_HISTORICAL_ACTOR_REFERENCE also stayed pending_manual.
--
-- Requires prior Phase 3 migrations through 20260718130000.

-- ---------------------------------------------------------------------------
-- Approval status helper: request approval != every action needs manual review
-- ---------------------------------------------------------------------------

create or replace function public._gdpr_action_status_on_approval(p_action_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_action_type in (
      'REVIEW_SHARED_PROPERTY_ADDRESS',
      'REVIEW_ANALYTICS_REIDENTIFICATION',
      'PSEUDONYMISE_HISTORICAL_ACTOR',
      'SCRUB_COMMUNICATION_PROVIDER_METADATA',
      'BACKUP_SUPPRESSION_LEDGER_REQUIRED',
      'VERCEL_LOG_RETENTION_REVIEW',
      'UPSTASH_PURGE_REQUIRED',
      'PROPAGATE_PROCESSOR_ERASURE'
    ) then 'pending_manual'
    else 'approved'
  end;
$$;

comment on function public._gdpr_action_status_on_approval(text) is
  'Maps action_type to post-request-approval status. Review/legal actions stay pending_manual.';

revoke all on function public._gdpr_action_status_on_approval(text) from public;

-- ---------------------------------------------------------------------------
-- approve_gdpr_erasure_request: use action_type semantics
-- ---------------------------------------------------------------------------

create or replace function public.approve_gdpr_erasure_request(
  p_request_id uuid,
  p_approved_by uuid default null,
  p_action_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.gdpr_erasure_requests%rowtype;
  v_snapshot_id uuid;
begin
  select *
  into v_request
  from public.gdpr_erasure_requests
  where id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;

  if v_request.status <> 'awaiting_approval' then
    return jsonb_build_object('ok', false, 'error', 'invalid_status_transition', 'status', v_request.status);
  end if;

  select s.id
  into v_snapshot_id
  from public.gdpr_erasure_impact_snapshots s
  where s.erasure_request_id = p_request_id
  order by s.created_at desc
  limit 1;

  if v_snapshot_id is null then
    return jsonb_build_object('ok', false, 'error', 'snapshot_missing');
  end if;

  if p_action_ids is null then
    update public.gdpr_erasure_actions ga
    set
      status = public._gdpr_action_status_on_approval(ga.action_type),
      approved_at = case
        when public._gdpr_action_status_on_approval(ga.action_type) = 'approved' then now()
        else null
      end,
      updated_at = now()
    where ga.erasure_request_id = p_request_id
      and ga.status = 'draft';
  else
    update public.gdpr_erasure_actions
    set status = 'blocked', updated_at = now()
    where erasure_request_id = p_request_id
      and status = 'draft'
      and not (id = any(p_action_ids));

    update public.gdpr_erasure_actions ga
    set
      status = public._gdpr_action_status_on_approval(ga.action_type),
      approved_at = case
        when public._gdpr_action_status_on_approval(ga.action_type) = 'approved' then now()
        else null
      end,
      updated_at = now()
    where ga.erasure_request_id = p_request_id
      and ga.id = any(p_action_ids)
      and ga.status = 'draft';
  end if;

  update public.gdpr_erasure_requests
  set
    status = 'approved',
    approved_at = now(),
    approved_by = p_approved_by,
    approved_snapshot_id = v_snapshot_id,
    updated_at = now()
  where id = p_request_id;

  perform public._gdpr_erasure_audit(p_request_id, 'approved', jsonb_build_object(
    'approved_by', p_approved_by,
    'snapshot_id', v_snapshot_id
  ));

  return jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'status', 'approved',
    'approved_snapshot_id', v_snapshot_id,
    'approved_action_count', (
      select count(*)
      from public.gdpr_erasure_actions
      where erasure_request_id = p_request_id
        and status = 'approved'
    )
  );
end;
$$;

revoke all on function public.approve_gdpr_erasure_request(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.approve_gdpr_erasure_request(uuid, uuid, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- REDACT_EMAIL_REFERENCE: idempotent irreversible redaction
-- ---------------------------------------------------------------------------

create or replace function public._gdpr_execute_erasure_action(
  p_action_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action public.gdpr_erasure_actions%rowtype;
  v_request public.gdpr_erasure_requests%rowtype;
  v_subject uuid;
  v_email text;
  v_property_id bigint;
  v_safety text;
  v_rows integer := 0;
begin
  select *
  into v_action
  from public.gdpr_erasure_actions
  where id = p_action_id
    and erasure_request_id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'action_not_found');
  end if;

  if v_action.status in ('completed', 'skipped_idempotent') then
    return jsonb_build_object('ok', true, 'idempotent', true, 'action_id', p_action_id);
  end if;

  if v_action.status = 'blocked' or v_action.status = 'pending_manual' then
    return jsonb_build_object(
      'ok', false,
      'error', 'action_blocked',
      'action_id', p_action_id,
      'status', v_action.status
    );
  end if;

  if v_action.status <> 'approved' then
    return jsonb_build_object('ok', false, 'error', 'action_not_approved');
  end if;

  select *
  into v_request
  from public.gdpr_erasure_requests
  where id = p_request_id;

  v_subject := v_request.subject_user_id;

  select lower(trim(u.email))
  into v_email
  from auth.users u
  where u.id = v_subject;

  case v_action.action_type
    when 'REMOVE_PERSON_PROPERTY_LINK' then
      v_property_id := nullif(v_action.target_reference ->> 'property_id', '')::bigint;
      if v_property_id is null then
        update public.gdpr_erasure_actions
        set status = 'failed', failure_code = 'missing_property_id', updated_at = now()
        where id = p_action_id;
        return jsonb_build_object('ok', false, 'error', 'missing_property_id');
      end if;

      perform public._gdpr_remove_subject_property_links(v_subject, v_property_id, p_request_id);

      update public.gdpr_erasure_actions
      set status = 'completed', executed_at = now(), updated_at = now()
      where id = p_action_id;

      return jsonb_build_object('ok', true, 'action_type', v_action.action_type);

    when 'REDACT_PROFILE_PERSONAL_DATA' then
      update public.profiles
      set
        contact_name = null,
        email_domain = null
      where id = v_subject;

      update public.gdpr_erasure_actions
      set status = 'completed', executed_at = now(), updated_at = now()
      where id = p_action_id;

      return jsonb_build_object('ok', true, 'action_type', v_action.action_type);

    when 'REDACT_EMAIL_REFERENCE' then
      if v_email is not null and v_email <> '' then
        update public.email_events ee
        set
          recipient_email = 'redacted+' || ee.id::text || '@erased.local',
          provider_message_id = null,
          error_message = case
            when ee.error_message is not null then '[redacted]'
            else null
          end,
          provider_events = '[]'::jsonb,
          updated_at = now()
        where lower(trim(ee.recipient_email)) = v_email
          and ee.recipient_email not like 'redacted+%@erased.local';

        get diagnostics v_rows = row_count;

        update public.property_claim_metadata pcm
        set invite_email = null, updated_at = now()
        where lower(trim(pcm.invite_email)) = v_email;

        update public.ea_branch_invitations ebi
        set
          invite_email = 'redacted+' || ebi.id::text || '@erased.local',
          invite_name = '[redacted]',
          updated_at = now()
        where lower(trim(ebi.invite_email)) = v_email
          and ebi.invite_email not like 'redacted+%@erased.local';
      end if;

      update public.email_events
      set sent_by = null, updated_at = now()
      where sent_by = v_subject;

      update public.gdpr_erasure_actions
      set
        status = 'completed',
        executed_at = now(),
        execution_detail = jsonb_build_object('email_events_redacted', v_rows),
        updated_at = now()
      where id = p_action_id;

      return jsonb_build_object('ok', true, 'action_type', v_action.action_type);

    when 'NULL_HISTORICAL_ACTOR_REFERENCE' then
      update public.property_delink_events
      set actor_user_id = null
      where actor_user_id = v_subject;

      update public.chain_completion_events
      set actor_user_id = null
      where actor_user_id = v_subject;

      update public.properties
      set created_by_user_id = null
      where created_by_user_id = v_subject;

      update public.chains
      set
        created_by_user_id = case when created_by_user_id = v_subject then null else created_by_user_id end,
        completion_date_recorded_by_user_id = case
          when completion_date_recorded_by_user_id = v_subject then null
          else completion_date_recorded_by_user_id end,
        completion_date_updated_by_user_id = case
          when completion_date_updated_by_user_id = v_subject then null
          else completion_date_updated_by_user_id end,
        completion_confirmed_by_user_id = case
          when completion_confirmed_by_user_id = v_subject then null
          else completion_confirmed_by_user_id end
      where created_by_user_id = v_subject
         or completion_date_recorded_by_user_id = v_subject
         or completion_date_updated_by_user_id = v_subject
         or completion_confirmed_by_user_id = v_subject;

      update public.gdpr_erasure_actions
      set status = 'completed', executed_at = now(), updated_at = now()
      where id = p_action_id;

      return jsonb_build_object('ok', true, 'action_type', v_action.action_type);

    when 'REDACT_SOLE_PARTICIPANT_PROPERTY_ADDRESS' then
      v_property_id := nullif(v_action.target_reference ->> 'property_id', '')::bigint;
      v_safety := public._gdpr_shared_transaction_safety_block(
        v_subject,
        v_property_id,
        v_action.action_type
      );

      if v_safety is not null then
        update public.gdpr_erasure_actions
        set status = 'blocked', failure_code = v_safety, updated_at = now()
        where id = p_action_id;
        return jsonb_build_object('ok', false, 'error', v_safety);
      end if;

      perform public._gdpr_redact_sole_participant_property_address(v_property_id, p_request_id);

      update public.gdpr_erasure_actions
      set status = 'completed', executed_at = now(), updated_at = now()
      where id = p_action_id;

      return jsonb_build_object('ok', true, 'action_type', v_action.action_type);

    when 'REMOVE_ANALYTICS_RELINK_PATH' then
      update public.property_analytics_snapshots pas
      set source_property_id = null
      where pas.source_property_id in (
        select (elem ->> 'property_id')::bigint
        from jsonb_array_elements(
          coalesce(
            (
              select s.material_scope -> 'property_ids'
              from public.gdpr_erasure_impact_snapshots s
              where s.id = v_request.approved_snapshot_id
            ),
            '[]'::jsonb
          )
        ) elem
      )
      or pas.source_property_id in (
        select (rel ->> 'property_id')::bigint
        from jsonb_array_elements(
          coalesce(
            (
              select s.relationship_summary -> 'properties'
              from public.gdpr_erasure_impact_snapshots s
              where s.id = v_request.approved_snapshot_id
            ),
            '[]'::jsonb
          )
        ) rel
      );

      update public.gdpr_erasure_actions
      set status = 'completed', executed_at = now(), updated_at = now()
      where id = p_action_id;

      return jsonb_build_object('ok', true, 'action_type', v_action.action_type);

    when 'DELETE_AUTH_IDENTITY_LAST' then
      update public.gdpr_erasure_actions
      set status = 'pending_manual', updated_at = now()
      where id = p_action_id;

      return jsonb_build_object(
        'ok', true,
        'action_type', v_action.action_type,
        'note', 'awaiting_external_auth_deletion'
      );

    when 'REVIEW_SHARED_PROPERTY_ADDRESS',
         'REVIEW_ANALYTICS_REIDENTIFICATION',
         'PSEUDONYMISE_HISTORICAL_ACTOR',
         'SCRUB_COMMUNICATION_PROVIDER_METADATA',
         'BACKUP_SUPPRESSION_LEDGER_REQUIRED',
         'VERCEL_LOG_RETENTION_REVIEW',
         'UPSTASH_PURGE_REQUIRED' then
      update public.gdpr_erasure_actions
      set status = 'pending_manual', updated_at = now()
      where id = p_action_id;

      return jsonb_build_object('ok', false, 'error', 'manual_review_required');

    else
      update public.gdpr_erasure_actions
      set status = 'blocked', failure_code = 'unknown_action_type', updated_at = now()
      where id = p_action_id;

      return jsonb_build_object('ok', false, 'error', 'unknown_action_type');
  end case;
end;
$$;

revoke all on function public._gdpr_execute_erasure_action(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- Auth deletion prep: clear all auth.users FK blockers (RESTRICT / NO ACTION)
-- ---------------------------------------------------------------------------

create or replace function public._gdpr_prepare_subject_for_auth_deletion(
  p_subject_user_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.property_operational_identities
  where homeowner_user_id = p_subject_user_id;

  delete from public.property_members
  where user_id = p_subject_user_id;

  delete from public.property_counterparty_participants
  where user_id = p_subject_user_id;

  delete from public.property_delegates
  where delegate_user_id = p_subject_user_id
     or invited_by_user_id = p_subject_user_id;

  delete from public.property_lifecycle_still_active_confirmations
  where user_id = p_subject_user_id;

  update public.property_delink_events
  set actor_user_id = null
  where actor_user_id = p_subject_user_id;

  update public.chain_completion_events
  set actor_user_id = null
  where actor_user_id = p_subject_user_id;

  update public.properties
  set created_by_user_id = null
  where created_by_user_id = p_subject_user_id;

  update public.chains
  set
    created_by_user_id = case
      when created_by_user_id = p_subject_user_id then null else created_by_user_id end,
    completion_date_recorded_by_user_id = case
      when completion_date_recorded_by_user_id = p_subject_user_id then null
      else completion_date_recorded_by_user_id end,
    completion_date_updated_by_user_id = case
      when completion_date_updated_by_user_id = p_subject_user_id then null
      else completion_date_updated_by_user_id end,
    completion_confirmed_by_user_id = case
      when completion_confirmed_by_user_id = p_subject_user_id then null
      else completion_confirmed_by_user_id end
  where created_by_user_id = p_subject_user_id
     or completion_date_recorded_by_user_id = p_subject_user_id
     or completion_date_updated_by_user_id = p_subject_user_id
     or completion_confirmed_by_user_id = p_subject_user_id;

  update public.property_claim_metadata
  set
    originated_by_user_id = case
      when originated_by_user_id = p_subject_user_id then null else originated_by_user_id end,
    claimed_by_user_id = case
      when claimed_by_user_id = p_subject_user_id then null else claimed_by_user_id end,
    updated_at = now()
  where originated_by_user_id = p_subject_user_id
     or claimed_by_user_id = p_subject_user_id;

  update public.property_claim_invitations
  set
    invitation_rejected_by_user_id = case
      when invitation_rejected_by_user_id = p_subject_user_id then null
      else invitation_rejected_by_user_id end,
    invitation_rejection_acknowledged_by_user_id = case
      when invitation_rejection_acknowledged_by_user_id = p_subject_user_id then null
      else invitation_rejection_acknowledged_by_user_id end,
    updated_at = now()
  where invitation_rejected_by_user_id = p_subject_user_id
     or invitation_rejection_acknowledged_by_user_id = p_subject_user_id;

  delete from public.property_claim_invitations
  where created_by_user_id = p_subject_user_id;

  delete from public.property_ea_assignments
  where assigned_by_user_id = p_subject_user_id;

  update public.ea_branch_invitations
  set accepted_by_user_id = null, updated_at = now()
  where accepted_by_user_id = p_subject_user_id;

  delete from public.ea_branch_invitations
  where created_by_user_id = p_subject_user_id;

  update public.email_events
  set sent_by = null, updated_at = now()
  where sent_by = p_subject_user_id;

  delete from public.profiles
  where id = p_subject_user_id;

  perform public._gdpr_erasure_audit(
    p_request_id,
    'db_prepared_for_auth_deletion',
    jsonb_build_object('subject_user_id', p_subject_user_id)
  );

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public._gdpr_prepare_subject_for_auth_deletion(uuid, uuid) is
  'Clears auth.users FK blockers before Supabase Admin deleteUser. Does not delete Auth.';

revoke all on function public._gdpr_prepare_subject_for_auth_deletion(uuid, uuid) from public;
