# PR5 Completion Report

**Project:** Keynetic / Clinkit  
**Phase:** PR5 — Homeowner Privacy, Membership Integrity, Route Authorization  
**Development Supabase project:** `bbbsxzxcjkmpqsfvmhbo`  
**Report date:** 2026-06-06  
**Status:** Complete on Development (database + application layers)

This document is a standalone handoff for continuing development without prior chat context. For migration SQL details and RLS policy tables, see also `docs/PR5_PRIVACY_VERIFICATION_REPORT.md`. For product principles, see `docs/KEYNETIC_ARCHITECTURE.md`.

---

## Executive summary

PR5 established a **participant-first privacy model** for homeowner chain workflows: peers see generic labels, not addresses; data access is enforced at the database layer via RLS and participant views; membership rows are deduplicated and constrained; and chain-scoped UI routes are gated at the server before any page content renders.

**Development outcomes confirmed:**

- Dashboard and chain topology load correctly for participants.
- Duplicate `property_members` rows removed; `UNIQUE (property_id, user_id)` enforced.
- Reconciliation migration applied (`20260610220000`).
- Application-layer route authorization implemented for chain, buyer-ready, and property pages.
- Estate agent onboarding and assignment flows remain functional.

---

## Problem statements

### 1. Homeowner privacy

Homeowners in the same chain could potentially see each other's full property addresses through dashboard headings, chain tiles, or unscoped database reads. The platform rule (see architecture doc §4) requires **generic labels for peer properties** (`Property N`, Connected Sale, etc.) while allowing users to see their **own** property details.

### 2. Membership integrity

The dashboard stopped loading chains for some users. PostgreSQL error **21000** (`cardinality violation`) occurred when querying `chain_properties_participant` because duplicate `(property_id, user_id)` rows in `property_members` caused the legacy inline role subquery in the view to return multiple rows.

Join Chain and Start Move flows used blind `.insert()` into `property_members`, so retries and double-clicks created duplicate memberships.

### 3. Route authorization (URL enumeration)

Authenticated homeowners who were **not** chain participants could navigate directly to `/chain/{id}` and receive a **partially rendered page**: chain heading from the URL, synthetic intelligence defaults (health, confidence, forecast), and page shell — even when context held no chain data.

### 4. Partial migration apply

Migration `20260610200000_phase5_homeowner_privacy_rls.sql` was **partially applied** on Development: RPCs, `chain_nodes` RLS, and an outdated participant view existed, but `current_user_property_role`, base-table RLS on `properties` / `activities` / `property_members`, and the corrected view definition were missing.

### 5. Environment confusion (historical)

Some SQL was run against the wrong Supabase branch/project during investigation, producing false conclusions about missing objects. The authoritative Development project matches `NEXT_PUBLIC_SUPABASE_URL` → `bbbsxzxcjkmpqsfvmhbo`.

---

## Root causes discovered

| Issue | Root cause |
|-------|------------|
| Dashboard empty / 21000 errors | Duplicate `property_members` + view scalar subquery returning multiple roles per property |
| Duplicate memberships | No `UNIQUE (property_id, user_id)`; app insert paths non-idempotent |
| Peer address exposure risk | Client filtered by `chain_id` but read from base `properties` table; no participant view / RLS on base tables |
| Partial PR5 on dev | Manual or interrupted apply of `20260610200000` — stopped before RLS blocks for three tables |
| `/chain/{id}` open to strangers | Middleware enforced account type + login only; no chain-level participant check; client page rendered unconditionally |
| Wrong DB during early audits | SQL Editor connected to Production branch while app used Development |

---

## Database migrations applied (Development)

The following PR5-related migrations are in the repository. **On Development, the critical apply sequence was:**

1. `20260610215000_property_members_deduplicate_and_unique.sql` — **Applied successfully**
2. `20260610220000_reconcile_phase5_homeowner_privacy_rls.sql` — **Applied successfully**

Earlier PR5/PR4 objects from `20260610200000` and prerequisites were already partially present before reconciliation.

### Migration reference

| Migration | Purpose | Dev status |
|-----------|---------|------------|
| `20260610170000_phase4_ea_property_assignments.sql` | EA tables; `is_property_member`, `is_ea_assigned_to_property` | Prerequisite (present) |
| `20260610200000_phase5_homeowner_privacy_rls.sql` | Full PR5: helpers, view, RLS, RPCs | Partially applied before reconciliation |
| `20260610210000_fix_chain_properties_participant_role_subquery.sql` | View fix for role subquery | **Superseded by 10220000** (do not apply separately if 10220000 applied) |
| `20260610215000_property_members_deduplicate_and_unique.sql` | Dedup; `UNIQUE`; `ensure_property_membership`; hardened `join_chain_property` | **Applied** |
| `20260610220000_reconcile_phase5_homeowner_privacy_rls.sql` | `current_user_property_role`; corrected view; `properties` / `activities` / `property_members` RLS | **Applied** |

### Database objects delivered by PR5

**Functions**

- `is_chain_participant(p_chain_id)` — participant check for chains
- `current_user_property_role(p_property_id)` — single canonical role per user/property
- `is_property_member(p_property_id)` — own membership check
- `is_ea_assigned_to_property(p_property_id)` — EA assignment check
- `ensure_property_membership(p_property_id, p_role)` — idempotent membership insert
- Join/topology RPCs: `join_chain_property`, `resolve_chain_for_join`, `establish_connected_hop`, `break_chain_connection`, etc.

**Views**

- `chain_properties_participant` — participant-filtered topology; redacts peer `address` / `postcode`; uses `current_user_property_role()`
- `chain_nodes_chain_summary` — participant-filtered buyer-ready projection (Phase 2a)

**RLS (post-reconciliation)**

- `properties` — member or assigned EA SELECT; creator INSERT; member UPDATE; anon revoked
- `property_members` — own-row SELECT/INSERT only
- `activities` — chain-participant SELECT; member/buyer-ready INSERT
- `chain_nodes` — participant SELECT/INSERT/UPDATE
- `chains` — participant SELECT/UPDATE; authenticated INSERT

---

## Privacy fixes implemented

### Database layer

- Participant view replaces base-table reads for homeowner topology.
- Peer addresses/postcodes nulled at view layer via `is_property_member(p.id)`.
- Base-table RLS prevents global `properties` / `activities` / `property_members` reads.
- Anon access revoked on sensitive tables.

### Application layer

| File | Change |
|------|--------|
| `context/ChainContext.tsx` | Loads `chain_properties_participant`; scopes `chains`, `chain_nodes`, `activities` to participant chain IDs |
| `lib/operationalPosition.ts` | `getParticipantPropertyLabel`, `getDashboardChainTitle`, `getChainTileDisplayTitle` — generic peer labels |
| `app/dashboard/page.tsx` | Uses label helpers; no raw peer addresses |
| `app/join-chain/page.tsx` | `join_chain_property` RPC (idempotent membership) |
| `app/start-move/page.tsx` | `ensurePropertyMembership` on membership paths |
| `lib/ensurePropertyMembership.ts` | Wrapper for `ensure_property_membership` RPC |
| `lib/searchingPlaceholder.ts` | RPC-based position/duplicate checks |
| `lib/chainConnection.ts` | `establish_connected_hop` RPC |

### UI privacy behaviour (participants)

| Surface | Own property | Peer property |
|---------|--------------|---------------|
| Dashboard property row | Full address | `Property N` |
| Dashboard chain title | Own address (if present) | `Chain #{id}` |
| Chain topology tile | Role labels (`Your Sale`, `Connected Purchase`, etc.) | Generic labels — **no peer address** |
| Property page headline | Label helpers | `Connected Sale` / `Connected Purchase` |

---

## Access-control fixes implemented

### Server route authorization (application layer)

Authorization runs in **Server Component layouts** before client pages mount. Unauthorized and invalid IDs both call `notFound()` (HTTP 404, generic copy).

| Route | Layout | Helper |
|-------|--------|--------|
| `/chain/[chainId]` | `app/chain/[chainId]/layout.tsx` | `requireChainParticipantForRoute` → `is_chain_participant(p_chain_id)` |
| `/buyer-ready/[chainId]` | `app/buyer-ready/[chainId]/layout.tsx` | Same |
| `/property/[propertyId]` | `app/property/[propertyId]/layout.tsx` | `requirePropertyParticipantForRoute` → row in `chain_properties_participant` |

**Supporting files**

- `lib/supabase/server.ts` — cookie-based server Supabase client
- `lib/auth/chainAccess.ts` — chain participant guards
- `lib/auth/propertyAccess.ts` — property participant guards
- `app/not-found.tsx` — generic 404 (no chain ID echoed)
- `lib/auth/index.ts` — exports guards

**Routes that do not need chain gates**

- `/dashboard`, `/my-chains` — list only participant context data
- `/join-chain`, `/start-move` — creation flows
- `/agent/*`, `/estate-agents/*` — separate EA product

Client-side login redirects were removed from chain, buyer-ready, and property pages; middleware handles authentication, layouts handle authorization.

---

## 1. Homeowner Privacy

**Goal:** Chain participants see progress and topology without exposing peer addresses.

**Achieved**

- `chain_properties_participant` is the authoritative read path for homeowner topology in `ChainContext`.
- Label helpers enforce redaction in dashboard and chain tiles even if address fields were present.
- Base-table RLS limits direct API reads to own properties (and EA-assigned properties).

**Hybrid labelling model (current product behaviour)**

- **Personal surfaces** (dashboard): own address visible.
- **Shared chain map** (chain page topology): generic role/position labels for all tiles including own purchase.
- Aligns with architecture §4 (peer privacy) while keeping dashboard usable.

**Verification**

```bash
node scripts/verify-participant-privacy-rls.mjs
```

Manual: two homeowner accounts on a shared chain — each sees own address, peer shows `Property N` on dashboard and generic labels on chain page.

---

## 2. Membership Integrity

**Goal:** One membership row per user per property; idempotent join/create flows.

**Achieved**

- Duplicate rows removed via `20260610215000`.
- Constraint `property_members_one_user_per_property` on `UNIQUE (property_id, user_id)`.
- `ensure_property_membership` RPC for idempotent inserts.
- `join_chain_property` hardened against duplicate membership in same migration.
- App paths updated: Start Move (3 paths), Join Chain, searching placeholder.

**Canonical role resolution**

- `current_user_property_role()` prefers seller > buyer > other; deterministic tie-break on `created_at`, `id`.
- View uses this helper instead of legacy inline scalar subquery (21000-safe).

---

## 3. Route Authorization

**Goal:** Non-participants cannot access chain-scoped pages by URL guessing.

**Achieved**

- Server layout gates on `/chain/[chainId]`, `/buyer-ready/[chainId]`, `/property/[propertyId]`.
- Invalid numeric IDs and non-participant access → same 404 experience.
- No chain UI (intelligence, topology, access code, etc.) renders before authorization — layout blocks client page mount.

**Expected behaviour**

| Request | Result |
|---------|--------|
| Logged out → `/chain/123` | Middleware → login redirect |
| Non-participant → `/chain/123` | 404 not-found page |
| Invalid ID → `/chain/abc` | 404 |
| Participant → own chain | Full page (unchanged) |

---

## 4. Estate Agent Compatibility

**Goal:** PR5 must not break estate agent onboarding, assignment, or dashboards.

**Design preserved**

- `is_ea_assigned_to_property()` included in `properties` SELECT policy — EAs retain base-table read for assigned properties.
- `agent_branch_property_summaries` view unchanged (`security_invoker = false`, assignment-scoped).
- `property_ea_assignments` RLS unchanged.
- EA onboarding migrations (`20260610150000`–`20260610190000`) independent of PR5.

**Confirmed on Development:** Estate agent functionality appears intact after PR5 apply (user verification).

**Homeowner → EA assignment UI:** `PropertyEstateAgentAssignment` on chain/property pages for operational sale properties — unaffected by participant view reads.

---

## 5. Outstanding Risks

| Risk | Severity | Notes |
|------|----------|-------|
| Free-text activity updates | Low | User-typed content in `activities.update` may contain addresses; not controlled by address redaction |
| Buyer-only labelling inconsistency | Low | Dashboard shows purchase address; chain topology uses `Connected Purchase` — intentional hybrid but may confuse |
| Context load flash on property page | Low | Authorized users may briefly see "Property not found" while `ChainContext` loads (pre-existing) |
| Production / other env parity | Medium | This report reflects **Development** only; other environments need same migration sequence |
| `chains_select_participants` RLS vs app gate | Low | App layout gates UI; DB RLS on `chains` is defense-in-depth — verify on each environment |
| No automated E2E for route 404 | Medium | Build passes; browser E2E for non-participant `/chain/{id}` not in CI |
| Service-role verification gap | Low | Local `.env.local` has anon key only; catalog audits require SQL Editor or service role |

---

## Remaining known limitations

1. **Activity feed content** — Structured stages are privacy-safe; free-text updates are not sanitized for addresses or PII.
2. **Buyer-only UX** — No dedicated "Your Purchase" subtitle on property page; dashboard uses raw address as chain title.
3. **Soft not-found on property page** — Client still renders "Property not found" if context hasn't loaded; layout already authorized the route.
4. **`/my-chains`** — Shows `Chain #{id}` and access codes (participant-scoped list only — acceptable for participants).
5. **Verification script** — `scripts/verify-participant-privacy-rls.mjs` documents PR5 data-layer checks; extend for route 404 assertions if desired.
6. **10210000** — Do not apply alongside 10220000; reconciliation supersedes it.

---

## Recommended future improvements

### Privacy & UX

- Adopt explicit **Option C hybrid** labelling in copy: own address on dashboard/property personal views; generic labels on shared chain map (document in UI).
- Add buyer-only property page subtitle: *"Your agreed purchase"* with address on personal page only.
- Sanitize or structured-only activity messages for peer-visible feeds.

### Authorization & testing

- Playwright/Cypress: non-participant `/chain/{id}` → 404, no "Chain Health" / "Access Code" in DOM.
- Extend `verify-participant-privacy-rls.mjs` with `is_chain_participant` and base-table peer-read checks.
- Optional: `ChainContext.participantDataLoaded` flag to remove property-page loading flash.

### Database & ops

- Apply same migration sequence to **Production** when ready: `10215000` → `10220000` (or full PR5 on greenfield).
- Record versions in `supabase_migrations.schema_migrations` when applying manually.
- Periodic audit query for duplicate `property_members` (should stay zero with constraint).

### Platform

- Estate agent chain visibility layer (future role-based visibility per architecture §5).
- Solicitor visibility layer (future).

---

## Key file index

```
supabase/migrations/
  20260610200000_phase5_homeowner_privacy_rls.sql      # Full PR5 (reference)
  20260610215000_property_members_deduplicate_and_unique.sql
  20260610220000_reconcile_phase5_homeowner_privacy_rls.sql

lib/
  auth/chainAccess.ts          # requireChainParticipantForRoute
  auth/propertyAccess.ts       # requirePropertyParticipantForRoute
  supabase/server.ts           # Server Supabase client
  ensurePropertyMembership.ts
  operationalPosition.ts       # Privacy label helpers

app/
  chain/[chainId]/layout.tsx
  buyer-ready/[chainId]/layout.tsx
  property/[propertyId]/layout.tsx
  not-found.tsx
  dashboard/page.tsx

context/ChainContext.tsx

scripts/verify-participant-privacy-rls.mjs

docs/
  KEYNETIC_ARCHITECTURE.md
  PR5_PRIVACY_VERIFICATION_REPORT.md   # Detailed RLS/RPC tables
  PR5_COMPLETION_REPORT.md             # This document
```

---

## Verification checklist (Development)

| # | Check | Expected |
|---|-------|----------|
| 1 | Account A dashboard | Own address; peer = `Property N` |
| 2 | Account B dashboard | Same redaction pattern |
| 3 | Chain topology (participant) | Generic tile labels; no peer address |
| 4 | Non-participant `/chain/{foreignId}` | 404; no chain intelligence UI |
| 5 | Invalid `/chain/abc` | 404 |
| 6 | Join Chain double-click | Single membership row |
| 7 | Start Move | Chain + membership created |
| 8 | EA onboarding + assignment | Still works |
| 9 | `npm run build` | Passes |
| 10 | `node scripts/verify-participant-privacy-rls.mjs` | All checks pass |

---

## Chat handoff — suggested next tasks

1. Production migration plan for `10215000` + `10220000` (when approved).
2. Browser E2E tests for route authorization 404 behaviour.
3. Buyer-only UX polish (hybrid labelling copy).
4. Activity feed PII review.
5. EA expanded chain visibility (separate PR).

---

*End of PR5 Completion Report.*
