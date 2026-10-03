# Property Lifecycle Management — Architecture

Keynetic links authenticated users to properties during **active transactions**. It does **not** verify legal ownership. Operational relationships must therefore expire automatically once they are no longer required.

This document defines the lifecycle framework, audit findings, retention model, configuration, and phased roadmap.

See also: [Property Operational Ownership Model](./PROPERTY_OWNERSHIP_MODEL.md).

---

## Investigation — current claim and membership behaviour

### 1. Second user claiming an active property

**Authoritative RPC:** `claim_operational_property` (`20260712120000_invitation_rejection.sql`)

After the first successful claim, `property_claim_metadata.claim_status` becomes `claimed` (via trigger `property_members_sync_claim` from Phase 7A).

| Attempt | Result |
|---------|--------|
| Different email, already claimed | `not_claimable` |
| Same user retries | `already_member` |
| Matching email before claim | Allowed (with invite email match) |

There is **no explicit “owned by another user” error** on the claim RPC — blocking relies on `claim_status ∉ {unclaimed, claim_invited}`.

**Gap:** Claim does not inspect existing `property_members` beyond `already_member` for the caller. Protection depends on invite email + claim status, not a global ownership lock.

### 2. Multiple unrelated operational members

**Yes — in several paths.**

| Constraint | Scope |
|------------|--------|
| `UNIQUE (property_id, user_id)` on `property_members` | One row per user per property |
| No `(property_id, role)` uniqueness | Multiple users may share roles |

| Path | Multiple unrelated users? |
|------|---------------------------|
| EA claim (`claim_operational_property`) | Blocked after claim (one invitee) |
| Join chain (`join_chain_property`) | **Yes** — counterparty join by design |
| `ensure_property_membership` RPC | **Yes** — no property-scoped authz |

**Gap:** `ensure_property_membership` allows any authenticated user to attach to any known `property_id`. Address reservation abuse is possible if IDs are discovered.

### 3. Address reservation abuse protection

| Control | Scope |
|---------|--------|
| `property_exists_for_onboarding(address, postcode)` | Global advisory (Start Move UI) |
| `create_ea_operational_property` duplicate check | **Per chain only** |
| Convert placeholder RPC | Global duplicate enforced |
| Placeholder uniqueness | One `searching` row per user per chain (no address) |
| Global unique on `(address, postcode)` | **Not enforced at DB insert** |

**Gap:** Same address may exist across multiple chains. Direct `properties.insert` bypasses Start Move advisory checks.

### 4. Data retention — current tables

| Category | Tables | Key fields |
|----------|--------|------------|
| **Addresses** | `properties` | `address`, `postcode`, `chain_id`, topology |
| **Emails** | `property_claim_metadata`, `email_events`, `auth.users` | `invite_email`, `recipient_email` |
| **Memberships** | `property_members`, `property_ea_assignments`, `property_claim_metadata` | `user_id`, roles, claim state |
| **Activities** | `activities` | `property_id`, `update`, `updated_by`, `timestamp` |
| **Chain history** | `chains`, `chain_completion_events`, `properties.linked_property_id` | completion lifecycle, append-only events |

Operational summaries (`property_operational_summary`, `chain_operational_summary`) are derived caches, not historical source of truth.

---

## Core principles

1. **Operational data is temporary** — memberships, invites, and permissions expire.
2. **Analytics are permanent** — anonymised metrics survive operational cleanup.
3. **Addresses and identities separate** — post-archive, reporting uses anonymised refs, not live ownership.
4. **Historical reporting without operational ownership** — benchmarks do not require retained PII or active memberships.

---

## Lifecycle states

Operational lifecycle (`property_lifecycle_states.operational_state`):

| State | Meaning |
|-------|---------|
| `active` | Normal operational relationship; users may act on the property |
| `completed_grace` | Chain completion confirmed; grace period before operational cleanup (Scenario A) |
| `dormancy_warning` | Unrepresented placeholder with dependants past its window; awaiting its dependent side's still-active confirmation (Scenario B) |
| `dormant` | Placeholder window elapsed (or confirmation window expired); pending archival (Scenario B) |
| `archived` | Operational links removed; property prepared for release |
| `released` | Address available for a future claim without support (Scenario C) |
| `anonymised` | **Property-level** operational PII cleared; analytics snapshot retained. **Not** full GDPR RTBF (Scenario D) |

### State flow (simplified)

```
active ──completion confirmed──► completed_grace ──grace elapsed──► archived ──release──► released
  │
  ├── placeholder, no dependants ──► dormant ──archive──► archived ──release──► released
  │
  └── placeholder with dependants ──► dormancy_warning ──expire──► dormant ──► archived ──release
                                        │                                                    │
                                        ├──dependent-side confirm──► active                  └──analytics──► anonymised
                                        ├──dependent-side activity──► active
                                        └──seller side represented again──► active (managed)

managed (seller side represented) ── no dormancy path; exits are completion grace or explicit user action
```

Each worker step re-checks the state it needs under a row lock (`execute_property_lifecycle_action`): `expire_dormancy_warning` only moves a `dormancy_warning` row past its deadline to `dormant`; `mark_dormant` only moves an `active` row that is still inactive; `archive_operational` needs `dormant` or `completed_grace`; `release_property` needs `archived`; snapshots need `dormant`, `completed_grace`, `archived` or `released`. The worker stops a row's plan when the dormancy gate (`expireDormancyWarning` / `markDormant`) is skipped or fails, so a warning reset between evaluation and execution can never be archived or released.

Bounded dormancy (`20261005130000`) separates **managed** rows from **unrepresented placeholders**:

- **Managed** — the seller side is represented (`_property_side_representation`: a homeowner, or an EA assignment). A managed row never enters dormancy and is never made dormant, archived or released through inactivity, however stale. It keeps the 14/21-day staleness signals (page alert, confidence). Its only lifecycle exits are completion grace and explicit user action. Buyers, counterparties, viewers, creators and plain `property_members` never make a row managed.
- **Placeholder** — not managed and not a searching row. Its clock starts when the seller side becomes unrepresented (`seller_side_unrepresented_since`).

| Placeholder | Path | Default |
|-----|------|---------|
| No dependants | Quiet: dormant → snapshot → archive → release, no warning | 90 days |
| With dependants (`_property_placeholder_has_dependants`) | Warning → 30-day confirmation → dormant → snapshot → archive → release | 150 days |

**Dependants:** `buyer_connected` on a sale; an active identity or counterparty; a Buyer Ready node linked to the row; a represented row linking to it; a represented onward row. Rows that merely share the chain do not count.

**Anchor** (`_property_placeholder_anchor`, mirrored by `placeholderDormancyAnchor`): the latest of `seller_side_unrepresented_since`, `placeholder_activity_at`, `last_still_active_confirmed_at` and the effective-from floor. History is never inferred from `stage_entered_at` or old activity.

**Dependent-side activity only** (`_record_placeholder_dependent_activity`) restarts a placeholder's clock and returns its pending warning to `active`: non-system activity or a stage change on the placeholder itself; non-system activity or a stage change on the same-chain sale that links to it; a buyer counterparty joining; activity or progress on a Buyer Ready node linked to it. System notices never count, and nothing fans out across the chain — activity on one row never resets another unrelated row.

**Representation changes:** when the seller side becomes represented again (a claim, an EA assignment, a seller counterparty) the row becomes managed immediately: the clock clears and a `dormancy_warning` / `dormant` row returns to `active` (logged). When the last seller-side representative leaves, the clock starts at that moment.

**Rollout floor:** every clock starts no earlier than `LIFECYCLE_DORMANCY_EFFECTIVE_FROM` (default `2026-10-05T00:00:00Z`; database `lifecycle_dormancy_effective_from()` reads `app.lifecycle_dormancy_effective_from` with the same default). Rollout returns legacy `dormancy_warning` / `dormant` rows to `active` (logged) and releases nothing.

Transitions are **explicit**, **audited** (`property_lifecycle_events`), and **configurable**. No silent deletion.

---

## Scenarios

### Scenario A — Completed transaction

**Trigger:** `chains.completed_at` set (completion confirmed).

**After grace period** (default 30 days):

- Remove operational memberships
- Revoke operational permissions / EA assignments
- Release property for future claims
- Create anonymised analytics snapshot first

### Scenario B — Unrepresented placeholder

Only placeholders (see above) take this path. Managed rows never do.

**No dependants:** dormant → snapshot → archive → release after **`LIFECYCLE_DORMANT_INACTIVITY_DAYS`** (default 90) from the anchor, without a warning.

**With dependants:** `dormancy_warning` after **`LIFECYCLE_CONNECTED_DORMANT_DAYS`** (default 150) from the anchor — this row only, never its chain peers — then a **`LIFECYCLE_DORMANCY_CONFIRMATION_DAYS`** (default 30) confirmation window, then dormant → snapshot → archive → release if nobody on its dependent side confirms or acts.

**Dependent side** (`_is_placeholder_dependent_side_user`): the purchase's buyer identity holder; a buyer counterparty on the row; the seller side of the same-chain sale linking to the row (its homeowner, or a verified member of its EA branch when that sale is EA-operated); the owner of a Buyer Ready node linked to the row.

**Warning recipient** (`get_dormancy_warning_email_recipient`, verified unbanned accounts only, first match): the purchase's buyer; a buyer counterparty; the seller homeowner of the linking sale; the linked Buyer Ready owner; then a member of the EA branch assigned to the linking sale (branch admins first) **only when that EA may update the sale** (`homeowner_only_updates = false`, or the sale has no seller homeowner). Every recipient must pass the same dependent-side check as confirmation, so whoever is emailed can confirm; an EA on a homeowner-only sale is never the actionable recipient. People receive the `buyer` variant; the EA receives the `estate_agent` variant, which says the property is an onward purchase and that confirming gives the branch no control over it. A row with no reachable recipient is still warned and released after the window, without an email.

Structured confirmation: `confirm_transaction_still_active()` — "My transaction is still active" (no free text). Dependent side only (`can_confirm_property_still_active`, service role only; the UI reads `get_property_lifecycle_status`). Locks the property row then the lifecycle row; restarts this row's clock only; idempotent within 24 hours; unlimited; every confirmation is audited (`property_lifecycle_still_active_confirmations`). On a managed row it is a no-op (`managed: true`). On a dormant, archived, released or anonymised row it returns `invalid_state_for_confirmation`. **Confirming grants no authority** and changes no ownership or representation — delegates, viewers, EAs connected only through the chain and outsiders get `not_authorised`.

**Does NOT restart a placeholder's clock:** identity age, login recency, page views, system notices, operational or chain-level activity elsewhere in the chain, issuing invitations.

### Scenario C — Future owner

When lifecycle reaches `released`, the address is free and a new homeowner starts a new transaction at it (Start Move, or a new EA-created row) **without support intervention**.

The released row itself is historical: claims, identity grants and joins on an archived, released or anonymised row are refused (`property_released`, M3 `20261005120000`). Such rows are not listed by `discover_claimable_properties()` (so they neither appear in the homeowner's properties-to-claim list nor drive the post-login claim redirect), and their invitation links resolve to `property_released`.

**Seller side leaving** (M3 `_execute_participation_delink`, see [Participation De-link](./PARTICIPATION_DELINK.md)): a row is released immediately only when it was added by mistake (`wrong_property`, `added_by_mistake`, `duplicate_property`) and nothing depends on it. Otherwise the departing authority is removed and the row stays in its chain as an unrepresented placeholder (counterparties, links, flags and valid invitations kept); the lifecycle above decides what happens next. Nobody gains authority over the row; the invited homeowner can still claim it.

Requires: global address not blocked by orphaned operational rows (address reservation, M1/M3).

### Scenario D — Analytics

Before operational cleanup, capture `property_analytics_snapshots`:

- Anonymised property/chain reference (UUID, not live `property_id` after release)
- Region/postcode district (not full address)
- Stage durations, activity counts, completion timing
- **No** emails, names, or raw addresses

---

## Data retention strategy

| Layer | Retention | Examples |
|-------|-----------|----------|
| **Operational** | Temporary; removed on archive/release | `property_members`, invites, EA assignments, operational summaries |
| **Transactional audit** | Bounded; anonymised after grace | `activities` (text may contain PII — scrub or snapshot then delete) |
| **Analytics** | Permanent | `property_analytics_snapshots`, aggregated chain completion metrics |
| **Legal/comms audit** | Separate policy (email_events) | Retain per communications compliance; not tied to property membership |

---

## Configuration

Environment variables (see `lib/lifecycle/config.ts`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `LIFECYCLE_COMPLETED_GRACE_DAYS` | `30` | Scenario A grace before archive |
| `LIFECYCLE_DORMANT_INACTIVITY_DAYS` | `90` | Placeholder without dependants: dormant after this many days from its anchor |
| `LIFECYCLE_CONNECTED_DORMANT_DAYS` | `150` | Placeholder with dependants: warning after this many days from its anchor |
| `LIFECYCLE_DORMANCY_CONFIRMATION_DAYS` | `30` | Confirmation window after warning |
| `LIFECYCLE_DORMANCY_EFFECTIVE_FROM` | `2026-10-05T00:00:00Z` | Floor for every placeholder clock (must match `app.lifecycle_dormancy_effective_from`) |
| `LIFECYCLE_EVALUATION_BATCH_SIZE` | `100` | Worker batch size (`p_limit` of the candidate query) |
| `LIFECYCLE_WORKER_TIME_BUDGET_SECONDS` | `240` | Worker run budget; batches repeat until a batch is empty or repeats |
| `LIFECYCLE_WORKER_RETRY_DELAY_SECONDS` | `3600` | Next evaluation after a failed row |
| `LIFECYCLE_CRON_ENABLED` | unset | The worker route does nothing unless `true` |

All periods are configurable — **never hardcode** in cleanup jobs.

---

## Implementation roadmap

### Phase 1 — Foundation (this delivery)

- [x] Lifecycle types, config, scenario evaluators (`lib/lifecycle/`)
- [x] DB schema: `property_lifecycle_states`, `property_lifecycle_events`, `property_analytics_snapshots`
- [x] Read-only signal RPC: `get_property_lifecycle_signals`
- [x] Dry-run evaluation RPC: `evaluate_property_lifecycle`
- [x] State recording RPC: `record_property_lifecycle_transition` (no automated cleanup)
- [x] Architecture documentation and audit

**Not in Phase 1:** automated workers, membership deletion, address release, production hooks.

### Phase 2 — Automated production (implemented)

- Worker route: `GET /api/cron/property-lifecycle`. **Not scheduled** — it has no `vercel.json` cron and returns `{ disabled: true }` (after `CRON_SECRET` auth) unless `LIFECYCLE_CRON_ENABLED=true`. Scheduling it is a separate, explicit release decision.
- TypeScript evaluation + SQL execution via `runPropertyLifecycleWorker()` (time-budgeted) over `runPropertyLifecycleWorkerBatch()`. Candidates come from the indexed `next_evaluation_at <= now()` query (`list_property_lifecycle_worker_candidates`); after each row the worker writes its next evaluation instant (`schedule_property_lifecycle_evaluation`, always in the future, or a retry delay on failure), so the run needs no exclude list and stops on an empty or repeated batch.
- Service-role RPCs: candidate selection, leases, snapshot persistence, archive/release/anonymise
- Address reusability: `property_address_is_reserved()` + updated `property_exists_for_onboarding()`
- Idempotent analytics snapshots (`source_property_id`, `snapshot_kind` unique)
- Migration: `supabase/migrations/20260714190000_property_lifecycle_automation.sql`

**Related (separate system):** data retention for email/billing/invitation metadata uses `/api/cron/data-retention` (`30 3 * * *`) — see [GDPR Data Retention Schedule](./GDPR_DATA_RETENTION_SCHEDULE.md). Do not merge into the property lifecycle state machine.

**Environment variables:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `LIFECYCLE_COMPLETED_GRACE_DAYS` | 30 | Post-completion grace before archival |
| `LIFECYCLE_DORMANT_INACTIVITY_DAYS` | 90 | Placeholder without dependants |
| `LIFECYCLE_CONNECTED_DORMANT_DAYS` | 150 | Placeholder with dependants, before warning |
| `LIFECYCLE_DORMANCY_CONFIRMATION_DAYS` | 30 | Confirmation window |
| `LIFECYCLE_DORMANCY_EFFECTIVE_FROM` | 2026-10-05T00:00:00Z | Rollout floor for previously exempt rows |
| `LIFECYCLE_EVALUATION_BATCH_SIZE` | 100 | Worker batch size |
| `LIFECYCLE_WORKER_LEASE_SECONDS` | 300 | Per-property processing lease |
| `LIFECYCLE_WORKER_TIME_BUDGET_SECONDS` | 240 | Cron run time budget (route `maxDuration` is 300) |
| `CRON_SECRET` | — | **Required** for cron route auth |

**Manual configuration:**

1. Apply migration `20260714190000_property_lifecycle_automation.sql`
2. Set `CRON_SECRET` in Vercel (must match Authorization bearer token)
3. Leave the worker unscheduled until the release decision (see above)
4. Optionally mirror retention in Postgres: `app.lifecycle_*` settings

```bash
npx tsx --conditions react-server scripts/verify-property-lifecycle-automation.ts
npx tsx scripts/verify-lifecycle-bounded-dormancy-migration.ts
npx tsx --conditions react-server scripts/verify-lifecycle-bounded-dormancy-development.ts --execute   # Development only
```

Bounded dormancy deploy order: apply `20261005120000` → `20261005130000` → `20261005140000` → `20261005150000` **before** the application. An application running against the older signals RPC sees no seller-side signals and treats every row as managed, so it plans no dormancy step; the database dispatcher independently refuses every dormancy step on a managed row.

### Phase 3 — Analytics platform

- Analytics ingestion pipeline from snapshots
- Benchmark dashboards (region, stage timing, chain depth)
- Full anonymisation pipeline for legacy rows
- GDPR export/erase integration using lifecycle audit trail

---

## Usage (Phase 1)

```typescript
import { PropertyLifecycleService } from "@/lib/lifecycle";

const service = new PropertyLifecycleService(supabase);
const evaluation = await service.evaluateProperty(propertyId);

// evaluation.recommendedActions — dry-run only
// evaluation.context — operational signals
```

```bash
npx tsx scripts/verify-property-lifecycle.ts
```

Apply migration: `supabase/migrations/20260714120000_property_lifecycle_foundation.sql`
