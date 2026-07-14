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
| `dormant` | Inactivity criteria met; pending archival review (Scenario B) |
| `archived` | Operational links removed; property prepared for release |
| `released` | Address available for a future claim without support (Scenario C) |
| `anonymised` | Operational PII cleared; only anonymised analytics snapshot retained (Scenario D) |

### State flow (simplified)

```
active ──completion confirmed──► completed_grace ──grace elapsed──► archived ──release──► released
  │                                                                    │
  └──inactivity criteria met──► dormant ──archive job──► archived      └──analytics job──► anonymised
```

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

### Scenario B — Dormant transaction

**When all are true** (defaults):

- No connected counterparty (`buyer_connected` / `seller_connected` as applicable)
- No meaningful activity within inactivity window (default 90 days)
- No accepted claim / active operational relationship progressing
- No pending accepted invitations driving progress

**Actions:** Unlink users, archive operational state, release property.

### Scenario C — Future owner

When lifecycle reaches `released`, a new homeowner claims via normal flows (`claim_operational_property` or Start Move) **without support intervention**.

Requires: reset `property_claim_metadata`, clear stale memberships, global address not blocked by orphaned operational rows.

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
| `LIFECYCLE_DORMANT_INACTIVITY_DAYS` | `90` | Scenario B inactivity threshold |
| `LIFECYCLE_MEANINGFUL_ACTIVITY_DAYS` | `14` | Activity window that resets dormancy clock |
| `LIFECYCLE_EVALUATION_BATCH_SIZE` | `100` | Future worker batch size |

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

### Phase 2 — Early production

- Scheduled lifecycle worker (Edge Function / cron)
- Execute archive/release actions behind `PropertyLifecycleService.applyPlan()`
- Harden `ensure_property_membership` with property-scoped authz
- Global address dedup constraint (design + migration)
- Hook chain completion → `completed_grace` transition

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
