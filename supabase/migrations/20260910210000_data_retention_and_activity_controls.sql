-- Data retention automation + structured activity enforcement.
--
-- Working product policy (not statutory mandates):
--   email_events: redact identifiable fields after 90 days; delete redacted rows after 24 months
--   billing_customer_email_dispatches: redact recipient_email after 24 months (ledger rows retained)
--   invitations: redact invite PII 30 days after expiry/revocation (token hashes retained)
--   activities.update: reject arbitrary free text; allow structured/system producers only
--
-- Does NOT change property-lifecycle state machine cron or thresholds.
-- Retention HTTP orchestration is separate (/api/cron/data-retention).

-- ---------------------------------------------------------------------------
-- 1) Maintenance job audit trail (non-personal)
-- ---------------------------------------------------------------------------

create table if not exists public.maintenance_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  status text not null
    check (status in ('running', 'succeeded', 'failed', 'partial')),
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  records_scanned integer not null default 0,
  records_redacted integer not null default 0,
  records_deleted integer not null default 0,
  error_count integer not null default 0,
  detail jsonb not null default '{}'::jsonb,
  error_summary text null,
  constraint maintenance_job_runs_job_type_check
    check (
      job_type in (
        'data_retention',
        'retain_email_events',
        'retain_billing_email_dispatches',
        'retain_invitation_pii'
      )
    )
);

create index if not exists maintenance_job_runs_started_at_idx
  on public.maintenance_job_runs (started_at desc);

create index if not exists maintenance_job_runs_job_type_started_idx
  on public.maintenance_job_runs (job_type, started_at desc);

comment on table public.maintenance_job_runs is
  'Durable non-personal audit of maintenance/retention cron runs. Never store PII payloads.';

alter table public.maintenance_job_runs enable row level security;

revoke all on table public.maintenance_job_runs from public, anon, authenticated;
grant select, insert, update on table public.maintenance_job_runs to service_role;

create or replace function public.begin_maintenance_job_run(
  p_job_type text,
  p_detail jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_job_type not in (
    'data_retention',
    'retain_email_events',
    'retain_billing_email_dispatches',
    'retain_invitation_pii'
  ) then
    raise exception 'invalid_job_type';
  end if;

  insert into public.maintenance_job_runs (job_type, status, detail)
  values (p_job_type, 'running', coalesce(p_detail, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.complete_maintenance_job_run(
  p_run_id uuid,
  p_status text,
  p_records_scanned integer default 0,
  p_records_redacted integer default 0,
  p_records_deleted integer default 0,
  p_error_count integer default 0,
  p_detail jsonb default '{}'::jsonb,
  p_error_summary text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('succeeded', 'failed', 'partial') then
    raise exception 'invalid_job_status';
  end if;

  update public.maintenance_job_runs
  set
    status = p_status,
    completed_at = now(),
    records_scanned = greatest(coalesce(p_records_scanned, 0), 0),
    records_redacted = greatest(coalesce(p_records_redacted, 0), 0),
    records_deleted = greatest(coalesce(p_records_deleted, 0), 0),
    error_count = greatest(coalesce(p_error_count, 0), 0),
    detail = coalesce(detail, '{}'::jsonb) || coalesce(p_detail, '{}'::jsonb),
    error_summary = left(nullif(trim(p_error_summary), ''), 500)
  where id = p_run_id
    and status = 'running';
end;
$$;

revoke all on function public.begin_maintenance_job_run(text, jsonb) from public, anon, authenticated;
revoke all on function public.complete_maintenance_job_run(uuid, text, integer, integer, integer, integer, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.begin_maintenance_job_run(text, jsonb) to service_role;
grant execute on function public.complete_maintenance_job_run(uuid, text, integer, integer, integer, integer, jsonb, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2) Structured activity enforcement
-- ---------------------------------------------------------------------------

create or replace function public.is_allowed_structured_activity_update(
  p_update text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_text text := p_update;
  v_reason text;
  v_delay_reason text;
begin
  if v_text is null or length(trim(v_text)) = 0 then
    return false;
  end if;

  -- Title-cased stage values (property page) and catalogue labels (buyer ready / stages).
  if v_text in (
    'Searching',
    'Next Home Search',
    'Property Listed',
    'Offer Accepted',
    'Solicitors Instructed',
    'Searches Ordered',
    'Survey Booked',
    'Searches Returned',
    'Survey Completed',
    'Mortgage Offer Received',
    'Enquiries Raised',
    'Enquiries Fully Answered',
    'Contracts Issued',
    'Ready To Exchange',
    'Contracts Exchanged',
    'Completion Date Agreed',
    'Completed',
    'Mortgage In Principle',
    'Mortgage Application',
    'Mortgage Application Submitted',
    'Solicitor Instructed',
    'Enquiries Reviewed',
    'Contracts Signed',
    'Exchange Contracts',
    'Onward purchase added',
    'Chain Connection Broken - Buyer Side',
    'Chain Connection Broken - Seller Side',
    'Homeowner left this transaction. The property has been released.',
    'Homeowner removed the estate agent branch from this property.',
    'Estate agent branch released operational management of this property.',
    'Estate agent withdrew the homeowner association for this property. The invitation can be re-sent.',
    'Property operational participation archived by lifecycle automation.',
    'Property released for future transactions. Historic chain data retained.',
    E'Completion Confirmed\n\nTransaction marked as completed.'
  ) then
    return true;
  end if;

  -- Operational delay activities (allowlisted reasons only).
  if v_text like 'Delay reported — %' then
    v_delay_reason := substr(v_text, length('Delay reported — ') + 1);
    return v_delay_reason in (
      'Awaiting Searches',
      'Awaiting Mortgage Offer',
      'Awaiting Signed Documents',
      'Awaiting Survey Results',
      'Awaiting Management Pack'
    );
  end if;

  if v_text like 'Delay resolved — %' then
    v_delay_reason := substr(v_text, length('Delay resolved — ') + 1);
    return v_delay_reason in (
      'Awaiting Searches',
      'Awaiting Mortgage Offer',
      'Awaiting Signed Documents',
      'Awaiting Survey Results',
      'Awaiting Management Pack'
    );
  end if;

  -- Completion date amendment template (dates variable; reason labels finite).
  if v_text ~ E'^Completion date updated\\n\\n.+\\n\\nReason:\\n.+$' then
    v_reason := split_part(v_text, E'Reason:\n', 2);
    return v_reason in (
      'Solicitors agreed a revised completion date',
      'Chain dependency required date adjustment',
      'Mortgage or lender timing required date adjustment',
      'Removal or logistics availability required date adjustment',
      'Developer or new-build timing required date adjustment',
      'Completion date entered incorrectly',
      'Administrative correction'
    );
  end if;

  return false;
end;
$$;

comment on function public.is_allowed_structured_activity_update(text) is
  'True when activities.update matches structured/system producers. Rejects arbitrary free text.';

revoke all on function public.is_allowed_structured_activity_update(text) from public, anon, authenticated;
grant execute on function public.is_allowed_structured_activity_update(text) to authenticated, service_role;

create or replace function public.trg_enforce_structured_activity_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_allowed_structured_activity_update(new.update) then
    raise exception 'activities_update_not_structured'
      using errcode = 'check_violation',
            hint = 'activities.update must be a structured/system-generated value';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_structured_activity_update on public.activities;
create trigger trg_enforce_structured_activity_update
  before insert or update of update
  on public.activities
  for each row
  execute function public.trg_enforce_structured_activity_update();

revoke all on function public.trg_enforce_structured_activity_update() from public, anon, authenticated;
grant execute on function public.trg_enforce_structured_activity_update() to service_role;

-- ---------------------------------------------------------------------------
-- 3) Email events retention
-- ---------------------------------------------------------------------------

create or replace function public.preview_retain_email_events_batch(
  p_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(least(coalesce(p_limit, 200), 500), 1);
  v_redact_candidates integer := 0;
  v_delete_candidates integer := 0;
begin
  select count(*)::int
  into v_redact_candidates
  from (
    select 1
    from public.email_events ee
    where ee.created_at < now() - interval '90 days'
      and ee.recipient_email not like 'redacted+%@erased.local'
    order by ee.created_at asc
    limit v_limit
  ) s;

  select count(*)::int
  into v_delete_candidates
  from (
    select 1
    from public.email_events ee
    where ee.created_at < now() - interval '24 months'
      and ee.recipient_email like 'redacted+%@erased.local'
    order by ee.created_at asc
    limit v_limit
  ) s;

  return jsonb_build_object(
    'ok', true,
    'dry_run', true,
    'limit', v_limit,
    'redact_candidates', v_redact_candidates,
    'delete_candidates', v_delete_candidates
  );
end;
$$;

create or replace function public.retain_email_events_batch(
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(least(coalesce(p_limit, 200), 500), 1);
  v_redacted integer := 0;
  v_deleted integer := 0;
  v_scanned integer := 0;
begin
  -- Prefer retain over delete: only redact clearly aged identifiable rows.
  with candidates as (
    select ee.id
    from public.email_events ee
    where ee.created_at < now() - interval '90 days'
      and ee.recipient_email not like 'redacted+%@erased.local'
    order by ee.created_at asc
    limit v_limit
    for update skip locked
  )
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
  from candidates c
  where ee.id = c.id;

  get diagnostics v_redacted = row_count;
  v_scanned := v_scanned + v_redacted;

  -- Delete only already-redacted rows older than 24 months (fail-closed).
  with candidates as (
    select ee.id
    from public.email_events ee
    where ee.created_at < now() - interval '24 months'
      and ee.recipient_email like 'redacted+%@erased.local'
    order by ee.created_at asc
    limit v_limit
    for update skip locked
  )
  delete from public.email_events ee
  using candidates c
  where ee.id = c.id;

  get diagnostics v_deleted = row_count;
  v_scanned := v_scanned + v_deleted;

  return jsonb_build_object(
    'ok', true,
    'scanned', v_scanned,
    'redacted', v_redacted,
    'deleted', v_deleted,
    'limit', v_limit
  );
end;
$$;

comment on function public.retain_email_events_batch(integer) is
  'Retention: redact email_events PII after 90 days; delete redacted rows after 24 months. service_role only.';

revoke all on function public.preview_retain_email_events_batch(integer) from public, anon, authenticated;
revoke all on function public.retain_email_events_batch(integer) from public, anon, authenticated;
grant execute on function public.preview_retain_email_events_batch(integer) to service_role;
grant execute on function public.retain_email_events_batch(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4) Billing email dispatch retention (+ GDPR helper)
-- ---------------------------------------------------------------------------

create or replace function public._gdpr_redact_billing_customer_email_dispatches(
  p_email text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_rows integer := 0;
begin
  if v_email = '' or v_email like 'redacted+%@erased.local' then
    return 0;
  end if;

  update public.billing_customer_email_dispatches d
  set
    recipient_email = 'redacted+' || md5(d.dispatch_key) || '@erased.local',
    error_message = case
      when d.error_message is not null then left('[redacted]', 500)
      else null
    end,
    updated_at = timezone('utc', now())
  where lower(trim(d.recipient_email)) = v_email
    and d.recipient_email not like 'redacted+%@erased.local';

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public._gdpr_redact_billing_customer_email_dispatches(text)
  from public, anon, authenticated;
grant execute on function public._gdpr_redact_billing_customer_email_dispatches(text) to service_role;

create or replace function public.preview_retain_billing_email_dispatches_batch(
  p_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(least(coalesce(p_limit, 200), 500), 1);
  v_candidates integer := 0;
begin
  select count(*)::int
  into v_candidates
  from (
    select 1
    from public.billing_customer_email_dispatches d
    where d.created_at < timezone('utc', now()) - interval '24 months'
      and d.recipient_email not like 'redacted+%@erased.local'
    order by d.created_at asc
    limit v_limit
  ) s;

  return jsonb_build_object(
    'ok', true,
    'dry_run', true,
    'limit', v_limit,
    'redact_candidates', v_candidates,
    'delete_candidates', 0,
    'note', 'ledger rows are retained; recipient_email redacted only'
  );
end;
$$;

create or replace function public.retain_billing_email_dispatches_batch(
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(least(coalesce(p_limit, 200), 500), 1);
  v_redacted integer := 0;
begin
  -- Do not delete ledger rows (idempotency / billing audit). Redact only.
  with candidates as (
    select d.dispatch_key
    from public.billing_customer_email_dispatches d
    where d.created_at < timezone('utc', now()) - interval '24 months'
      and d.recipient_email not like 'redacted+%@erased.local'
    order by d.created_at asc
    limit v_limit
    for update skip locked
  )
  update public.billing_customer_email_dispatches d
  set
    recipient_email = 'redacted+' || md5(d.dispatch_key) || '@erased.local',
    error_message = case
      when d.error_message is not null then left('[redacted]', 500)
      else null
    end,
    updated_at = timezone('utc', now())
  from candidates c
  where d.dispatch_key = c.dispatch_key;

  get diagnostics v_redacted = row_count;

  return jsonb_build_object(
    'ok', true,
    'scanned', v_redacted,
    'redacted', v_redacted,
    'deleted', 0,
    'limit', v_limit
  );
end;
$$;

comment on function public.retain_billing_email_dispatches_batch(integer) is
  'Retention: redact billing_customer_email_dispatches.recipient_email after 24 months; keep ledger rows.';

revoke all on function public.preview_retain_billing_email_dispatches_batch(integer)
  from public, anon, authenticated;
revoke all on function public.retain_billing_email_dispatches_batch(integer)
  from public, anon, authenticated;
grant execute on function public.preview_retain_billing_email_dispatches_batch(integer) to service_role;
grant execute on function public.retain_billing_email_dispatches_batch(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 5) Invitation PII retention (30 days after expiry/revocation)
-- ---------------------------------------------------------------------------

create or replace function public.preview_retain_invitation_pii_batch(
  p_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(least(coalesce(p_limit, 200), 500), 1);
  v_claim integer := 0;
  v_ea integer := 0;
begin
  select count(*)::int into v_claim
  from (
    select 1
    from public.property_claim_metadata pcm
    where pcm.invite_email is not null
      and exists (
        select 1
        from public.property_claim_invitations pci
        where pci.property_id = pcm.property_id
          and pci.invitation_expires_at < now() - interval '30 days'
          and pci.invitation_used_at is null
      )
      and not exists (
        select 1
        from public.property_claim_invitations pci2
        where pci2.property_id = pcm.property_id
          and pci2.invitation_expires_at > now()
          and pci2.invitation_used_at is null
          and pci2.invitation_revoked_at is null
      )
    limit v_limit
  ) s;

  select count(*)::int into v_ea
  from (
    select 1
    from public.ea_branch_invitations ebi
    where ebi.invitation_expires_at < now() - interval '30 days'
      and ebi.accepted_by_user_id is null
      and ebi.invite_email not like 'redacted+%@erased.local'
    order by ebi.invitation_expires_at asc
    limit v_limit
  ) s;

  return jsonb_build_object(
    'ok', true,
    'dry_run', true,
    'claim_metadata_candidates', v_claim,
    'ea_invitation_candidates', v_ea,
    'limit', v_limit
  );
end;
$$;

create or replace function public.retain_invitation_pii_batch(
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(least(coalesce(p_limit, 200), 500), 1);
  v_claim integer := 0;
  v_ea integer := 0;
begin
  -- Null claim invite emails when no active invite remains and latest expired > 30d ago.
  with candidates as (
    select pcm.property_id
    from public.property_claim_metadata pcm
    where pcm.invite_email is not null
      and exists (
        select 1
        from public.property_claim_invitations pci
        where pci.property_id = pcm.property_id
          and pci.invitation_expires_at < now() - interval '30 days'
          and pci.invitation_used_at is null
      )
      and not exists (
        select 1
        from public.property_claim_invitations pci2
        where pci2.property_id = pcm.property_id
          and pci2.invitation_expires_at > now()
          and pci2.invitation_used_at is null
          and pci2.invitation_revoked_at is null
      )
    order by pcm.property_id
    limit v_limit
    for update skip locked
  )
  update public.property_claim_metadata pcm
  set
    invite_email = null,
    invite_display_name = null,
    updated_at = now()
  from candidates c
  where pcm.property_id = c.property_id;

  get diagnostics v_claim = row_count;

  with candidates as (
    select ebi.id
    from public.ea_branch_invitations ebi
    where ebi.invitation_expires_at < now() - interval '30 days'
      and ebi.accepted_by_user_id is null
      and ebi.invite_email not like 'redacted+%@erased.local'
    order by ebi.invitation_expires_at asc
    limit v_limit
    for update skip locked
  )
  update public.ea_branch_invitations ebi
  set
    invite_email = 'redacted+' || ebi.id::text || '@erased.local',
    invite_name = '[redacted]',
    updated_at = now()
  from candidates c
  where ebi.id = c.id;

  get diagnostics v_ea = row_count;

  return jsonb_build_object(
    'ok', true,
    'scanned', v_claim + v_ea,
    'redacted', v_claim + v_ea,
    'deleted', 0,
    'claim_metadata_redacted', v_claim,
    'ea_invitations_redacted', v_ea,
    'limit', v_limit
  );
end;
$$;

comment on function public.retain_invitation_pii_batch(integer) is
  'Retention: redact invitation emails 30 days after expiry/revocation; keep token hashes.';

revoke all on function public.preview_retain_invitation_pii_batch(integer)
  from public, anon, authenticated;
revoke all on function public.retain_invitation_pii_batch(integer)
  from public, anon, authenticated;
grant execute on function public.preview_retain_invitation_pii_batch(integer) to service_role;
grant execute on function public.retain_invitation_pii_batch(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 6) GDPR: include billing dispatch redaction in REDACT_EMAIL_REFERENCE
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
  v_billing_rows integer := 0;
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

        v_billing_rows := public._gdpr_redact_billing_customer_email_dispatches(v_email);
      end if;

      update public.email_events
      set sent_by = null, updated_at = now()
      where sent_by = v_subject;

      update public.gdpr_erasure_actions
      set
        status = 'completed',
        executed_at = now(),
        execution_detail = jsonb_build_object(
          'email_events_redacted', v_rows,
          'billing_dispatches_redacted', v_billing_rows
        ),
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

revoke all on function public._gdpr_execute_erasure_action(uuid, uuid) from public, anon, authenticated;
grant execute on function public._gdpr_execute_erasure_action(uuid, uuid) to service_role;
