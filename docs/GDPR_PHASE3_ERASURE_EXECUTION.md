# GDPR Phase 3 — Controlled Erasure Execution

**Status:** Development architecture implemented — apply migrations manually on Development only  
**Prerequisite:** Phase 2 `generate_erasure_impact_report` (22/22 verified)  
**Related:** [Architecture](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md) · [Operational Runbook](./GDPR_ERASURE_OPERATIONAL_RUNBOOK.md) · [Phase 2 Implementation](./GDPR_PHASE2_IMPACT_REPORT_IMPLEMENTATION.md)

---

## Architectural boundary (preserved)

| Mechanism | Phase 3 behaviour |
|-----------|-------------------|
| **Participation de-link** | Not invoked as RTBF. GDPR uses `_gdpr_remove_subject_property_links`; audit via `gdpr_erasure_audit_events` (`person_property_link_removed`), not `property_delink_events`. |
| **Lifecycle anonymisation** | Not invoked as RTBF. Sole-participant address uses `_gdpr_redact_sole_participant_property_address` (distinct metadata scope). |
| **Formal GDPR RTBF** | Request → verify → scope → approve → execute → external processors → Auth last. |

---

## Request state machine

Valid transitions (enforced by RPCs):

```
requested
  → identity_verified (verify_gdpr_erasure_identity)
  → awaiting_approval (assess_gdpr_erasure_scope)
  → approved (approve_gdpr_erasure_request)
  → processing (execute_gdpr_erasure_request)
  → awaiting_auth_deletion | partially_completed | manual_review_required
  → completed (complete_gdpr_erasure_auth_deletion + external processors)
```

**Cannot skip:** `requested → processing` is rejected.

Terminal states: `completed`, `rejected`, `failed`.

---

## Tables

| Table | Purpose |
|-------|---------|
| `gdpr_erasure_requests` | Workflow state, timestamps, scope fingerprint, approval linkage |
| `gdpr_erasure_impact_snapshots` | Structured Phase 2 report snapshot (no raw PII) |
| `gdpr_erasure_actions` | Approved execution plan items |
| `gdpr_erasure_processor_actions` | Resend/Vercel/Auth external tracking |
| `gdpr_erasure_audit_events` | Immutable execution audit trail |
| `gdpr_erasure_suppression_ledger` | Phase 4 hash-only interface (not auto-populated) |

---

## Migrations (apply in order)

1. `20260718100000_gdpr_erasure_impact_report.sql` (Phase 2 — already applied on Dev)
2. `20260718110000_gdpr_erasure_execution_schema.sql`
3. `20260718120000_gdpr_erasure_execution_rpc.sql`
4. `20260718130000_fix_gdpr_erasure_delink_audit.sql` *(corrective — required if 18120000 already applied)*
5. `20260718140000_fix_gdpr_erasure_approval_and_auth_prep.sql` *(corrective — approval + Auth FK prep)*
6. `20260718150000_fix_gdpr_redact_shared_safety_recheck.sql` *(corrective — live shared safety at redact time)*

**Do not apply to Production without separate approval.**

---

## RPCs (service_role only)

| RPC | Role |
|-----|------|
| `create_gdpr_erasure_request` | Create request record |
| `verify_gdpr_erasure_identity` | Advance to identity_verified |
| `assess_gdpr_erasure_scope` | Call Phase 2 report, snapshot, draft actions |
| `approve_gdpr_erasure_request` | Lock approved plan |
| `reject_gdpr_erasure_request` | Reject with reason code |
| `execute_gdpr_erasure_request` | Database execution with fresh scope check |
| `mark_gdpr_erasure_auth_deletion_eligible` | Prepare FK cleanup before Auth |
| `complete_gdpr_erasure_auth_deletion` | Record Auth deletion after Admin API |
| `update_gdpr_erasure_processor_action` | Manual external processor status |
| `get_gdpr_erasure_request_status` | Read-only status summary |

Internal helpers (`_gdpr_*`) are not granted to clients.

---

## Phase 2 integration

- `assess_gdpr_erasure_scope` calls `generate_erasure_impact_report(subject_user_id)` — no duplicated discovery logic.
- `_gdpr_compute_scope_fingerprint` hashes material scope fields.
- `execute_gdpr_erasure_request` regenerates report and compares fingerprint before mutations.
- Mismatch returns `ERASURE_SCOPE_CHANGED_REASSESSMENT_REQUIRED`.

---

## Implemented action types

| Action | Auto-executable when approved |
|--------|------------------------------|
| `REMOVE_PERSON_PROPERTY_LINK` | Yes (per property) |
| `REDACT_PROFILE_PERSONAL_DATA` | Yes |
| `REDACT_EMAIL_REFERENCE` | Yes |
| `NULL_HISTORICAL_ACTOR_REFERENCE` | Yes |
| `REDACT_SOLE_PARTICIPANT_PROPERTY_ADDRESS` | Yes (with shared safety re-check) |
| `REMOVE_ANALYTICS_RELINK_PATH` | Yes (manual review flag on draft) |
| `DELETE_AUTH_IDENTITY_LAST` | Pending until Admin API + complete RPC |
| `REVIEW_SHARED_PROPERTY_ADDRESS` | Manual only |
| `REVIEW_ANALYTICS_REIDENTIFICATION` | Manual only |
| External processor rows | Manual completion only |

---

## Auth deletion last

1. Database actions complete → `awaiting_auth_deletion`
2. `mark_gdpr_erasure_auth_deletion_eligible` clears remaining FK rows
3. TypeScript `completeGdprAuthDeletion()` calls Supabase Admin `deleteUser`
4. `complete_gdpr_erasure_auth_deletion` records completion (idempotent if user already absent)

---

## TypeScript integration

| File | Purpose |
|------|---------|
| `lib/gdpr/erasureRequest.ts` | Request workflow RPCs |
| `lib/gdpr/erasureExecution.ts` | Executor + processor updates |
| `lib/gdpr/completeAuthDeletion.ts` | Auth Admin API wrapper with request validation |

Requires **service-role** client. No public UI in Phase 3.

---

## Verification

```bash
# After manual migration apply on Development (bbbsxzxcjkmpqsfvmhbo):
npx tsx scripts/verify-gdpr-erasure-execution.ts
npx tsx scripts/verify-gdpr-erasure-impact-report.ts
npm run build
```

Plus existing lifecycle regression scripts.

---

## Suppression ledger

Schema prepared (`gdpr_erasure_suppression_ledger`). HMAC/pepper application deferred to Phase 4 backup runbook implementation.

---

## Launch blockers (P0)

- Manual migration apply + Dev verification pass
- Legal review of email_events retention/redaction policy
- Resend/Vercel processor deletion runbooks (manual)
- Production approval gate
- Privacy mailbox live verification

---

*Technical implementation record — not legal advice.*
