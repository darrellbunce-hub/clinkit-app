# Property Lifecycle Automation

Architecture reference for Phase 2 automated lifecycle processing (dormancy revision).

## State machine

```
active → completed_grace → archived → released → anonymised
active → dormancy_warning → dormant → archived → released → anonymised
active → dormant → archived → released → anonymised   (isolated B1 only)
released → active (re-claim / future transaction / still-active confirmation reset)
```

Terminal state: `anonymised`

**Important:** `anonymised` is **property-level lifecycle anonymisation only**. It redacts the property address/postcode and claim invite fields while retaining analytics snapshots. It does **not** fulfil UK GDPR Right to Erasure across activities, email_events, auth.users, invitation records, communication logs, or backups. RTBF is a separate architecture phase — see [GDPR Right to Erasure Architecture](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md).

## Dormancy paths

### B1 — Isolated / unconnected dormancy

A property with no genuine chain connection, no meaningful transaction progress, and no valid active invitation becomes eligible after **`LIFECYCLE_DORMANT_INACTIVITY_DAYS`** (default **90**) of no operational activity.

Actions: mark dormant → snapshot → archive → release.

### B2 — Connected but abandoned dormancy

A connected transaction is **not** released at the first inactivity threshold. Instead:

1. No meaningful **chain-level** operational activity for **`LIFECYCLE_CONNECTED_DORMANT_DAYS`** (default **150**)
2. Enter **`dormancy_warning`** — notify operational homeowners by email (`lifecycle-dormancy-warning` template)
3. Structured confirmation only: **"My transaction is still active"** via `confirm_transaction_still_active()` (no free text)
4. If nobody confirms within **`LIFECYCLE_DORMANCY_CONFIRMATION_DAYS`** (default **30**): mark dormant → snapshot → archive → release

Connection does **not** grant permanent address reservation. Login inactivity alone does **not** trigger release. Login activity alone does **not** prevent release.

## Meaningful activity

Durable transaction signals (calculate-on-write via `last_operational_activity_at`):

- Structured property status/stage updates
- Homeowner or EA activities (insert)
- Counterparty connection / both sides connected
- Claim acceptance
- Invitation acceptance
- Still-active confirmation

**Does NOT qualify:**

- Operational identity merely existing
- **Identity age alone** (identity-age flaw removed)
- Page views / dashboard reads / passive session refreshes
- Login recency alone

`homeowner_has_meaningful_participation()` returns true only for durable progress (activities, stage beyond listed/searching, active counterparty, both sides connected).

Login may be a supporting signal elsewhere but is never the sole retain or release reason in lifecycle evaluation.

## Operational activity persistence

| Mutation | Updates `last_operational_activity_at` |
|----------|----------------------------------------|
| `activities` INSERT | Property + chain peers |
| `properties` UPDATE (stage, status, connections, chain topology) | Property + chain peers |
| `property_claim_metadata` claim acceptance | Property + chain peers |
| `property_counterparty_participants` active | Property + chain peers |
| `confirm_transaction_still_active()` | Property + chain peers |

Chain-level dormancy uses `chains.last_operational_activity_at` (max across members).

## Invitation expiry

- **Valid active invitation** (`invitation_expires_at > now()`, not used/revoked/rejected): temporarily protects from dormancy
- **Expired invitation only**: does **not** prevent dormant release

## Active chain protection

Before archive/release, `property_lifecycle_chain_release_safe()` fails closed when:

- Another chain member is `active` or `completed_grace` with meaningful participation
- Another member is in `dormancy_warning` with confirmation time remaining

Uses participation de-link topology principles — does not silently corrupt an otherwise active chain.

## Completed transactions (Scenario A)

Chain `completed_at` while lifecycle `active` → grace → snapshot → archive → release. Completion does not depend on login activity. Worker execution is idempotent.

## Address reservation

`property_address_is_reserved()` returns **false** for `released` and `anonymised` lifecycle states. All onboarding duplicate checks use this lifecycle-aware semantics via `property_exists_for_onboarding()`.

## Warning / confirmation architecture

| Field | Purpose |
|-------|---------|
| `dormancy_warning_at` | When warning issued |
| `dormancy_confirmation_deadline_at` | Confirmation window end |
| `dormancy_warning_notified_at` | Successful dormancy warning email delivery (null = pending or retryable) |
| `dormancy_warning_notification_claimed_at` | In-flight send claim (concurrency / retry) |
| `last_still_active_confirmed_at` | Last structured confirmation |
| `property_lifecycle_still_active_confirmations` | Append-only audit (`confirmation_code = 'still_active'`) |

RPC: `confirm_transaction_still_active(p_property_id)` — **active operational homeowner only** (not counterparty, delegate, or EA). Idempotent when lifecycle is already `active`. Clears notification fields when resetting from `dormancy_warning`.

Homeowner UI: `/property/{id}?lifecycle=dormancy-warning` shows confirmation panel only when backend state is `dormancy_warning`. Query param alone does not mutate lifecycle.

TypeScript helpers:

- `lib/lifecycle/confirmStillActive.ts`
- `lib/lifecycle/loadPropertyLifecycleState.ts`
- `lib/lifecycle/stillActiveConfirmationEligibility.ts`
- `components/lifecycle/PropertyLifecycleDormancySection.tsx`
- `lib/lifecycle/dormancyWarningNotifications.ts` (worker integration)
- `lib/communications/sendDormancyWarningEmail()` (Resend pipeline)

See `docs/COMMUNICATIONS.md` for recipient rules, privacy, idempotency, and retry behaviour.

### Dormancy warning email

| Step | RPC / function |
|------|----------------|
| List pending targets | `list_dormancy_warning_notification_targets(p_source_property_id)` |
| Resolve recipient | `get_dormancy_warning_email_recipient(p_property_id)` |
| Claim send | `try_claim_dormancy_warning_notification(p_property_id, p_worker_run_id)` |
| Mark sent | `mark_dormancy_warning_notification_sent(p_property_id, p_email_event_id)` |
| Release claim (retry) | `release_dormancy_warning_notification_claim(p_property_id)` |

CTA: `/property/{id}?lifecycle=dormancy-warning` — navigates to Keynetic; does not mutate lifecycle state. Homeowner confirms via in-app panel + modal calling `confirm_transaction_still_active()`.

Verification:

```bash
npx tsx scripts/verify-lifecycle-still-active-confirmation.ts
```

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `LIFECYCLE_COMPLETED_GRACE_DAYS` | 30 | Post-completion grace |
| `LIFECYCLE_DORMANT_INACTIVITY_DAYS` | 90 | B1 isolated dormancy |
| `LIFECYCLE_CONNECTED_DORMANT_DAYS` | 150 | B2 connected inactivity before warning |
| `LIFECYCLE_DORMANCY_CONFIRMATION_DAYS` | 30 | B2 confirmation window |
| `LIFECYCLE_EVALUATION_BATCH_SIZE` | 100 | Worker batch size |
| `LIFECYCLE_WORKER_LEASE_SECONDS` | 300 | Per-property worker lease |
| `CRON_SECRET` | — | Secures `/api/cron/property-lifecycle` |

Postgres mirrors via `app.lifecycle_*` settings (optional).

## Worker architecture

1. **Candidate selection** — `list_property_lifecycle_worker_candidates(batch)` (includes `dormancy_warning` with expired deadlines)
2. **Evaluation** — TypeScript pure functions (`evaluatePropertyLifecycleFromContext`)
3. **Execution** — `execute_property_lifecycle_action` per planned action (service role)
4. **Audit** — `property_lifecycle_events` append-only log

Query & Cost Governance: durable signals calculated on write; worker evaluates summaries on schedule, not on dashboard reads.

## Security

- Cron route requires `Authorization: Bearer ${CRON_SECRET}` (timing-safe compare)
- Worker RPCs granted to `service_role` only
- `confirm_transaction_still_active` granted to `authenticated` participants

## Remaining before Right to Erasure

- Per-user GDPR erase workflow (not lifecycle automation) — architecture audit: [GDPR Right to Erasure Architecture](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md)
- Activity text PII review/redaction policy
- Analytics platform ingestion from snapshots
- Optional chain-completion webhook for faster grace entry
