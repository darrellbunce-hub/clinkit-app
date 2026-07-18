-- Phase 3: GDPR Right to Erasure — workflow and controlled execution RPCs
-- Requires: 20260718100000_gdpr_erasure_impact_report.sql
--           20260718110000_gdpr_erasure_execution_schema.sql

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Audit helper
-- ---------------------------------------------------------------------------

create or replace function public._gdpr_erasure_audit(
  p_request_id uuid,
  p_event_type text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.gdpr_erasure_audit_events (
    erasure_request_id,
    event_type,
    event_detail
  )
  values (
    p_request_id,
    p_event_type,
    coalesce(p_detail, '{}'::jsonb)
  );
end;
$$;

revoke all on function public._gdpr_erasure_audit(uuid, text, jsonb) from public;

-- ---------------------------------------------------------------------------
-- Scope fingerprint (material fields only — no raw PII)
-- ---------------------------------------------------------------------------

create or replace function public._gdpr_compute_scope_fingerprint(p_report jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(
    extensions.digest(
      (
          select jsonb_build_object(
            'report_version', p_report -> 'report_version',
            'property_relationships',
              coalesce(
                (
                  select jsonb_agg(
                    jsonb_build_object(
                      'property_id', elem -> 'property_id',
                      'chain_id', elem -> 'chain_id',
                      'shared_dependency_score', elem -> 'shared_dependency_score',
                      'address_treatment', elem -> 'address_treatment',
                      'is_sole_participant_candidate', elem -> 'is_sole_participant_candidate',
                      'other_active_homeowners', elem -> 'other_active_homeowners',
                      'other_active_counterparties', elem -> 'other_active_counterparties',
                      'other_active_delegates', elem -> 'other_active_delegates',
                      'active_ea_assignments', elem -> 'active_ea_assignments',
                      'other_properties_on_chain', elem -> 'other_properties_on_chain',
                      'affects_other_participants', elem -> 'affects_other_participants'
                    )
                    order by (elem ->> 'property_id')::bigint
                  )
                  from jsonb_array_elements(coalesce(p_report -> 'property_relationships', '[]'::jsonb)) elem
                ),
                '[]'::jsonb
              ),
            'risk_flags',
              coalesce(
                (
                  select jsonb_agg(flag order by flag)
                  from jsonb_array_elements_text(coalesce(p_report -> 'risk_flags', '[]'::jsonb)) flag
                ),
                '[]'::jsonb
              ),
            'email_correlated_records', coalesce(p_report -> 'email_correlated_records', '{}'::jsonb),
            'shared_transaction_dependencies',
              coalesce(p_report -> 'shared_transaction_dependencies', '{}'::jsonb),
            'direct_personal_data', coalesce(p_report -> 'direct_personal_data', '{}'::jsonb),
            'estate_agent_relationships',
              jsonb_build_object(
                'is_last_member_of_branch',
                  coalesce(p_report #>> '{estate_agent_relationships,is_last_member_of_branch}', 'false'),
                'is_last_member_of_company',
                  coalesce(p_report #>> '{estate_agent_relationships,is_last_member_of_company}', 'false')
              ),
            'analytics_snapshot_count',
              coalesce(p_report #>> '{analytics,snapshots_linked_via_source_property_id}', '0'),
            'blocking_reasons',
              coalesce(
                (
                  select jsonb_agg(reason order by reason)
                  from jsonb_array_elements_text(
                    coalesce(p_report #>> '{execution_readiness,blocking_reasons}', '[]')::jsonb
                  ) reason
                ),
                '[]'::jsonb
              )
          )::text
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function public._gdpr_compute_scope_fingerprint(jsonb) from public;

-- ---------------------------------------------------------------------------
-- Shared transaction safety re-check for a property
-- ---------------------------------------------------------------------------

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

revoke all on function public._gdpr_shared_transaction_safety_block(uuid, bigint, text) from public;

-- ---------------------------------------------------------------------------
-- GDPR-specific address redaction (distinct from lifecycle anonymisation)
-- ---------------------------------------------------------------------------

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

revoke all on function public._gdpr_redact_sole_participant_property_address(bigint, uuid) from public;
grant execute on function public._gdpr_shared_transaction_safety_block(uuid, bigint, text) to service_role;
grant execute on function public._gdpr_redact_sole_participant_property_address(bigint, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Remove subject person-property links (shared-transaction aware)
-- ---------------------------------------------------------------------------

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

revoke all on function public._gdpr_remove_subject_property_links(uuid, bigint, uuid) from public;

-- ---------------------------------------------------------------------------
-- Execute one approved action (idempotent)
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
-- Create erasure request
-- ---------------------------------------------------------------------------

create or replace function public.create_gdpr_erasure_request(
  p_subject_user_id uuid,
  p_request_source text default 'admin_manual',
  p_created_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_subject_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'subject_user_id_required');
  end if;

  if not exists (select 1 from auth.users u where u.id = p_subject_user_id) then
    return jsonb_build_object('ok', false, 'error', 'user_not_found');
  end if;

  insert into public.gdpr_erasure_requests (
    subject_user_id,
    status,
    request_source,
    created_by,
    manual_review_required
  )
  values (
    p_subject_user_id,
    'requested',
    coalesce(p_request_source, 'admin_manual'),
    p_created_by,
    true
  )
  returning id into v_id;

  perform public._gdpr_erasure_audit(v_id, 'request_created', jsonb_build_object(
    'request_source', coalesce(p_request_source, 'admin_manual')
  ));

  return jsonb_build_object('ok', true, 'request_id', v_id, 'status', 'requested');
end;
$$;

comment on function public.create_gdpr_erasure_request(uuid, text, uuid) is
  'Create GDPR erasure request. Service role only. Does not execute erasure.';

revoke all on function public.create_gdpr_erasure_request(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.create_gdpr_erasure_request(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Verify identity
-- ---------------------------------------------------------------------------

create or replace function public.verify_gdpr_erasure_identity(
  p_request_id uuid,
  p_verified_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.gdpr_erasure_requests%rowtype;
begin
  select *
  into v_request
  from public.gdpr_erasure_requests
  where id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;

  if v_request.status <> 'requested' then
    return jsonb_build_object('ok', false, 'error', 'invalid_status_transition', 'status', v_request.status);
  end if;

  update public.gdpr_erasure_requests
  set
    status = 'identity_verified',
    identity_verified_at = now(),
    verified_by = p_verified_by,
    updated_at = now()
  where id = p_request_id;

  perform public._gdpr_erasure_audit(p_request_id, 'identity_verified', '{}'::jsonb);

  return jsonb_build_object('ok', true, 'request_id', p_request_id, 'status', 'identity_verified');
end;
$$;

revoke all on function public.verify_gdpr_erasure_identity(uuid, uuid) from public, anon, authenticated;
grant execute on function public.verify_gdpr_erasure_identity(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Assess scope (Phase 2 impact report → snapshot + draft actions)
-- ---------------------------------------------------------------------------

create or replace function public.assess_gdpr_erasure_scope(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.gdpr_erasure_requests%rowtype;
  v_report jsonb;
  v_snapshot_id uuid;
  v_fingerprint text;
  v_material jsonb;
  v_action record;
  v_manual boolean := false;
begin
  select *
  into v_request
  from public.gdpr_erasure_requests
  where id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;

  if v_request.status not in ('identity_verified', 'scope_assessed', 'awaiting_approval') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status_transition', 'status', v_request.status);
  end if;

  v_report := public.generate_erasure_impact_report(v_request.subject_user_id);

  if coalesce(v_report ->> 'ok', 'false') <> 'true' then
    return jsonb_build_object('ok', false, 'error', 'impact_report_failed', 'detail', v_report);
  end if;

  v_fingerprint := public._gdpr_compute_scope_fingerprint(v_report);

  v_material := jsonb_build_object(
    'property_ids',
      coalesce(
        (
          select jsonb_agg(elem -> 'property_id' order by (elem ->> 'property_id')::bigint)
          from jsonb_array_elements(coalesce(v_report -> 'property_relationships', '[]'::jsonb)) elem
        ),
        '[]'::jsonb
      ),
    'property_count', jsonb_array_length(coalesce(v_report -> 'property_relationships', '[]'::jsonb)),
    'risk_flags', coalesce(v_report -> 'risk_flags', '[]'::jsonb),
    'shared_dependencies', coalesce(v_report -> 'shared_transaction_dependencies', '{}'::jsonb)
  );

  insert into public.gdpr_erasure_impact_snapshots (
    erasure_request_id,
    report_version,
    generated_at,
    scope_fingerprint,
    risk_flags,
    blocking_reasons,
    relationship_summary,
    proposed_actions,
    material_scope
  )
  values (
    p_request_id,
    coalesce((v_report ->> 'report_version')::int, 1),
    coalesce((v_report ->> 'generated_at')::timestamptz, now()),
    v_fingerprint,
    coalesce(v_report -> 'risk_flags', '[]'::jsonb),
    coalesce(v_report #> '{execution_readiness,blocking_reasons}', '[]'::jsonb),
    jsonb_build_object(
      'property_count', jsonb_array_length(coalesce(v_report -> 'property_relationships', '[]'::jsonb)),
      'properties', coalesce(v_report -> 'property_relationships', '[]'::jsonb)
    ),
    coalesce(v_report -> 'proposed_actions', '[]'::jsonb),
    v_material
  )
  returning id into v_snapshot_id;

  delete from public.gdpr_erasure_actions
  where erasure_request_id = p_request_id
    and status = 'draft';

  for v_action in
    select *
    from jsonb_to_recordset(coalesce(v_report -> 'proposed_actions', '[]'::jsonb))
      as x(category text, target_type text, count int, requires_manual_review boolean, reason_code text)
  loop
    v_manual := coalesce(v_action.requires_manual_review, true);

    if v_action.category = 'REMOVE_PERSON_PROPERTY_LINK' then
      insert into public.gdpr_erasure_actions (
        erasure_request_id, action_type, target_type, target_reference,
        status, reason_code, requires_manual_review
      )
      select
        p_request_id,
        'REMOVE_PERSON_PROPERTY_LINK',
        'property',
        jsonb_build_object('property_id', rel.property_id),
        'draft',
        coalesce(v_action.reason_code, 'standard_participation_removal'),
        rel.affects_other_participants
      from jsonb_to_recordset(coalesce(v_report -> 'property_relationships', '[]'::jsonb))
        as rel(property_id bigint, affects_other_participants boolean);
    elsif v_action.category = 'REDACT_SOLE_PARTICIPANT_PROPERTY_ADDRESS'
          or v_action.category = 'REVIEW_SHARED_PROPERTY_ADDRESS' then
      insert into public.gdpr_erasure_actions (
        erasure_request_id, action_type, target_type, target_reference,
        status, reason_code, requires_manual_review
      )
      select
        p_request_id,
        case
          when rel.address_treatment = 'eligible_for_redaction_review'
            then 'REDACT_SOLE_PARTICIPANT_PROPERTY_ADDRESS'
          else 'REVIEW_SHARED_PROPERTY_ADDRESS'
        end,
        'property',
        jsonb_build_object(
          'property_id', rel.property_id,
          'address_treatment', rel.address_treatment
        ),
        'draft',
        coalesce(rel.address_treatment, 'address_review'),
        rel.address_treatment <> 'eligible_for_redaction_review'
      from jsonb_to_recordset(coalesce(v_report -> 'property_relationships', '[]'::jsonb))
        as rel(property_id bigint, address_treatment text);
    else
      insert into public.gdpr_erasure_actions (
        erasure_request_id,
        action_type,
        target_type,
        target_reference,
        status,
        reason_code,
        requires_manual_review
      )
      values (
        p_request_id,
        v_action.category,
        coalesce(v_action.target_type, 'unknown'),
        '{}'::jsonb,
        'draft',
        coalesce(v_action.reason_code, 'impact_report_proposed'),
        v_manual
      );
    end if;
  end loop;

  if coalesce((v_report #>> '{analytics,snapshots_linked_via_source_property_id}')::int, 0) > 0
     and not exists (
       select 1
       from public.gdpr_erasure_actions ga
       where ga.erasure_request_id = p_request_id
         and ga.action_type = 'REMOVE_ANALYTICS_RELINK_PATH'
     ) then
    insert into public.gdpr_erasure_actions (
      erasure_request_id, action_type, target_type, status, reason_code, requires_manual_review
    )
    values (
      p_request_id,
      'REMOVE_ANALYTICS_RELINK_PATH',
      'property_analytics_snapshots',
      'draft',
      'pseudonymous_not_anonymous',
      true
    );
  end if;

  insert into public.gdpr_erasure_actions (
    erasure_request_id, action_type, target_type, status, reason_code, requires_manual_review
  )
  values (
    p_request_id,
    'REDACT_PROFILE_PERSONAL_DATA',
    'profiles',
    'draft',
    'direct_personal_data',
    false
  );

  if coalesce((v_report #>> '{estate_agent_relationships,is_last_member_of_branch}')::boolean, false)
     or coalesce((v_report #>> '{estate_agent_relationships,is_last_member_of_company}')::boolean, false) then
    v_manual := true;
  end if;

  delete from public.gdpr_erasure_processor_actions
  where erasure_request_id = p_request_id;

  if coalesce((v_report #>> '{external_processor_actions,RESEND_ERASURE_REVIEW_REQUIRED}')::boolean, false) then
    insert into public.gdpr_erasure_processor_actions (
      erasure_request_id, processor, action_type, status, required
    )
    values (p_request_id, 'resend', 'RESEND_ERASURE_REQUIRED', 'pending', true);
  end if;

  insert into public.gdpr_erasure_processor_actions (
    erasure_request_id, processor, action_type, status, required
  )
  values (p_request_id, 'vercel', 'VERCEL_LOG_RETENTION_REVIEW', 'manual_review', true);

  insert into public.gdpr_erasure_processor_actions (
    erasure_request_id, processor, action_type, status, required
  )
  values (p_request_id, 'supabase_auth', 'DELETE_AUTH_IDENTITY_LAST', 'pending', true);

  update public.gdpr_erasure_requests
  set
    status = 'awaiting_approval',
    scope_assessed_at = now(),
    scope_fingerprint = v_fingerprint,
    manual_review_required = true,
    legal_review_required = exists (
      select 1
      from jsonb_array_elements_text(coalesce(v_report -> 'risk_flags', '[]'::jsonb)) rf
      where rf in (
        'ADDRESS_RETENTION_REVIEW_REQUIRED',
        'LAST_EA_MEMBER_REVIEW_REQUIRED',
        'UNSTRUCTURED_METADATA_REVIEW_REQUIRED',
        'FREE_TEXT_PII_REVIEW_REQUIRED'
      )
    ),
    updated_at = now()
  where id = p_request_id;

  perform public._gdpr_erasure_audit(p_request_id, 'scope_assessed', jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'scope_fingerprint', v_fingerprint
  ));

  return jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'status', 'awaiting_approval',
    'snapshot_id', v_snapshot_id,
    'scope_fingerprint', v_fingerprint,
    'draft_action_count', (select count(*) from public.gdpr_erasure_actions where erasure_request_id = p_request_id)
  );
end;
$$;

revoke all on function public.assess_gdpr_erasure_scope(uuid) from public, anon, authenticated;
grant execute on function public.assess_gdpr_erasure_scope(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Approval status helper
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

revoke all on function public._gdpr_action_status_on_approval(text) from public;

-- ---------------------------------------------------------------------------
-- Approve request and lock execution plan
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
-- Reject request
-- ---------------------------------------------------------------------------

create or replace function public.reject_gdpr_erasure_request(
  p_request_id uuid,
  p_reason_code text default 'rejected_by_admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.gdpr_erasure_requests
  set
    status = 'rejected',
    rejected_at = now(),
    rejection_reason_code = p_reason_code,
    updated_at = now()
  where id = p_request_id
    and status not in ('completed', 'rejected', 'processing');

  if not found then
    return jsonb_build_object('ok', false, 'error', 'reject_not_allowed');
  end if;

  perform public._gdpr_erasure_audit(p_request_id, 'rejected', jsonb_build_object('reason_code', p_reason_code));

  return jsonb_build_object('ok', true, 'request_id', p_request_id, 'status', 'rejected');
end;
$$;

revoke all on function public.reject_gdpr_erasure_request(uuid, text) from public, anon, authenticated;
grant execute on function public.reject_gdpr_erasure_request(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Main executor
-- ---------------------------------------------------------------------------

create or replace function public.execute_gdpr_erasure_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.gdpr_erasure_requests%rowtype;
  v_fresh jsonb;
  v_fresh_fingerprint text;
  v_action record;
  v_result jsonb;
  v_completed integer := 0;
  v_skipped integer := 0;
  v_blocked integer := 0;
  v_failed integer := 0;
  v_pending_external integer := 0;
  v_blocking_reasons text[] := array[]::text[];
  v_next_steps text[] := array[]::text[];
  v_final_status text;
  v_claim_token text;
begin
  select *
  into v_request
  from public.gdpr_erasure_requests
  where id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;

  if v_request.status in ('completed', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'request_terminal', 'status', v_request.status);
  end if;

  if v_request.status not in ('approved', 'processing', 'database_processed', 'partially_completed', 'awaiting_external_processors', 'awaiting_auth_deletion') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status_for_execution', 'status', v_request.status);
  end if;

  if v_request.identity_verified_at is null
     or v_request.approved_at is null
     or v_request.approved_snapshot_id is null then
    return jsonb_build_object('ok', false, 'error', 'approval_incomplete');
  end if;

  if v_request.status = 'processing'
     and v_request.execution_claimed_at is not null
     and v_request.execution_claimed_at > now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'error', 'execution_claimed');
  end if;

  v_claim_token := encode(extensions.gen_random_bytes(16), 'hex');

  v_fresh := public.generate_erasure_impact_report(v_request.subject_user_id);
  v_fresh_fingerprint := public._gdpr_compute_scope_fingerprint(v_fresh);

  if v_fresh_fingerprint is distinct from v_request.scope_fingerprint then
    perform public._gdpr_erasure_audit(p_request_id, 'scope_changed', jsonb_build_object(
      'approved_fingerprint', v_request.scope_fingerprint,
      'fresh_fingerprint', v_fresh_fingerprint
    ));
    return jsonb_build_object(
      'ok', false,
      'error', 'ERASURE_SCOPE_CHANGED_REASSESSMENT_REQUIRED',
      'approved_fingerprint', v_request.scope_fingerprint,
      'fresh_fingerprint', v_fresh_fingerprint
    );
  end if;

  update public.gdpr_erasure_requests
  set
    status = 'processing',
    execution_started_at = coalesce(execution_started_at, now()),
    execution_claimed_at = now(),
    execution_claim_token = v_claim_token,
    updated_at = now()
  where id = p_request_id;

  for v_action in
    select id, action_type, status
    from public.gdpr_erasure_actions
    where erasure_request_id = p_request_id
      and status in ('approved', 'completed', 'skipped_idempotent')
    order by
      case action_type
        when 'REMOVE_PERSON_PROPERTY_LINK' then 1
        when 'REDACT_PROFILE_PERSONAL_DATA' then 2
        when 'REDACT_EMAIL_REFERENCE' then 3
        when 'NULL_HISTORICAL_ACTOR_REFERENCE' then 4
        when 'REDACT_SOLE_PARTICIPANT_PROPERTY_ADDRESS' then 5
        when 'REMOVE_ANALYTICS_RELINK_PATH' then 6
        when 'DELETE_AUTH_IDENTITY_LAST' then 99
        else 50
      end,
      created_at
  loop
    if v_action.status in ('completed', 'skipped_idempotent') then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_result := public._gdpr_execute_erasure_action(v_action.id, p_request_id);

    if coalesce(v_result ->> 'ok', 'false') = 'true'
       and coalesce(v_result ->> 'idempotent', 'false') = 'true' then
      v_skipped := v_skipped + 1;
    elsif coalesce(v_result ->> 'ok', 'false') = 'true' then
      v_completed := v_completed + 1;
    elsif v_result ->> 'error' = 'SHARED_TRANSACTION_SAFETY_BLOCK' then
      v_blocked := v_blocked + 1;
      v_blocking_reasons := array_append(v_blocking_reasons, 'SHARED_TRANSACTION_SAFETY_BLOCK');
    elsif v_result ->> 'error' = 'manual_review_required' then
      v_blocked := v_blocked + 1;
      v_blocking_reasons := array_append(v_blocking_reasons, 'MANUAL_REVIEW_REQUIRED');
    else
      v_failed := v_failed + 1;
    end if;
  end loop;

  select count(*)::int
  into v_pending_external
  from public.gdpr_erasure_processor_actions pa
  where pa.erasure_request_id = p_request_id
    and pa.required
    and pa.processor <> 'supabase_auth'
    and pa.status in ('pending', 'manual_review');

  if exists (
    select 1
    from public.gdpr_erasure_actions
    where erasure_request_id = p_request_id
      and action_type = 'DELETE_AUTH_IDENTITY_LAST'
      and status in ('approved', 'pending_manual')
  ) then
    v_next_steps := array_append(v_next_steps, 'AUTH_DELETION_PENDING');
  end if;

  if v_pending_external > 0 then
    v_next_steps := array_append(v_next_steps, 'RESEND_ERASURE_REQUIRED');
  end if;

  if v_blocked > 0 or v_failed > 0 then
    v_final_status := case
      when v_completed > 0 then 'partially_completed'
      else 'manual_review_required'
    end;
  else
    v_final_status := 'awaiting_auth_deletion';
  end if;

  update public.gdpr_erasure_requests
  set
    status = v_final_status,
    database_processing_completed_at = now(),
    partially_completed_at = case when v_final_status = 'partially_completed' then now() else partially_completed_at end,
    execution_claimed_at = null,
    execution_claim_token = null,
    updated_at = now()
  where id = p_request_id;

  perform public._gdpr_erasure_audit(p_request_id, 'execution_pass_completed', jsonb_build_object(
    'completed', v_completed,
    'skipped', v_skipped,
    'blocked', v_blocked,
    'failed', v_failed,
    'pending_external', v_pending_external,
    'final_status', v_final_status
  ));

  return jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'status', v_final_status,
    'actions', jsonb_build_object(
      'completed', v_completed,
      'skipped_idempotent', v_skipped,
      'blocked', v_blocked,
      'failed', v_failed,
      'pending_external', v_pending_external
    ),
    'blocking_reasons', to_jsonb(v_blocking_reasons),
    'next_required_steps', to_jsonb(v_next_steps)
  );
end;
$$;

comment on function public.execute_gdpr_erasure_request(uuid) is
  'Controlled GDPR erasure database executor. Requires approved request and fresh scope match. Auth deletion is separate.';

revoke all on function public.execute_gdpr_erasure_request(uuid) from public, anon, authenticated;
grant execute on function public.execute_gdpr_erasure_request(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Prepare DB for Auth deletion (clear remaining FK references)
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

  delete from public.profiles where id = p_subject_user_id;

  perform public._gdpr_erasure_audit(
    p_request_id,
    'db_prepared_for_auth_deletion',
    jsonb_build_object('subject_user_id', p_subject_user_id)
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public._gdpr_prepare_subject_for_auth_deletion(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- Mark Auth deletion eligibility / completion
-- ---------------------------------------------------------------------------

create or replace function public.mark_gdpr_erasure_auth_deletion_eligible(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.gdpr_erasure_requests%rowtype;
  v_pending_db integer;
begin
  select * into v_request
  from public.gdpr_erasure_requests
  where id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;

  if v_request.status not in ('awaiting_auth_deletion', 'partially_completed', 'awaiting_external_processors') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status', 'status', v_request.status);
  end if;

  select count(*)::int
  into v_pending_db
  from public.gdpr_erasure_actions
  where erasure_request_id = p_request_id
    and status = 'approved';

  if v_pending_db > 0 then
    return jsonb_build_object('ok', false, 'error', 'pending_db_actions');
  end if;

  perform public._gdpr_prepare_subject_for_auth_deletion(v_request.subject_user_id, p_request_id);

  update public.gdpr_erasure_requests
  set status = 'awaiting_auth_deletion', updated_at = now()
  where id = p_request_id;

  return jsonb_build_object('ok', true, 'status', 'awaiting_auth_deletion');
end;
$$;

revoke all on function public.mark_gdpr_erasure_auth_deletion_eligible(uuid) from public, anon, authenticated;
grant execute on function public.mark_gdpr_erasure_auth_deletion_eligible(uuid) to service_role;

create or replace function public.complete_gdpr_erasure_auth_deletion(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.gdpr_erasure_requests%rowtype;
  v_pending_external integer;
begin
  select * into v_request
  from public.gdpr_erasure_requests
  where id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;

  if v_request.status <> 'awaiting_auth_deletion' then
    return jsonb_build_object('ok', false, 'error', 'invalid_status', 'status', v_request.status);
  end if;

  if v_request.database_processing_completed_at is null then
    return jsonb_build_object('ok', false, 'error', 'database_processing_not_complete');
  end if;

  if not exists (select 1 from auth.users u where u.id = v_request.subject_user_id) then
    update public.gdpr_erasure_processor_actions
    set status = 'completed', completed_at = now(), updated_at = now()
    where erasure_request_id = p_request_id
      and processor = 'supabase_auth';

    update public.gdpr_erasure_actions
    set status = 'skipped_idempotent', executed_at = now(), updated_at = now()
    where erasure_request_id = p_request_id
      and action_type = 'DELETE_AUTH_IDENTITY_LAST';

    -- idempotent: auth already absent
  else
    return jsonb_build_object(
      'ok', false,
      'error', 'auth_user_still_present',
      'note', 'Invoke Supabase Admin API deleteUser after this check, then call again'
    );
  end if;

  select count(*)::int
  into v_pending_external
  from public.gdpr_erasure_processor_actions
  where erasure_request_id = p_request_id
    and required
    and processor <> 'supabase_auth'
    and status in ('pending', 'manual_review');

  update public.gdpr_erasure_requests
  set
    auth_deletion_completed_at = now(),
    status = case
      when v_pending_external > 0 then 'partially_completed'
      else 'completed'
    end,
    completed_at = case when v_pending_external = 0 then now() else null end,
    partially_completed_at = case when v_pending_external > 0 then now() else partially_completed_at end,
    updated_at = now()
  where id = p_request_id;

  perform public._gdpr_erasure_audit(p_request_id, 'auth_deletion_completed', '{}'::jsonb);

  return jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'status', case when v_pending_external > 0 then 'partially_completed' else 'completed' end,
    'pending_external', v_pending_external
  );
end;
$$;

revoke all on function public.complete_gdpr_erasure_auth_deletion(uuid) from public, anon, authenticated;
grant execute on function public.complete_gdpr_erasure_auth_deletion(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Read request status (no PII)
-- ---------------------------------------------------------------------------

create or replace function public.get_gdpr_erasure_request_status(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_request public.gdpr_erasure_requests%rowtype;
begin
  select * into v_request
  from public.gdpr_erasure_requests
  where id = p_request_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request.id,
    'subject_user_id', v_request.subject_user_id,
    'status', v_request.status,
    'scope_fingerprint', v_request.scope_fingerprint,
    'approved_snapshot_id', v_request.approved_snapshot_id,
    'manual_review_required', v_request.manual_review_required,
    'legal_review_required', v_request.legal_review_required,
    'action_summary', (
      select jsonb_object_agg(status, cnt)
      from (
        select status, count(*)::int as cnt
        from public.gdpr_erasure_actions
        where erasure_request_id = p_request_id
        group by status
      ) s
    ),
    'processor_summary', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'processor', pa.processor,
        'action_type', pa.action_type,
        'status', pa.status,
        'required', pa.required
      )), '[]'::jsonb)
      from public.gdpr_erasure_processor_actions pa
      where pa.erasure_request_id = p_request_id
    )
  );
end;
$$;

revoke all on function public.get_gdpr_erasure_request_status(uuid) from public, anon, authenticated;
grant execute on function public.get_gdpr_erasure_request_status(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Mark external processor action (manual completion only)
-- ---------------------------------------------------------------------------

create or replace function public.update_gdpr_erasure_processor_action(
  p_request_id uuid,
  p_processor text,
  p_status text,
  p_failure_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('pending', 'completed', 'failed', 'not_required', 'manual_review') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  if p_processor = 'resend' and p_status = 'completed' then
    perform public._gdpr_erasure_audit(p_request_id, 'resend_marked_completed_manually', '{}'::jsonb);
  end if;

  update public.gdpr_erasure_processor_actions
  set
    status = p_status,
    completed_at = case when p_status = 'completed' then now() else completed_at end,
    failure_code = p_failure_code,
    updated_at = now()
  where erasure_request_id = p_request_id
    and processor = p_processor;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'processor_action_not_found');
  end if;

  return jsonb_build_object('ok', true, 'processor', p_processor, 'status', p_status);
end;
$$;

revoke all on function public.update_gdpr_erasure_processor_action(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.update_gdpr_erasure_processor_action(uuid, text, text, text) to service_role;
