# GDPR Right to Erasure Architecture — Keynetic

**Audit date:** 2026-07-18 (Phase 1 governance update)  
**Status:** Design only — **do not implement destructive erasure until authorised**  
**Privacy contact (proposed):** privacy@keynetic.co.uk — *mailbox setup/testing required before launch*  
**Related:** [Data Inventory](./GDPR_DATA_INVENTORY.md) · [Retention Schedule](./GDPR_DATA_RETENTION_SCHEDULE.md) · [Operational Runbook](./GDPR_ERASURE_OPERATIONAL_RUNBOOK.md) · [Backup Runbook](./GDPR_BACKUP_ERASURE_RUNBOOK.md) · [Phase 2 Requirements](./GDPR_PHASE2_IMPACT_REPORT_REQUIREMENTS.md)

---

## Executive summary

Keynetic is a **shared operational property-chain platform**. Personal data is distributed across Supabase Auth, relational tables, communication audit logs, and external processors (Resend, Vercel, optional Redis). **No account-level Right to Erasure workflow exists today.**

Existing mechanisms must **not** be conflated:

| Mechanism | What it does | GDPR RTBF? |
|-----------|--------------|------------|
| **Participation de-link** | One participant leaves; history/analytics retained | **No** |
| **Lifecycle release / anonymisation** | Property-level automated cleanup after dormancy/completion | **No** — explicitly documented in SQL and `lib/lifecycle/types.ts` |
| **Formal Right to Erasure** | Per-user data-subject request with identity verification and lawful retention assessment | **Target architecture (this document)** |

**Recommended launch approach:** **Manual / admin-assisted** erasure. Users may **request** erasure via privacy@keynetic.co.uk (and future in-app request form). Requests must **not** trigger automatic deletion. Workflow: request → identity verification → impact/scope assessment → manual approval → controlled execution (Phase 3+) → processors → Auth delete last → confirmation.

Self-service instant account deletion is **deferred** until impact report and execution RPCs are verified.

**Statutory response time (UK GDPR):** One **calendar month** from receipt of a valid request (extendable by up to two further months if complex — inform the requester within the first month). Source: [ICO — Right to erasure](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/).

**Keynetic internal target:** Aim to process **straightforward** erasure requests within **72 hours where reasonably possible** — an operational SLA, **not** the statutory deadline. Do **not** publicly guarantee 72-hour completion. Complex cases (active shared transactions, identity disputes, lawful retention, processor dependencies) may require longer assessment within the statutory window.

---

## Part 2 — User identity graph

### Starting point: `auth.users.id`

```
auth.users (id, email, metadata)
    │
    ├── profiles (id = auth.users.id)
    │
    ├── properties.created_by_user_id
    ├── chains.created_by_user_id
    ├── chains.completion_*_user_id (4 fields)
    │
    ├── property_members.user_id
    ├── property_operational_identities.homeowner_user_id
    ├── property_counterparty_participants.user_id
    ├── property_delegates (delegate_user_id, invited_by_user_id)
    ├── property_ea_assignments.assigned_by_user_id
    │
    ├── property_claim_metadata (originated_by, claimed_by)
    ├── property_claim_invitations (created_by, rejected_by, acknowledged_by)
    ├── ea_branch_invitations (created_by, accepted_by)
    ├── ea_companies.created_by_user_id
    ├── ea_branch_members.user_id [ON DELETE CASCADE]
    │
    ├── property_delink_events.actor_user_id
    ├── property_lifecycle_still_active_confirmations.user_id [ON DELETE CASCADE]
    ├── chain_completion_events.actor_user_id
    ├── email_events.sent_by [ON DELETE SET NULL]
    │
    └── Indirect email matches (no user_id):
            property_claim_metadata.invite_email
            ea_branch_invitations.invite_email
            email_events.recipient_email
```

### Discovery reliability

| Question | Answer |
|----------|--------|
| Can Keynetic discover **all** records for one authenticated user? | **Mostly yes** via `user_id` FK graph + email match for invite/comm rows |
| Can erasure miss data? | **Yes** — JSONB metadata, `activities.update`, Redis cache, Resend, backups, logs |
| Orphan if `auth.users` deleted first? | **Yes** — `email_events.sent_by` nulls; email-based correlation harder; impact report lost |

### Recommended order of operations

1. **Create erasure request record** (minimal PII — see workflow)
2. **Verify identity** (do not proceed on email-only match without verification)
3. **`generate_erasure_impact_report(user_id)`** — read-only, service role
4. **Human scope assessment** — shared transaction warnings, lawful retention
5. **`execute_verified_erasure(erasure_request_id)`** — transactional DB mutations
6. **External processors** — Resend deletion/suppression; Redis purge; Stripe when live
7. **Supabase Auth delete user** — **last** (or immediately after DB commit in same orchestration)
8. **Completion confirmation** to requester (via contact channel used for verification, then discard request PII per retention policy)
9. **Append to suppression ledger** (non-PII) for backup re-application

**Never delete `auth.users` before the impact report and DB erasure plan are complete.**

---

## Part 3 — Shared transaction data classification

Legend: **A** User-owned personal · **B** Shared operational · **C** Historical/audit · **D** Anonymous/statistical · **E** Mandatory/legitimate retention candidate

| Entity | Class | Recommendation | Rationale |
|--------|-------|----------------|-----------|
| **properties** | B (+ address = A for sole participant) | **Context-dependent:** null `created_by_user_id`; address redact/delete only when sole participant or lifecycle already released; else retain for other participants | Address is shared operational fact for active chains |
| **chains** | B | Retain structure; null user attribution fields; redact `name` if user-specific | Other participants depend on chain |
| **activities** | B/C | Delete rows authored in user context OR scrub `update`; retain generic system entries | `update` is highest free-text PII risk |
| **property_lifecycle_states** | B/C | Retain state machine on shared property; scrub user-specific metadata | Operational continuity |
| **property_lifecycle_events** | C | Retain transitions; null/scrub user refs in metadata | Audit without identity where possible |
| **property_analytics_snapshots** | D (if verified anonymous) / pseudonymous today | **Conditional retain** — see [Analytics classification](#analytics-snapshots--anonymity-classification) | Designed metrics; re-linkage risk via `source_property_id` |
| **property_operational_identities** | A/B | Release/delink row or null `homeowner_user_id` for requesting user | Other homeowner may exist on peer property |
| **property_members** | A | Delete rows for user | Legacy sync |
| **property_counterparty_participants** | A/B | Remove user's participation; retain if counterparty remains | Shared transaction |
| **property_delegates** | A | Revoke/delete delegate rows for user | User-specific permission |
| **property_ea_assignments** | B | Revoke assignments involving user; retain branch-property link if branch continues | EA org may outlive individual agent |
| **property_claim_metadata** | A/B | Null invite email/name; null user refs | Third-party invite PII |
| **property_claim_invitations** | C | Revoke pending; retain historic token hashes without email | Security audit |
| **property_delink_events** | C | Null `actor_user_id`; retain `reason_code` | Structured audit |
| **email_events** | C/E | Redact `recipient_email`; retain template/status/timestamps | Comms compliance vs minimisation — **legal review** |

---

## Part 4 — Property address erasure (contextual model)

Property addresses can constitute personal data **when linked to an identifiable individual**. They may also form part of a **legitimate shared operational transaction** involving other participants.

### Core distinction

| Concept | Description |
|---------|-------------|
| **A. Property record** | Row in `properties` (address, postcode, topology) |
| **B. Property address** | Location data on that record |
| **C. Person–property identity relationship** | Link between `auth.users.id` and a property via operational identity, membership, counterparty, delegate, or EA assignment |
| **D. Shared transaction topology** | Chain connections, counterparty links, EA branch assignments |
| **E. Anonymous analytics** | Snapshots without re-linkage to a person |

**Product principle:**

> **Erase the person–property identity relationship where required without automatically destroying a shared property record that other legitimate participants still require.**

Do **not** treat "property address = PII = always delete" as a universal rule.

**Public availability elsewhere** (e.g. property portals) does **not** automatically determine Keynetic's lawful basis or retention requirement.

### Decision logic

```
Erasure request for user U + property P
  │
  ├─ Other active operational participants on P?
  │     YES → Remove U's identity links; RETAIN address on P if documented continuing purpose
  │     NO  → Continue
  │
  ├─ Sole participant + no legitimate continuing operational use?
  │     YES → Address eligible for redaction/anonymisation
  │
  ├─ Property lifecycle released/anonymised?
  │     YES → Verify no address copies elsewhere; confirm redaction complete
  │
  ├─ EA historic association only?
  │     → Do NOT assume indefinite full-address retention for analytics
  │     → Prefer aggregated/anonymised performance insight long-term
  │     → **Legal review:** lawful basis for historic EA-associated addresses
  │
  └─ Active transaction mid-request?
        → Partial erasure likely; warn user; shared records may remain
```

### Scenario matrix

| # | Scenario | Person–property link | Underlying address |
|---|----------|----------------------|-------------------|
| 1 | Sole participant; no counterparty/EA/delegate | Remove | **Redact/anonymise** when no continuing purpose |
| 2 | Operational homeowner; other participants remain | Remove U's identity | **Retain** for shared transaction |
| 3 | Counterparty only | Remove counterparty link | **Retain** |
| 4 | Estate agent user (branch continues) | Remove user's assignment/membership | **Retain** while branch operational need exists; review historic retention |
| 5 | Delegate | Revoke delegate | **Retain** |
| 6 | Property `released` / `anonymised` | Already released | Confirm lifecycle redaction; scrub copies in email/activities |
| 7 | Multiple relationships on same property | Remove only U's relationships | **Retain** while others active |
| 8 | Active transaction; erasure requested | Partial — identity removal | **Retain** until shared basis ends — offer de-link vs erasure |
| 9 | EA historical analytics context | Remove agent identity link | **Do not assume** indefinite full address retention — prefer anonymised metrics |
| 10 | Address publicly listed elsewhere | — | **Not** automatic retention justification |

### Safe operations

| Operation | When |
|-----------|------|
| **Remove identity link** | Default first step for shared transactions |
| **Redact address in place** | Sole-participant or post-lifecycle with no continuing purpose |
| **Retain as shared operational** | Active multi-party transaction with documented purpose |
| **Retain temporarily** | Legal hold — manual review |
| **Replace with non-identifying data** | `[Released property]` / `REDACTED` — align with lifecycle |

Erasure must **never** expose another participant's address as a consequence of one user's erasure.

---

## Part 5 — Email address erasure

### Stores independent of `auth.users.email`

| Location | Match strategy | Proposed action |
|----------|----------------|-----------------|
| `auth.users.email` | Primary | Auth Admin delete (last step) |
| `property_claim_metadata.invite_email` | Email equality | Null |
| `ea_branch_invitations.invite_email` | Email equality | Null or delete row |
| `email_events.recipient_email` | Email equality | Replace with `redacted+<event_id>@erased.local` OR HMAC hash with rotation key |
| Resend provider | Email in message | Processor deletion request via API/support |
| Supabase Auth logs | Email in auth events | Supabase retention; confirm with DPA |

### `email_events` strategy (recommended)

| Field | Retain? | Treatment |
|-------|---------|-----------|
| `recipient_email` | No (post-erasure) | Replace with non-reversible redacted marker; keep row for metrics |
| `template`, `status`, `created_at` | Yes | Non-identifying audit |
| `provider_message_id` | Yes (short term) | Needed for processor correlation; delete at Resend |
| `provider_events` | Scrub | Remove payloads containing email |
| `property_id`, `chain_id` | Null if property erased | Reduce linkage |
| `sent_by` | Null | Already on auth delete |

**Do not** retain full email in a "suppression ledger" — use **one-way hash of normalised email + secret pepper** if re-matching after backup restore is required (see backup runbook).

### `email_events` retention policy (proposed — Phase 1)

Full proposal: [Data Retention Schedule — Email events](./GDPR_DATA_RETENTION_SCHEDULE.md#email-events-retention-proposal).

| Field | Proposed retention |
|-------|-------------------|
| `recipient_email` | 90 days raw → irreversible transform; immediate redact on RTBF |
| `provider_events` | 90 days if PII risk; then aggregates only |
| Template/status/timestamps | 24 months (non-identifying metrics) |

**No deletion jobs implemented in Phase 1.**

---

## Part 6 — Free-text / unknown PII risk

### Current state (repository audit)

| Location | User-entered? | Classification | Recommendation |
|----------|---------------|----------------|----------------|
| `activities.update` | **No today** — system stage labels | Internal/system generated only | Enforce structured inserts; add DB guard or restrict INSERT sources |
| `chains.name` | **Yes** | Should be minimised | Consider generic default names; scrub on erasure |
| `properties.address` | **Yes** | Required operational | Structured field — erasure by scenario matrix |
| `profiles.contact_name` | **Yes** (EA accounts) | Required for EA directory | Delete on erasure |
| `property_claim_metadata.invite_display_name` | **Yes** (EA optional) | Should be minimised | Null on erasure |
| `ea_branch_invitations.invite_name` | **Yes** | Required for invite | Null on erasure |
| Delink / rejection reasons | **No** — slug enums only | Required structured | Retain codes |
| Still-active confirmation | **No** — `still_active` code only | Required structured | Retain audit without user prose |
| `email_events.error_message` | System/provider | Internal | Scrub on erasure pass |
| JSONB: `metadata`, `payload`, `provider_events` | **Risk** | Unknown without inspection | Allow-list at write; scrub pass at erasure |
| `<textarea>` in UI | **None found** | — | Maintain zero textarea policy |
| `LegalPrivacySection` placeholders | N/A | Policy gap | Content phase |

### Policy gaps to close before automation

1. Prohibit free-text reason fields in new features
2. JSONB schema validation on write (RPC layer)
3. ~~Remove client `console.log` of addresses (`start-move/page.tsx`)~~ — **Done Phase 1**

---

## Analytics snapshots — anonymity classification

**Do not assume** snapshots are anonymous because the table comment says "No PII."

### Stored fields (`property_analytics_snapshots`)

| Field | In payload/table | Re-identification risk |
|-------|------------------|------------------------|
| `source_property_id` | Table column | **High** — direct link to live/released property row |
| `property_ref`, `chain_ref` | Table + payload | Low alone (random UUID at snapshot time) |
| `postcodeDistrict` | Payload | **Medium** — small-area statistical disclosure |
| `regionCode` | Payload | Low |
| `relationshipType`, `originType` | Payload | Low |
| `chainCompletedAt` | Payload | Low–medium (date granularity) |
| `activityCount`, `memberCountAtSnapshot` | Payload | Low |
| `metrics.*` booleans/counts | Payload | Low |
| `operationalDurationDays`, day-count metrics | Payload | Low |
| User IDs | Payload | **Excluded by builder** — verify at write time |
| Full postcode/address | Payload | **Excluded by builder** |

**Builder:** `lib/lifecycle/analyticsSnapshot.ts` — excludes emails, names, full addresses, live user IDs.

### Classification (Phase 1 audit conclusion)

| Verdict | Detail |
|---------|--------|
| **Overall** | **Pseudonymous / potentially re-identifiable** — not verified anonymous for RTBF retention |
| **Primary risk** | `source_property_id` enables join back to `properties` (address if not yet redacted) |
| **Secondary risk** | Postcode district + relationship type + timing in low-volume cells |
| **Tertiary risk** | Multiple snapshots across time for same `source_property_id` |

### Retention after erasure

| Rule | Action |
|------|--------|
| Snapshots genuinely anonymous | May retain |
| Snapshots re-linkable | Delete, null `source_property_id`, or further aggregate — **Phase 2/3 verification required** |
| Default until verified | **Do not rely on retention** in erasure execution |

### Phase 2/3 verification requirement

Before retaining snapshots post-erasure:

1. Automated test: snapshot payload + `source_property_id` cannot be joined to any remaining PII for erased user
2. Document k-anonymity threshold for postcode district (legal/product review)
3. Optional migration: drop `source_property_id` after property anonymised

**No snapshot data modified in Phase 1.**

---

## Estate agent organisations

Individual EA user erasure **must not** automatically delete:

- `ea_companies` / `ea_branches`
- Legitimate business-level records
- Aggregated organisational analytics (when verified anonymous)

| Situation | Treatment |
|-----------|-----------|
| Agent leaves; branch has other members | Remove `ea_branch_members` row; retain branch/company |
| Last member of branch | **Flag for admin review** — do not auto-delete branch |
| Last member of company | **Flag for admin review** — do not auto-delete company |
| Personal fields on org records | `created_by_user_id` → null; review `contact_name` on profile |

---

## Part 7 — Right to Erasure workflow

### State machine (proposed)

```
                    ┌─────────────────────┐
                    │     requested       │
                    └──────────┬──────────┘
                               │ identity verification
                               ▼
                    ┌─────────────────────┐
              ┌────│  identity_verified   │────┐
              │    └──────────┬──────────┘    │
              │               │ impact report │
              │               ▼               │
              │    ┌─────────────────────┐    │
              │    │   scope_assessed    │    │
              │    └──────────┬──────────┘    │
              │               │ admin approval│
         rejected             ▼               │
    ┌──────────────┐  ┌─────────────┐         │
    │ rejected_    │  │  approved   │         │
    │ lawful_reason│  └──────┬──────┘         │
    └──────────────┘         │ execute         │
                             ▼                 │
                    ┌─────────────────────┐    │
                    │    processing       │    │
                    └──────────┬──────────┘    │
                               │               │
              ┌────────────────┼───────────────┘
              ▼                ▼
   ┌──────────────────┐  ┌─────────────────────────────┐
   │    completed     │  │ partially_completed_        │
   └──────────────────┘  │ retention_required          │
                         └─────────────────────────────┘
              │
              ▼
   ┌─────────────────────────────┐
   │ failed_requires_manual_review│
   └─────────────────────────────┘
```

### Launch recommendation: manual/admin-assisted

| Aspect | Launch design |
|--------|---------------|
| **Initiation** | Email to **privacy@keynetic.co.uk** + future in-app **request** form (no auto-delete) |
| **Self-service delete button** | **Defer** until impact report + execution RPCs proven |
| **Identity verification** | Match authenticated session **or** verified email reply + account challenge questions; EA accounts may need branch admin confirmation |
| **Active transaction warning** | Mandatory disclosure: de-link ≠ erasure; shared data may remain |
| **Execution** | Founder/admin triggers `execute_verified_erasure` after reviewing impact report |
| **Confirmation** | Email confirming categories erased + any retained data with lawful basis |
| **Audit after completion** | Store: request ID, dates, actions taken (enum list), outcome — **not** erased person's email in long-term audit |

### Separation enforcement in UI copy

- **De-link:** "Leave this transaction" — operational only
- **Lifecycle dormancy:** "Confirm still active" — not erasure
- **Erasure:** Separate legal process with verification

---

## Part 8 — Database execution design (proposed, not implemented)

### Two-stage model — **recommended**

#### Stage 1: `generate_erasure_impact_report(p_user_id uuid)`

Full specification: [Phase 2 Requirements](./GDPR_PHASE2_IMPACT_REPORT_REQUIREMENTS.md).

**Properties (service role only):**

- Count/m categorise affected rows per table (no bulk email dump in report)
- Flag **shared active transactions** blocking full address erasure
- List proposed actions as structured enums (`NULL_USER_REF`, `DELETE_ROW`, `REDACT_EMAIL`, `REDACT_ADDRESS`, `RETAIN_LAWFUL`, `EXTERNAL_RESEND`, `AUTH_DELETE`)
- Output `erasure_request_id` for stage 2
- **Dry-run default** — no mutations

#### Stage 2: `execute_verified_erasure(p_erasure_request_id uuid, p_approved_by uuid)`

- Idempotent — safe to re-run failed partial jobs
- Single transaction per **phase** (phases may commit separately for FK safety):

**Phase A — Participation cleanup**
- Revoke delegates, counterparty links, EA assignments for user
- Delink operational identities (or use existing `execute_participation_delink` where appropriate — **do not conflate with RTBF audit**)

**Phase B — PII redaction**
- `email_events`, claim metadata, invitations
- `profiles`, activities scrub
- Null user refs on audit tables

**Phase C — Address assessment**
- Apply scenario matrix per property

**Phase D — External hooks** (application layer)
- Resend, Redis, Stripe

**Phase E — Auth delete**
- Supabase Admin API `deleteUser`

**Phase F — Ledger**
- Append suppression record (hash only)

### Supporting tables (proposed schema — not migrated)

```sql
-- DESIGN ONLY — do not apply
-- erasure_requests (id, subject_user_id, status, requested_at, verified_at, ...)
-- erasure_impact_reports (request_id, report_json, generated_at)
-- erasure_actions (request_id, table_name, action_enum, row_count, executed_at)
-- erasure_suppression_ledger (email_hash, user_id_hash, erased_at) -- no raw email
```

### Failure recovery

| Failure | Recovery |
|---------|----------|
| Mid-transaction DB error | Re-run `execute_verified_erasure` — idempotent actions |
| Auth delete fails after DB scrub | Manual Auth delete; DB already clean |
| Resend deletion fails | Mark `partially_completed`; retry external step |
| Shared property conflict | `partially_completed_retention_required` + document lawful basis |

### Access control

- All erasure RPCs: **service role only** + admin server endpoint with separate admin auth
- No RLS weakening
- No homeowner-accessible erasure RPC (prevents accidental self-delete of shared records)

---

## High-risk findings

| ID | Risk | Severity |
|----|------|----------|
| HR-1 | No RTBF workflow at launch | **P0 blocker** |
| HR-2 | `email_events.recipient_email` retained indefinitely | **P0** |
| HR-3 | Lifecycle anonymisation could be mistaken for RTBF | **P0** (documentation — partially addressed) |
| HR-4 | `activities.update` not scrubbed on lifecycle anonymise | **P1** |
| HR-5 | Auth delete before DB erasure orphans correlation | **P1** (design addresses) |
| HR-6 | JSONB metadata unconstrained | **P1** |
| HR-7 | Dev `console.log` of addresses | **P1** |
| HR-8 | `/api/dev/email-events` exposes recipient emails in development | **P2** (dev only) |
| HR-9 | `get_user_email_by_id` exposes auth emails to branch admins | **P2** (by design — document in privacy notice) |
| HR-10 | Backup restore may resurrect erased PII | **P1** (runbook required) |

---

## P0 launch blockers

1. Published Privacy Policy covering retention, processors, and erasure process
2. Operational erasure workflow (manual minimum) with identity verification
3. Documented distinction: de-link / lifecycle / RTBF
4. `email_events` retention and erasure treatment agreed
5. Privacy contact channel live
6. Supabase + Resend DPAs in place

---

## P1 recommended improvements

1. Implement two-stage impact report + execution RPCs
2. Suppression ledger for backup re-application
3. Structured JSONB allow-lists on write paths
4. Automated `activities` scrub in lifecycle archive path
5. Remove production console logging of PII
6. Self-service erasure request portal (not auto-delete)

---

## Questions for founder / product

1. Launch with manual-only erasure vs partial self-service request form?
2. Refuse erasure for active shared transactions or proceed with partial erasure only?
3. Retain anonymised analytics snapshots when user objects to all processing?
4. EA company data: delete entire branch/company when last member erases?
5. Internal 72-hour SLA: which request types qualify (simple vs shared-data)?
6. Publish privacy@ email domain and responsible person name?

---

## Questions for legal review

1. Lawful basis for retaining `email_events` after erasure (legitimate interest vs compliance)?
2. Refusal grounds under Article 17(3) for active property transactions
3. ICO registration and data protection fee for Keynetic
4. DPO requirement assessment (likely not mandatory for small org — confirm)
5. EA as independent controller vs processor for client homeowner data
6. Data (Use and Access) Act 2025 changes affecting erasure/time limits — monitor ICO updates

---

## Questions for Supabase / provider verification

1. Confirm Pro plan daily backup retention (7 days) on Production project
2. Confirm whether PITR enabled and retention window
3. Auth user deletion: cascade behaviour to all linked tables
4. Supabase log retention and whether request logs contain email/query params
5. Resend data retention period and deletion API
6. Vercel log drain content and retention if enabled

---

## Phase 1 governance deliverables (complete)

| Document | Purpose |
|----------|---------|
| [Operational Runbook](./GDPR_ERASURE_OPERATIONAL_RUNBOOK.md) | Manual launch procedure |
| [Retention Schedule](./GDPR_DATA_RETENTION_SCHEDULE.md) | Proposed retention periods |
| [Processor Checklist](./GDPR_PROCESSOR_DPA_CHECKLIST.md) | DPA and erasure propagation |
| [Website Content Register](./GDPR_WEBSITE_CONTENT_REGISTER.md) | Future content review |
| [Phase 2 Requirements](./GDPR_PHASE2_IMPACT_REPORT_REQUIREMENTS.md) | Read-only impact report spec |

---

## Next phase implementation plan (after approval)

**Phase 2 — Read-only impact report** (next approval gate)

- Migrations: `erasure_requests` table (optional for report linkage)
- `generate_erasure_impact_report` RPC
- Development verification script
- **No destructive mutations**

**Phase 3 — Execution** (Development architecture implemented — see [GDPR_PHASE3_ERASURE_EXECUTION.md](./GDPR_PHASE3_ERASURE_EXECUTION.md))

- `execute_gdpr_erasure_request` (replaces proposed `execute_verified_erasure` name)
- Request workflow RPCs + Auth deletion-last orchestration
- **Not Production-enabled** until Dev verification + separate approval
- Admin server route

**Phase 4 — Suppression ledger + backup drill**

**Phase 5 — Self-service erasure request UI** (not auto-delete)

**Explicitly out of scope until approved:** automatic erasure, cron deletion, RLS changes, production data mutation.

---

*Architecture design only. Not legal advice.*
