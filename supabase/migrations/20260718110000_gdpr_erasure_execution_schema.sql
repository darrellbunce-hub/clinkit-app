-- Phase 3: GDPR Right to Erasure — controlled execution schema
-- Request → identity → scope → approval → execution → external processors → Auth last
-- Does NOT implement automatic erasure or public self-service deletion.

-- ---------------------------------------------------------------------------
-- gdpr_erasure_requests
-- ---------------------------------------------------------------------------

create table if not exists public.gdpr_erasure_requests (
  id uuid primary key default gen_random_uuid(),
  subject_user_id uuid not null,
  status text not null default 'requested',
  request_source text not null default 'admin_manual',
  version integer not null default 1,
  legal_review_required boolean not null default false,
  manual_review_required boolean not null default true,
  requested_at timestamptz not null default now(),
  identity_verified_at timestamptz null,
  scope_assessed_at timestamptz null,
  approved_at timestamptz null,
  execution_started_at timestamptz null,
  execution_claimed_at timestamptz null,
  execution_claim_token text null,
  database_processing_completed_at timestamptz null,
  auth_deletion_completed_at timestamptz null,
  completed_at timestamptz null,
  rejected_at timestamptz null,
  partially_completed_at timestamptz null,
  failed_at timestamptz null,
  created_by uuid null,
  verified_by uuid null,
  approved_by uuid null,
  rejection_reason_code text null,
  failure_reason_code text null,
  approved_snapshot_id uuid null,
  scope_fingerprint text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint gdpr_erasure_requests_status_check check (
    status in (
      'requested',
      'identity_verified',
      'scope_assessed',
      'awaiting_approval',
      'approved',
      'processing',
      'database_processed',
      'awaiting_external_processors',
      'awaiting_auth_deletion',
      'partially_completed',
      'completed',
      'rejected',
      'manual_review_required',
      'failed'
    )
  ),

  constraint gdpr_erasure_requests_source_check check (
    request_source in (
      'admin_manual',
      'privacy_email',
      'internal_dev_fixture',
      'support_ticket'
    )
  )
);

create index if not exists gdpr_erasure_requests_subject_user_id_idx
  on public.gdpr_erasure_requests (subject_user_id);

create index if not exists gdpr_erasure_requests_status_idx
  on public.gdpr_erasure_requests (status);

comment on table public.gdpr_erasure_requests is
  'Controlled GDPR Right to Erasure request workflow. No raw PII in free-text columns.';

-- ---------------------------------------------------------------------------
-- gdpr_erasure_impact_snapshots
-- ---------------------------------------------------------------------------

create table if not exists public.gdpr_erasure_impact_snapshots (
  id uuid primary key default gen_random_uuid(),
  erasure_request_id uuid not null
    references public.gdpr_erasure_requests (id) on delete cascade,
  report_version integer not null,
  generated_at timestamptz not null,
  scope_fingerprint text not null,
  risk_flags jsonb not null default '[]'::jsonb,
  blocking_reasons jsonb not null default '[]'::jsonb,
  relationship_summary jsonb not null default '{}'::jsonb,
  proposed_actions jsonb not null default '[]'::jsonb,
  material_scope jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists gdpr_erasure_impact_snapshots_request_idx
  on public.gdpr_erasure_impact_snapshots (erasure_request_id, created_at desc);

comment on table public.gdpr_erasure_impact_snapshots is
  'Structured Phase 2 impact report snapshot without raw PII. Tied to approval.';

-- ---------------------------------------------------------------------------
-- gdpr_erasure_actions
-- ---------------------------------------------------------------------------

create table if not exists public.gdpr_erasure_actions (
  id uuid primary key default gen_random_uuid(),
  erasure_request_id uuid not null
    references public.gdpr_erasure_requests (id) on delete cascade,
  action_type text not null,
  target_type text not null,
  target_reference jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  reason_code text not null,
  requires_manual_review boolean not null default false,
  approved_at timestamptz null,
  executed_at timestamptz null,
  failure_code text null,
  execution_detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint gdpr_erasure_actions_status_check check (
    status in (
      'draft',
      'approved',
      'blocked',
      'completed',
      'skipped_idempotent',
      'failed',
      'pending_manual'
    )
  )
);

create index if not exists gdpr_erasure_actions_request_idx
  on public.gdpr_erasure_actions (erasure_request_id, status);

comment on table public.gdpr_erasure_actions is
  'Approved erasure treatment plan items. Structured identifiers only in target_reference.';

-- ---------------------------------------------------------------------------
-- gdpr_erasure_processor_actions
-- ---------------------------------------------------------------------------

create table if not exists public.gdpr_erasure_processor_actions (
  id uuid primary key default gen_random_uuid(),
  erasure_request_id uuid not null
    references public.gdpr_erasure_requests (id) on delete cascade,
  processor text not null,
  action_type text not null,
  status text not null default 'pending',
  required boolean not null default true,
  requested_at timestamptz null,
  completed_at timestamptz null,
  failure_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint gdpr_erasure_processor_actions_status_check check (
    status in (
      'pending',
      'completed',
      'failed',
      'not_required',
      'manual_review'
    )
  )
);

create index if not exists gdpr_erasure_processor_actions_request_idx
  on public.gdpr_erasure_processor_actions (erasure_request_id, processor);

comment on table public.gdpr_erasure_processor_actions is
  'External processor erasure tracking. Never auto-mark Resend/Vercel as completed.';

-- ---------------------------------------------------------------------------
-- gdpr_erasure_audit_events
-- ---------------------------------------------------------------------------

create table if not exists public.gdpr_erasure_audit_events (
  id uuid primary key default gen_random_uuid(),
  erasure_request_id uuid not null
    references public.gdpr_erasure_requests (id) on delete cascade,
  event_type text not null,
  event_detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists gdpr_erasure_audit_events_request_idx
  on public.gdpr_erasure_audit_events (erasure_request_id, created_at desc);

comment on table public.gdpr_erasure_audit_events is
  'Immutable execution audit trail without erased PII.';

-- ---------------------------------------------------------------------------
-- gdpr_erasure_suppression_ledger (Phase 4 interface — hash-only, not populated)
-- ---------------------------------------------------------------------------

create table if not exists public.gdpr_erasure_suppression_ledger (
  id uuid primary key default gen_random_uuid(),
  erasure_request_id uuid not null
    references public.gdpr_erasure_requests (id) on delete cascade,
  subject_user_id_hash text not null,
  email_hash text null,
  hash_algorithm text not null default 'pending_hmac_v1',
  erased_at timestamptz not null default now(),
  action_manifest_version integer not null default 1,
  created_at timestamptz not null default now(),

  constraint gdpr_erasure_suppression_ledger_no_raw_email check (
    email_hash is null or email_hash !~ '@'
  )
);

comment on table public.gdpr_erasure_suppression_ledger is
  'Phase 4 backup re-erasure interface. Hash-only; pepper/HMAC applied outside DB. Not auto-populated in Phase 3.';

-- ---------------------------------------------------------------------------
-- RLS: deny all direct table access (service_role bypasses RLS)
-- ---------------------------------------------------------------------------

alter table public.gdpr_erasure_requests enable row level security;
alter table public.gdpr_erasure_impact_snapshots enable row level security;
alter table public.gdpr_erasure_actions enable row level security;
alter table public.gdpr_erasure_processor_actions enable row level security;
alter table public.gdpr_erasure_audit_events enable row level security;
alter table public.gdpr_erasure_suppression_ledger enable row level security;

revoke all on public.gdpr_erasure_requests from public, anon, authenticated;
revoke all on public.gdpr_erasure_impact_snapshots from public, anon, authenticated;
revoke all on public.gdpr_erasure_actions from public, anon, authenticated;
revoke all on public.gdpr_erasure_processor_actions from public, anon, authenticated;
revoke all on public.gdpr_erasure_audit_events from public, anon, authenticated;
revoke all on public.gdpr_erasure_suppression_ledger from public, anon, authenticated;

grant select, insert, update, delete on public.gdpr_erasure_requests to service_role;
grant select, insert, update, delete on public.gdpr_erasure_impact_snapshots to service_role;
grant select, insert, update, delete on public.gdpr_erasure_actions to service_role;
grant select, insert, update, delete on public.gdpr_erasure_processor_actions to service_role;
grant select, insert, update, delete on public.gdpr_erasure_audit_events to service_role;
grant select, insert, update, delete on public.gdpr_erasure_suppression_ledger to service_role;

-- Allow pseudonymised audit actors after GDPR erasure (chain_completion_events already nullable)
alter table public.property_delink_events
  alter column actor_user_id drop not null;

comment on column public.property_delink_events.actor_user_id is
  'Nullable after GDPR actor pseudonymisation. Null does not imply system-initiated de-link.';
