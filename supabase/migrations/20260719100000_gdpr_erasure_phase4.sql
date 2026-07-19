-- Phase 4: Suppression ledger, processor completion semantics, restore matching RPCs.
-- Development only — do not apply remotely without approval.

-- ---------------------------------------------------------------------------
-- Request metadata
-- ---------------------------------------------------------------------------

alter table public.gdpr_erasure_requests
  add column if not exists suppression_recorded_at timestamptz null;

comment on column public.gdpr_erasure_requests.suppression_recorded_at is
  'Timestamp when keyed suppression fingerprints were recorded (before Auth deletion).';

-- ---------------------------------------------------------------------------
-- Processor actions — extended status model
-- ---------------------------------------------------------------------------

alter table public.gdpr_erasure_processor_actions
  drop constraint if exists gdpr_erasure_processor_actions_status_check;

alter table public.gdpr_erasure_processor_actions
  add column if not exists status_code text null,
  add column if not exists operator_user_id uuid null;

alter table public.gdpr_erasure_processor_actions
  add constraint gdpr_erasure_processor_actions_status_check check (
    status in (
      'pending',
      'manual_review',
      'processing',
      'completed',
      'failed',
      'not_required',
      'not_applicable',
      'retention_expiry'
    )
  );

comment on column public.gdpr_erasure_processor_actions.status_code is
  'Structured processor status code without free-text PII.';

-- ---------------------------------------------------------------------------
-- Suppression ledger hardening
-- ---------------------------------------------------------------------------

create unique index if not exists gdpr_erasure_suppression_ledger_request_uidx
  on public.gdpr_erasure_suppression_ledger (erasure_request_id);

create index if not exists gdpr_erasure_suppression_ledger_user_hash_idx
  on public.gdpr_erasure_suppression_ledger (subject_user_id_hash);

create index if not exists gdpr_erasure_suppression_ledger_email_hash_idx
  on public.gdpr_erasure_suppression_ledger (email_hash)
  where email_hash is not null;

alter table public.gdpr_erasure_suppression_ledger
  drop constraint if exists gdpr_erasure_suppression_ledger_no_raw_email;

alter table public.gdpr_erasure_suppression_ledger
  add constraint gdpr_erasure_suppression_ledger_no_raw_email check (
    (email_hash is null or email_hash !~ '@')
    and subject_user_id_hash !~ '@'
  );

comment on column public.gdpr_erasure_suppression_ledger.email_hash is
  'HMAC-SHA-256 identity fingerprint for normalised email. Not raw email. Column name retained for compatibility.';

comment on column public.gdpr_erasure_suppression_ledger.subject_user_id_hash is
  'HMAC-SHA-256 fingerprint for auth user id. Not raw UUID stored in reversible form.';

comment on table public.gdpr_erasure_suppression_ledger is
  'Keyed suppression fingerprints for backup restore re-erasure. HMAC applied server-side; pepper never stored in DB.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public._gdpr_count_blocking_processors(p_request_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.gdpr_erasure_processor_actions pa
  where pa.erasure_request_id = p_request_id
    and pa.required
    and pa.processor <> 'supabase_auth'
    and pa.status in ('pending', 'manual_review', 'processing', 'failed');
$$;

revoke all on function public._gdpr_count_blocking_processors(uuid) from public, anon, authenticated;

create or replace function public.recompute_gdpr_erasure_completion(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.gdpr_erasure_requests%rowtype;
  v_blocking integer;
begin
  select * into v_request
  from public.gdpr_erasure_requests
  where id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;

  if v_request.auth_deletion_completed_at is null then
    return jsonb_build_object(
      'ok', true,
      'request_id', p_request_id,
      'status', v_request.status,
      'note', 'auth_deletion_not_complete'
    );
  end if;

  v_blocking := public._gdpr_count_blocking_processors(p_request_id);

  update public.gdpr_erasure_requests
  set
    status = case when v_blocking = 0 then 'completed' else 'partially_completed' end,
    completed_at = case when v_blocking = 0 then coalesce(completed_at, now()) else null end,
    partially_completed_at = case when v_blocking > 0 then coalesce(partially_completed_at, now()) else partially_completed_at end,
    updated_at = now()
  where id = p_request_id;

  perform public._gdpr_erasure_audit(
    p_request_id,
    'completion_recomputed',
    jsonb_build_object('blocking_processors', v_blocking)
  );

  return jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'status', case when v_blocking = 0 then 'completed' else 'partially_completed' end,
    'blocking_processors', v_blocking
  );
end;
$$;

revoke all on function public.recompute_gdpr_erasure_completion(uuid) from public, anon, authenticated;
grant execute on function public.recompute_gdpr_erasure_completion(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Record suppression ledger (idempotent)
-- ---------------------------------------------------------------------------

create or replace function public.record_gdpr_erasure_suppression_ledger(
  p_request_id uuid,
  p_subject_user_id_hash text,
  p_email_identity_fingerprint text,
  p_hash_algorithm text default 'hmac_sha256_v1'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_request_id is null then
    return jsonb_build_object('ok', false, 'error', 'request_id_required');
  end if;

  if p_subject_user_id_hash is null or length(trim(p_subject_user_id_hash)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'subject_user_id_hash_required');
  end if;

  if p_email_identity_fingerprint is null or length(trim(p_email_identity_fingerprint)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'email_identity_fingerprint_required');
  end if;

  if p_subject_user_id_hash ~ '@' or p_email_identity_fingerprint ~ '@' then
    return jsonb_build_object('ok', false, 'error', 'raw_email_not_permitted');
  end if;

  if not exists (
    select 1
    from public.gdpr_erasure_requests r
    where r.id = p_request_id
      and r.database_processing_completed_at is not null
  ) then
    return jsonb_build_object('ok', false, 'error', 'database_processing_not_complete');
  end if;

  insert into public.gdpr_erasure_suppression_ledger (
    erasure_request_id,
    subject_user_id_hash,
    email_hash,
    hash_algorithm
  )
  values (
    p_request_id,
    p_subject_user_id_hash,
    p_email_identity_fingerprint,
    coalesce(nullif(trim(p_hash_algorithm), ''), 'hmac_sha256_v1')
  )
  on conflict (erasure_request_id) do nothing;

  update public.gdpr_erasure_requests
  set suppression_recorded_at = coalesce(suppression_recorded_at, now()), updated_at = now()
  where id = p_request_id;

  update public.gdpr_erasure_actions
  set status = 'completed', executed_at = coalesce(executed_at, now()), updated_at = now()
  where erasure_request_id = p_request_id
    and action_type = 'BACKUP_SUPPRESSION_LEDGER_REQUIRED';

  perform public._gdpr_erasure_audit(
    p_request_id,
    'suppression_recorded',
    jsonb_build_object('hash_algorithm', coalesce(nullif(trim(p_hash_algorithm), ''), 'hmac_sha256_v1'))
  );

  return jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'suppression_recorded', true
  );
end;
$$;

revoke all on function public.record_gdpr_erasure_suppression_ledger(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_gdpr_erasure_suppression_ledger(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Match suppressed identities (restore simulation / re-erasure)
-- ---------------------------------------------------------------------------

create or replace function public.match_gdpr_suppression_ledger_identities(
  p_subject_user_id_hash text,
  p_email_identity_fingerprint text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_matches uuid[];
begin
  if p_subject_user_id_hash is null and p_email_identity_fingerprint is null then
    return jsonb_build_object('ok', false, 'error', 'fingerprint_required');
  end if;

  select coalesce(array_agg(distinct l.erasure_request_id), '{}'::uuid[])
  into v_matches
  from public.gdpr_erasure_suppression_ledger l
  where (p_subject_user_id_hash is not null and l.subject_user_id_hash = p_subject_user_id_hash)
     or (p_email_identity_fingerprint is not null and l.email_hash = p_email_identity_fingerprint);

  return jsonb_build_object(
    'ok', true,
    'matches', to_jsonb(v_matches),
    'hash_algorithm', 'hmac_sha256_v1'
  );
end;
$$;

revoke all on function public.match_gdpr_suppression_ledger_identities(text, text) from public, anon, authenticated;
grant execute on function public.match_gdpr_suppression_ledger_identities(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Auth deletion completion — requires suppression + updated processor semantics
-- ---------------------------------------------------------------------------

create or replace function public.complete_gdpr_erasure_auth_deletion(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.gdpr_erasure_requests%rowtype;
  v_blocking integer;
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

  if v_request.suppression_recorded_at is null
     and not exists (
       select 1
       from public.gdpr_erasure_suppression_ledger l
       where l.erasure_request_id = p_request_id
     ) then
    return jsonb_build_object('ok', false, 'error', 'suppression_not_recorded');
  end if;

  if exists (select 1 from auth.users u where u.id = v_request.subject_user_id) then
    return jsonb_build_object(
      'ok', false,
      'error', 'auth_user_still_present',
      'note', 'Invoke Supabase Admin API deleteUser after suppression recording, then call again'
    );
  end if;

  update public.gdpr_erasure_processor_actions
  set status = 'completed', completed_at = now(), updated_at = now()
  where erasure_request_id = p_request_id
    and processor = 'supabase_auth';

  update public.gdpr_erasure_actions
  set status = 'skipped_idempotent', executed_at = now(), updated_at = now()
  where erasure_request_id = p_request_id
    and action_type = 'DELETE_AUTH_IDENTITY_LAST';

  v_blocking := public._gdpr_count_blocking_processors(p_request_id);

  update public.gdpr_erasure_requests
  set
    auth_deletion_completed_at = now(),
    status = case when v_blocking = 0 then 'completed' else 'partially_completed' end,
    completed_at = case when v_blocking = 0 then now() else null end,
    partially_completed_at = case when v_blocking > 0 then now() else partially_completed_at end,
    updated_at = now()
  where id = p_request_id;

  perform public._gdpr_erasure_audit(p_request_id, 'auth_deletion_completed', '{}'::jsonb);

  return jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'status', case when v_blocking = 0 then 'completed' else 'partially_completed' end,
    'blocking_processors', v_blocking
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Processor action update — extended statuses + completion recompute
-- ---------------------------------------------------------------------------

drop function if exists public.update_gdpr_erasure_processor_action(uuid, text, text, text);

create or replace function public.update_gdpr_erasure_processor_action(
  p_request_id uuid,
  p_processor text,
  p_status text,
  p_failure_code text default null,
  p_status_code text default null,
  p_operator_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.gdpr_erasure_requests%rowtype;
begin
  if p_status not in (
    'pending',
    'manual_review',
    'processing',
    'completed',
    'failed',
    'not_required',
    'not_applicable',
    'retention_expiry'
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  select * into v_request
  from public.gdpr_erasure_requests
  where id = p_request_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;

  update public.gdpr_erasure_processor_actions
  set
    status = p_status,
    status_code = p_status_code,
    operator_user_id = p_operator_user_id,
    completed_at = case
      when p_status in ('completed', 'retention_expiry', 'not_applicable', 'not_required') then coalesce(completed_at, now())
      else completed_at
    end,
    failure_code = p_failure_code,
    updated_at = now()
  where erasure_request_id = p_request_id
    and processor = p_processor;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'processor_action_not_found');
  end if;

  if p_processor = 'resend' and p_status = 'completed' then
    perform public._gdpr_erasure_audit(
      p_request_id,
      'resend_marked_completed_manually',
      jsonb_build_object('status_code', coalesce(p_status_code, 'manual_completion'))
    );
  elsif p_processor = 'vercel' and p_status in ('completed', 'retention_expiry') then
    perform public._gdpr_erasure_audit(
      p_request_id,
      'vercel_processor_status_updated',
      jsonb_build_object('status', p_status, 'status_code', coalesce(p_status_code, p_status))
    );
  elsif p_processor = 'upstash' then
    perform public._gdpr_erasure_audit(
      p_request_id,
      'upstash_processor_status_updated',
      jsonb_build_object('status', p_status, 'status_code', coalesce(p_status_code, p_status))
    );
  else
    perform public._gdpr_erasure_audit(
      p_request_id,
      'processor_status_updated',
      jsonb_build_object('processor', p_processor, 'status', p_status)
    );
  end if;

  if v_request.auth_deletion_completed_at is not null then
    perform public.recompute_gdpr_erasure_completion(p_request_id);
  end if;

  return jsonb_build_object('ok', true, 'processor', p_processor, 'status', p_status);
end;
$$;

revoke all on function public.update_gdpr_erasure_processor_action(uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.update_gdpr_erasure_processor_action(uuid, text, text, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Status read — include suppression flag (no fingerprint values)
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
    'suppression_recorded', v_request.suppression_recorded_at is not null,
    'suppression_recorded_at', v_request.suppression_recorded_at,
    'database_processing_completed_at', v_request.database_processing_completed_at,
    'auth_deletion_completed_at', v_request.auth_deletion_completed_at,
    'completed_at', v_request.completed_at,
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
        'status_code', pa.status_code,
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
