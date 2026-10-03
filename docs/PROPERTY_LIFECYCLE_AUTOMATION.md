# Property Lifecycle Automation

Architecture reference for Phase 2 automated lifecycle processing (bounded dormancy, `20261005130000`). The product model is in [Property Lifecycle](./PROPERTY_LIFECYCLE.md).

## State machine

```
active → completed_grace → archived → released → anonymised
active → dormancy_warning → dormant → archived → released → anonymised   (placeholder with dependants)
active → dormant → archived → released → anonymised                      (placeholder without dependants)
dormancy_warning / dormant → active   (dependent-side activity or confirmation; seller side represented again)
```

Terminal state: `anonymised`

**Important:** `anonymised` is **property-level lifecycle anonymisation only**. It redacts the property address/postcode and claim invite fields while retaining analytics snapshots. It does **not** fulfil UK GDPR Right to Erasure across activities, email_events, auth.users, invitation records, communication logs, or backups. RTBF is a separate architecture phase — see [GDPR Right to Erasure Architecture](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md).

## Managed rows and placeholders

| Row | Definition | Dormancy |
|-----|------------|----------|
| Managed | Seller side represented: a homeowner or an EA assignment (`_property_is_managed`) | Never. Exits: completion grace or explicit user action |
| Placeholder | Not managed, not a searching row | Clock from `seller_side_unrepresented_since` |

Placeholder paths (anchor = latest of `seller_side_unrepresented_since`, `placeholder_activity_at`, `last_still_active_confirmed_at`, `lifecycle_dormancy_effective_from()`):

- **No dependants:** after **`LIFECYCLE_DORMANT_INACTIVITY_DAYS`** (90): mark dormant → snapshot → archive → release. No warning.
- **With dependants** (`_property_placeholder_has_dependants`): after **`LIFECYCLE_CONNECTED_DORMANT_DAYS`** (150): `dormancy_warning` for this row only → **`LIFECYCLE_DORMANCY_CONFIRMATION_DAYS`** (30) → mark dormant → snapshot → archive → release.

The evaluator (`lib/lifecycle/dormancyScenarios.ts`) treats a context with no seller-side signals as managed, so an application running against an older signals RPC plans nothing.

## Dependent-side activity

Only the placeholder's dependent side restarts its clock (`_record_placeholder_dependent_activity` writes `placeholder_activity_at` and returns a pending warning to `active`, logged with `metadata.source`):

| Source | Trigger |
|--------|---------|
| `placeholder_activity` | Non-system activity on the placeholder row |
| `placeholder_stage_change` | Stage change on the placeholder row |
| `linked_sale_activity` | Non-system activity on the same-chain sale linking to it |
| `linked_sale_stage_change` | Stage change on that linking sale |
| `buyer_counterparty_joined` | A buyer counterparty joining the row |
| `buyer_ready_activity` | Non-system activity on a Buyer Ready node linked to it |
| `buyer_ready_progress` | Stage, progress or status change on a Buyer Ready node linked to it |

System notices (`updated_by = 'system'`) never count. Nothing fans out across the chain. Managed rows ignore these calls.

## Operational activity persistence

`last_operational_activity_at` is still maintained for operational signals (lifecycle signals, release analytics snapshot metrics) but does **not** drive dormancy, the dashboard "Last updated" (derived from activity rows by the summary worker) or chain intelligence.

`touch_property_operational_activity` writes the property row and its `chains` row only — never chain peers — and a repeat touch in the same transaction writes nothing. It is service_role only.

| Mutation | Updates `last_operational_activity_at` |
|----------|----------------------------------------|
| `activities` INSERT (not `system`) | Property + `chains` row |
| `activities` INSERT by `system` (notices) | Nothing |
| `properties` UPDATE (stage, status, connections, chain topology) | Property + `chains` row |
| `property_counterparty_participants` active | Property + `chains` row |
| `property_claim_metadata` → `claimed` | Property + `chains` row |
| Buyer Ready node progress | `chains` row only (`_touch_chain_operational_activity`) |

## Representation changes

`_refresh_property_seller_side_state` (property row locked first) runs from triggers on identities, EA assignments, counterparties and property inserts / relationship changes:

- Seller side represented → clock cleared, `dormancy_warning` / `dormant` row returned to `active` (logged), no next evaluation.
- Seller side unrepresented → clock started at that moment (never earlier than the effective-from floor), next evaluation scheduled.

## Active chain protection

Before archive/release, `property_lifecycle_chain_release_safe()` fails closed for completed-chain rows when another member is still active with meaningful participation or in a warning with time remaining. A placeholder in an uncompleted chain is not blocked by unrelated chain activity — its own clock already accounts for its dependants.

## Completed transactions (Scenario A)

Chain `completed_at` (trigger `_trg_chains_completion_schedule_lifecycle` schedules an evaluation) → grace → snapshot → archive → release. Applies to managed rows and placeholders alike.

## Address reservation

`_property_reservation_state` (`20261005140000`): historical (archived / released / anonymised) → `lifecycle_held` → `awaiting_seller` (no seller side) → `awaiting_buyer` → `live_homeowner` / `live_ea_managed`. `property_address_is_reserved()` is true for everything except `historical`.

## Warning / confirmation architecture

| Field | Purpose |
|-------|---------|
| `seller_side_unrepresented_since` | Placeholder clock start (null while managed) |
| `placeholder_activity_at` | Last dependent-side activity |
| `next_evaluation_at` | When the worker should evaluate the row next (partial index) |
| `dormancy_warning_at` | When warning issued |
| `dormancy_confirmation_deadline_at` | Confirmation window end |
| `dormancy_warning_notified_at` | Successful warning email delivery (null = pending or retryable) |
| `dormancy_warning_notification_claimed_at` | In-flight send claim (concurrency / retry) |
| `last_still_active_confirmed_at` | Last structured confirmation |
| `property_lifecycle_still_active_confirmations` | Append-only audit (`confirmation_code = 'still_active'`) |

RPC: `confirm_transaction_still_active(p_property_id)` — the placeholder's **dependent side only** (`_is_placeholder_dependent_side_user`: its buyer identity holder, a buyer counterparty, the seller side of the linking sale, the linked Buyer Ready owner). Locks the property row then the lifecycle row. Unlimited, audited, idempotent within 24 hours, reschedules `next_evaluation_at`. Managed row → `ok` no-op (`managed: true`). Dormant or later → `invalid_state_for_confirmation`. Grants no authority. `can_confirm_property_still_active` is service-role only.

Status read: `get_property_lifecycle_status(p_property_id)` — one primary-key read returning the state, whether the row is managed, and the warning detail only for a caller who can confirm.

UI:

- Property page: `PropertyLifecycleDormancySection` from one `get_property_lifecycle_status` call (`lib/lifecycle/loadPropertyLifecycleState.ts`).
- Buyer Ready page: `ChainLifecycleDormancySection`, loaded only when the viewer owns the node.
- Chain page: no lifecycle call.

TypeScript helpers:

- `lib/lifecycle/confirmStillActive.ts`
- `lib/lifecycle/loadPropertyLifecycleState.ts`
- `lib/lifecycle/stillActiveConfirmationEligibility.ts`
- `lib/lifecycle/dormancyWarningNotifications.ts` (worker integration)
- `lib/communications/sendDormancyWarningEmail()` (Resend pipeline)

### Dormancy warning email

| Step | RPC / function |
|------|----------------|
| List pending targets (the row itself only) | `list_dormancy_warning_notification_targets(p_source_property_id)` |
| Resolve recipient | `get_dormancy_warning_email_recipient(p_property_id)` → `recipient_kind` `buyer` or `estate_agent` |
| Claim send | `try_claim_dormancy_warning_notification(p_property_id, p_worker_run_id)` |
| Mark sent | `mark_dormancy_warning_notification_sent(p_property_id, p_email_event_id)` |
| Release claim (retry) | `release_dormancy_warning_notification_claim(p_property_id)` |

Recipient order: the purchase's buyer; a buyer counterparty; the linking sale's seller homeowner; the linked Buyer Ready owner; a member of the EA branch assigned to the linking sale (branch admins first) when that EA may update the sale. Verified, unbanned accounts only. Every recipient passes `_is_placeholder_dependent_side_user` — the confirmation check — so whoever is emailed can confirm; if nobody qualifies, no email is sent and the in-app warning is shown only to people who can confirm. The EA variant says the property is an onward purchase and that confirming gives the branch no control over it.

CTA: `/property/{id}?lifecycle=dormancy-warning` — navigates only; does not mutate lifecycle state.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `LIFECYCLE_COMPLETED_GRACE_DAYS` | 30 | Post-completion grace |
| `LIFECYCLE_DORMANT_INACTIVITY_DAYS` | 90 | Placeholder without dependants |
| `LIFECYCLE_CONNECTED_DORMANT_DAYS` | 150 | Placeholder with dependants, before warning |
| `LIFECYCLE_DORMANCY_CONFIRMATION_DAYS` | 30 | Confirmation window |
| `LIFECYCLE_DORMANCY_EFFECTIVE_FROM` | 2026-10-05T00:00:00Z | Clock floor (database: `app.lifecycle_dormancy_effective_from`, same default) |
| `LIFECYCLE_EVALUATION_BATCH_SIZE` | 100 | Candidate batch size |
| `LIFECYCLE_WORKER_LEASE_SECONDS` | 300 | Per-property worker lease |
| `LIFECYCLE_WORKER_TIME_BUDGET_SECONDS` | 240 | Run budget |
| `LIFECYCLE_WORKER_RETRY_DELAY_SECONDS` | 3600 | Next evaluation after a failed row |
| `LIFECYCLE_CRON_ENABLED` | unset | Worker route is a no-op unless `true` |
| `CRON_SECRET` | — | Secures the cron routes |

**Related (separate):** data-retention cron `/api/cron/data-retention` (`30 3 * * *`) handles email/billing/invitation metadata retention — it does **not** run inside this property lifecycle worker.

## Worker architecture

The worker route `/api/cron/property-lifecycle` is **not scheduled** in `vercel.json`; after `CRON_SECRET` auth it returns `{ disabled: true }` unless `LIFECYCLE_CRON_ENABLED=true`.

1. **Candidate selection** — `list_property_lifecycle_worker_candidates(p_limit)`: indexed `next_evaluation_at <= now()`. No exclude list.
2. **Evaluation** — TypeScript pure functions (`evaluatePropertyLifecycleFromContext`).
3. **Execution** — `execute_property_lifecycle_action` per planned action (service role). Locks the property row, then the lifecycle row; refuses every dormancy step on a managed row (`seller_side_represented`) and re-checks timing (`warning_not_due`, `dormancy_not_due`, `warning_not_expired`). The plan stops when the dormancy gate is skipped or fails.
4. **Scheduling** — `schedule_property_lifecycle_evaluation` writes the row's next instant (`computeNextLifecycleEvaluationAt`, always future), or the retry delay after a failure. The run stops on an empty batch or a repeated candidate.
5. **Audit** — `property_lifecycle_events` append-only log.

## Security

- Cron route requires `Authorization: Bearer ${CRON_SECRET}` (timing-safe compare), checked before the enable flag
- Worker RPCs granted to `service_role` only
- `confirm_transaction_still_active` and `get_property_lifecycle_status` granted to `authenticated`; both re-check the caller

## Verification

```bash
npx tsx --conditions react-server scripts/verify-property-lifecycle-automation.ts
npx tsx scripts/verify-property-lifecycle.ts
npx tsx scripts/verify-lifecycle-bounded-dormancy-migration.ts
npx tsx scripts/verify-lifecycle-still-active-confirmation.ts              # live part needs Development
npx tsx --conditions react-server scripts/verify-lifecycle-bounded-dormancy-development.ts --execute   # Development only
```

Live tests cannot reach a "due" warning or dormancy before `LIFECYCLE_DORMANCY_EFFECTIVE_FROM` plus 90 / 150 days; they cover the not-due skips, deadline expiry, confirmation and activity resets.

## Remaining before Right to Erasure

- Per-user GDPR erase workflow operational readiness (mailbox, DPAs, drills) — architecture: [GDPR Right to Erasure Architecture](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md)
- Analytics platform ingestion from snapshots
- The worker never anonymises; anonymisation remains a separate step

**Note:** Arbitrary `activities.update` free text is blocked at DB level (`is_allowed_structured_activity_update`). Historical activity scrub on lifecycle anonymise remains a separate hardening item.
