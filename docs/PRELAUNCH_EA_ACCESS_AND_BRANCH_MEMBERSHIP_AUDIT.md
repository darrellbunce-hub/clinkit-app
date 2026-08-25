# Pre-Launch EA Branch User Access, Revocation & Ownership Continuity

**Programme:** Pre-Launch Operational Readiness — Workstream 1  
**Status:** **`FOUNDER_APPROVED_COMPLETE`** (22 Jul 2026)  
**Phase:** Audit, design, and implementation (Development migration pending)  
**Status:** `IMPLEMENTATION_COMPLETE_AWAITING_DEVELOPMENT_MIGRATION` — see [implementation report](./PRELAUNCH_EA_ACCESS_IMPLEMENTATION_REPORT.md)  
**Audit date:** 21 July 2026  
**Implementation date:** 21 July 2026  
**Scope:** Estate agent branch membership, user removal, ownership continuity, authorisation/RLS, invitations, audit, GDPR alignment  
**Production changes:** **None**

---

## P0 security alert

**No current P0 vulnerability was identified for the primary founder concern** — a **Staff (`agent`) member removed via `remove_ea_branch_member` does not retain durable branch or property access through known URLs, RPCs, or Supabase queries with a valid JWT. Authorisation is enforced server-side via live `ea_branch_members` joins in RLS helpers and security-definer RPCs.

**However, one P1 ownership-continuity defect is urgent pre-launch:**

| ID | Severity | Finding |
|----|----------|---------|
| **OC-01** | **P1** | A `branch_admin` may **demote another `branch_admin` to `agent` (or demote themselves) via direct `UPDATE` on `ea_branch_members`**, bypassing `remove_ea_branch_member` owner protections. There is **no database invariant** requiring at least one active `branch_admin` per branch. A branch can become **admin-less** while the company founder retains legacy `is_ea_branch_founder` team-management powers without membership. |

This is not cross-branch IDOR and does not grant removed staff access, but it **violates founder owner-continuity expectations** and must be addressed before launch sign-off.

---

## Executive summary

Keynetic already has a **branch-scoped membership model** with partial team management. Branches **can invite Staff and revoke pending invitations; Owners (`branch_admin`) can hard-delete Staff (`agent`) memberships** via RPC, with immediate loss of branch/property authorisation. **Global Supabase Auth accounts are not deleted** on branch removal, and **existing sessions remain authenticated** but **lose branch authorisation on the next data fetch/mutation** — the preferred auth/authz separation model is largely already in place.

**Critical gaps vs founder pre-launch requirements:**

| Gap | Current state | Pre-launch need |
|-----|---------------|-----------------|
| Owner removal / departure | Blocked (`cannot_remove_owner`, `cannot_remove_self`) | Safe ownership transfer then removal |
| Ownership transfer | **Not implemented** | Explicit atomic workflow |
| Owner continuity invariant | **Not enforced** (OC-01) | Never admin-less branch |
| Staff removal | **Implemented** (RPC + UI) | Confirm UX, audit, tests |
| Delegate terminology | **Property-level** (`homeowner_only_updates`), not branch role | Do not conflate with Staff |
| Membership audit events | **None** for team actions | Security/support trail |
| Resend invitation | **Not implemented** | Optional MVP |
| Role promote/demote UI | **Not implemented** (RLS UPDATE exists, unguarded) | Transfer-only for MVP |
| Invite as Owner | UI allows; creates co-`branch_admin` | Founder decision: co-owner vs transfer-only |

**Recommendation:** Proceed to **staged implementation** after founder approval of the MVP permission model, ownership-transfer workflow, and OC-01 remediation. Do **not** treat external employer email disable as access control; enforce branch membership in database (already true for data paths; strengthen owner invariants).

---

## Part 1 — Current EA identity & membership model

### Layered architecture (actual)

```
Supabase Auth User (auth.users)
  └── profiles (account_type = 'estate_agent', contact_name, email_domain, onboarding_completed_at)
        └── ea_companies (created_by_user_id = company "founder", business identity)
              └── ea_branches (operational + future billing unit per FD-031/FD-036)
                    └── ea_branch_members (branch_id, user_id, role)  ← authoritative branch access
                          └── property_ea_assignments (branch ↔ property, status, delegation flags)
                                └── EA operational views / mutations (via is_ea_assigned_to_* helpers)
```

**Parallel paths (not membership):**

- `ea_branch_invitations` — pre-membership invite tokens (pending → accepted/revoked/expired)
- `property_ea_assignments.homeowner_only_updates` — **property delegation** (view vs edit), **not** a branch role named Delegate
- `platform_admins` — Keynetic internal operators only; separate from EA roles
- `profiles.role` — legacy; **not** used for EA routing or authorisation

### Tables involved

| Table | Purpose |
|-------|---------|
| `auth.users` | Authentication identity (email/password, sessions) |
| `profiles` | Account type, display fields, onboarding |
| `ea_companies` | Agency/company record |
| `ea_branches` | Branch record (subscription target per FD-031) |
| `ea_branch_members` | **Authoritative branch membership + branch role** |
| `ea_branch_invitations` | Pending branch team invitations |
| `property_ea_assignments` | Branch assignment to properties |
| `platform_admins` | Internal platform admin allowlist |

**Primary migrations:** `20260610150000_phase1_ea_foundation_schema.sql`, `20260712200000_ea_branch_team_invitations.sql`, `20260712210000_ea_branch_members_backfill_and_team_fix.sql`

### Role fields / enums (by layer)

| Layer | Values | UI label |
|-------|--------|----------|
| `profiles.account_type` | `homeowner`, `estate_agent`, `solicitor` | — |
| `ea_branch_members.role` | `branch_admin`, `agent` | **Owner**, **Staff** |
| `ea_branch_invitations.invite_role` | `branch_admin`, `agent` | Owner, Staff |
| `property_ea_assignments.homeowner_only_updates` | boolean | Delegation (view-only vs delegated editor) |
| `platform_admins` | allowlist row | Internal only |

**There is no DB enum value `delegate`, `member`, or `admin` at branch level.** Founder "Delegate" maps to **Staff (`agent`)** at branch level and/or **delegated editor** at property level.

### Role semantics (do not conflate)

| Concept | Layer | Meaning |
|---------|-------|---------|
| **Owner** | Branch membership (`branch_admin`) | Branch user administration, company/branch settings (RLS), team invite/revoke/remove Staff |
| **Staff** | Branch membership (`agent`) | Branch member; property access via branch assignment + membership join |
| **Delegate (operational)** | Property assignment | `homeowner_only_updates = false` → `is_ea_delegated_editor_on_*` |
| **Company founder** | `ea_companies.created_by_user_id` | Legacy team-manager bypass (`is_ea_branch_founder`); not a membership role |
| **Platform admin** | `platform_admins` | GDPR/privacy admin; unrelated to EA branch RBAC |

### MVP constraint: one branch per user

Unique index `ea_branch_members_one_branch_per_user_idx` on `ea_branch_members(user_id)` enforces **one branch membership per user** today. Multi-branch future requires removing this constraint (see Part 13).

---

## Part 2 — Current branch user management

### UI surfaces

| Capability | Location | Who |
|------------|----------|-----|
| Team list | `/account#team` — `TeamMembersSection.tsx` | Branch members (pending invites: managers only) |
| Invite | `InviteTeamMemberDialog.tsx` | `canManageTeam` |
| Revoke invitation | Team list | Managers |
| Remove member | Team list — **Staff only** | Managers |

**Not in EA Command Centre** — team management lives under Account settings.

### Backend RPCs (`lib/estateAgent/branchTeam.ts`)

| RPC | Purpose | Authority |
|-----|---------|-----------|
| `create_ea_branch_invitation` | Invite by email | `is_ea_branch_team_manager` |
| `accept_ea_branch_invitation` | Join branch | Invitee (email match, EA account) |
| `revoke_ea_branch_invitation` | Cancel pending invite | `is_ea_branch_team_manager` |
| `remove_ea_branch_member` | Hard-delete membership | `is_ea_branch_team_manager`; Staff only |
| `get_ea_branch_team_directory` | List members + pending | `can_access_ea_branch_team` |

**Authority helpers:**

- `is_ea_branch_admin(branch_id)` — active `branch_admin` membership
- `is_ea_branch_team_manager(branch_id)` — `branch_admin` **OR** company founder (`is_ea_branch_founder`)
- `can_access_ea_branch_team(branch_id)` — member **OR** founder

### What is currently possible

| Action | Supported? | Notes |
|--------|------------|-------|
| Invite Staff | ✅ | |
| Invite Owner (co-admin) | ✅ UI + RPC | No transfer workflow; creates additional `branch_admin` |
| Accept invitation | ✅ | Revoked/expired/mismatch blocked |
| List members | ✅ | |
| List pending invitations | ✅ | Managers only |
| Revoke pending invitation | ✅ | Sets `invitation_revoked_at` |
| Remove Staff | ✅ | Hard `DELETE` on `ea_branch_members` |
| Remove Owner | ❌ | `cannot_remove_owner` |
| Remove self | ❌ | `cannot_remove_self` |
| Transfer ownership | ❌ | No RPC |
| Promote/demote role (UI) | ❌ | Direct RLS `UPDATE` possible (unguarded) |
| Resend invitation | ❌ | Create blocked if active pending (`invitation_already_active`) |
| Deactivate (soft) | ❌ | Hard delete only |
| Delete global EA auth account | ❌ | Separate GDPR erasure programme |
| Leave branch voluntarily | ❌ | Blocked for all roles via remove RPC |

### Founder observation: "Can invite but not remove?"

**Partially outdated.** Branches **can remove Staff** today with server-side revocation. They **cannot remove Owners**, **cannot remove themselves**, and **cannot transfer ownership** — which matches the founder's underlying concern for departing employees who are Owners, and for owner continuity.

---

## Part 3 — Authorisation & RLS audit

### Primary enforcement model

Branch access is enforced **database-side**:

1. **`ea_branch_members` existence** — `is_ea_branch_member`, joins in assignment helpers
2. **Property access** — `is_ea_assigned_to_property` = active assignment **AND** user in `ea_branch_members` for that branch
3. **Delegated mutations** — `is_ea_delegated_editor_on_*` adds `homeowner_only_updates = false` + membership join
4. **Summaries** — `agent_branch_property_summaries` filters `exists (ea_branch_members where user_id = auth.uid())`
5. **Route guards** — `requirePropertyParticipantForRoute` / chain equivalents call RLS-backed RPCs/views → `notFound()` on denial

**Middleware** (`middleware.ts`) enforces account type and email verification on gated routes; **does not** check branch membership (acceptable — data layer enforces).

### Path-by-path summary

| Path | Authorisation mechanism |
|------|-------------------------|
| EA Command Centre (`/agent`) | `agent_branch_property_summaries` + membership join |
| Branch properties | `is_ea_assigned_to_property` |
| Chain summaries / intelligence | Chain helpers join assignments + membership |
| Property / chain workspace pages | Layout guards + participant views |
| Team directory RPC | `can_access_ea_branch_team` |
| Team mutations | Security-definer RPCs + manager checks |
| Homeowner invitation controls | `is_ea_assigned_to_property` / delegated editor |
| `ea_companies` / `ea_branches` SELECT | `is_ea_company_member` / `is_ea_branch_member` |
| Direct table access (authenticated) | RLS on all EA tables; no anon grants |
| Service-role paths | Bypass RLS; app server only |

### Removed-user scenarios (A–G)

| Scenario | After Staff removal via RPC | Reason |
|----------|----------------------------|--------|
| **A.** Known branch/property URL | **Denied** (404 / empty) | Layout + `is_ea_assigned_to_property` fail without membership |
| **B.** Known chain ID | **Denied** | `is_ea_assigned_to_chain` requires membership join |
| **C.** Direct RPC | **Denied** | RPCs use same helpers |
| **D.** Supabase query + JWT | **Denied** | RLS + views filter on membership |
| **E.** Browser session persists | **Auth yes; branch authz no** | Session ≠ membership |
| **F.** Refresh token | Same as E | Tokens do not embed branch roles |
| **G.** Prior property assignment | **Denied** | Assignment row may remain `active` but helpers require membership join |

**Stale client state:** User already on a property page may see cached UI until refresh/navigation; **mutations and refetch fail**. Low severity; address with client redirect on 404/RPC error in implementation phase.

**Revoked assignment rows:** Summaries view includes `pea.status in ('active', 'revoked')` for members — removed users no longer qualify.

### Identified authorisation gaps

| ID | Severity | Gap |
|----|----------|-----|
| OC-01 | P1 | Unguarded role `UPDATE` can eliminate all `branch_admin` rows |
| OC-02 | P1 | No ownership transfer; Owner cannot safely depart |
| OC-03 | P2 | `is_ea_branch_founder` grants team management without membership — inconsistent with data access |
| OC-04 | P2 | `validate_ea_branch_invitation_for_email_send` uses `is_ea_branch_admin` only, not `is_ea_branch_team_manager` — founder edge case |
| OC-05 | P2 | View shows `revoked` assignments in command centre for **active** members (intentional history; not a removed-user leak) |

---

## Part 4 — Session & token behaviour

| Question | Finding |
|----------|---------|
| Is user signed out on branch removal? | **No** — by design |
| Is global auth account deleted? | **No** |
| Are refresh tokens revoked? | **No** |
| Is branch access revoked immediately at DB? | **Yes** — membership row deleted |
| Can JWT bypass membership checks? | **No** — helpers query live `ea_branch_members` |
| Multi-branch future | Auth session can span branches; authorisation must remain per-branch |

**Recommended model (already largely implemented):** Authentication persists; **authorisation is live membership**. No Supabase global sign-out required for branch removal. Optional future: force client refresh/sign-out for UX clarity only.

---

## Part 5 — Permission matrix

### Current effective matrix

| Capability | Owner (`branch_admin`) | Staff (`agent`) | Company founder (no membership) |
|------------|------------------------|-----------------|--------------------------------|
| View branch workspace | ✅ | ✅ | ❌ (no property data) |
| View team directory | ✅ | ✅ | ✅ |
| Invite users | ✅ | ❌ | ✅ (legacy) |
| Revoke invitations | ✅ | ❌ | ✅ |
| Remove Staff | ✅ | ❌ | ✅ |
| Remove Owner | ❌ | ❌ | ❌ |
| Transfer ownership | ❌ | ❌ | ❌ |
| Promote/demote via UI | ❌ | ❌ | ❌ |
| Promote/demote via direct DB UPDATE | ✅ (unguarded) | ❌ | ❌ |
| Manage company/branch settings | ✅ (RLS) | ❌ | Partial (founder company update RLS) |
| Billing (future) | Not implemented | — | — |

### Recommended MVP matrix (for founder approval)

| Capability | Owner | Staff |
|------------|-------|-------|
| View branch / assigned properties | ✅ | ✅ |
| Manage properties / operational workflows | ✅ | ✅ (per assignment/delegation rules) |
| Invite Staff | ✅ | ❌ |
| Remove Staff | ✅ | ❌ |
| Remove Owner | ❌ | ❌ |
| Promote Staff → Owner | ✅ **via transfer RPC only** | ❌ |
| Transfer ownership | ✅ (explicit workflow) | ❌ |
| Remove self | Owner only **after** transfer | ❌ (or optional "request removal" — defer) |
| Revoke/resend invitations | ✅ | ❌ |
| Manage branch settings | ✅ | ❌ |
| Future billing authority | ✅ (when Stripe workstream lands) | ❌ |

**Recommendation:** **Owner-only** Staff removal and invitation management for MVP. Staff must not remove Owner or promote themselves. **Disallow inviting new Owner** until transfer RPC exists; use **transfer** instead of co-owner invites.

---

## Part 6 — User removal semantics

### Options assessed

| Model | Pros | Cons |
|-------|------|------|
| **A. Hard delete membership** | Simple; immediate RLS denial; current implementation | Loses membership history; re-invite creates new row |
| **B. Soft delete (`revoked_at`)** | Audit-friendly; reversible | All helpers must filter `active`; higher regression risk |
| **C. Status enum** | Clear lifecycle | More schema + query complexity |
| **D. Separate audit table** | Best investigation trail | Extra write on mutation |

### Recommendation

**Hybrid MVP:**

1. **`ea_branch_members`:** add `status` (`active` | `revoked`) and `revoked_at`, `revoked_by_user_id` — **or** retain hard delete for access row but **require append-only audit event** (simpler MVP).
2. **Simplest robust MVP:** Keep hard delete for access enforcement **plus** new `ea_branch_membership_events` append-only table (Part 11). Access checks use **existence of active membership row only** (current behaviour).
3. **Do not** delete `auth.users` on branch removal.
4. **Historical activity attribution:** retain `assigned_by_user_id`, activity actor IDs, audit tables — already aligned with GDPR architecture.

Distinction: **branch access removal ≠ GDPR erasure ≠ account deletion.**

---

## Part 7 — Owner transfer workflow (design)

### Required workflows

| # | Scenario | Design |
|---|----------|--------|
| 1 | Voluntary transfer | Owner selects successor (active Staff) → confirm → atomic RPC |
| 2 | Owner removes self | **Blocked** until transfer completes |
| 3 | Staff attempts remove Owner | **Blocked** (RPC + UI) |
| 4 | Owner only member | Transfer target must be invited first **or** block with clear error |
| 5 | Owner account inaccessible | **Post-MVP:** platform support runbook; not self-service |
| 6 | Promote Staff to Owner | Same RPC as transfer (promotion + demotion optional) |
| 7 | Transfer fails midway | Single transaction — no partial state |
| 8 | Concurrent transfers | Row lock on branch or serialise via RPC |

### Recommended RPC: `transfer_ea_branch_ownership(p_branch_id, p_new_owner_member_id)`

**Single transaction:**

1. Verify caller is sole/active `branch_admin` (or founder rule — **decide:** retire founder bypass).
2. Verify target is active `agent` member of same branch.
3. `UPDATE` target → `branch_admin`.
4. Optional: `UPDATE` caller → `agent` (if stepping down) **or** leave as co-admin — **founder decision** (recommend demote caller to Staff when stepping down).
5. Insert audit event.
6. Return success.

**Invariants:**

- `count(branch_admin where status=active) >= 1` at all times
- `remove_ea_branch_member` on a `branch_admin` **only** if another active `branch_admin` exists **or** combined with transfer in same transaction
- Never allow `remove_ea_branch_member` + transfer as separate user steps without validation

**Remove direct authenticated `UPDATE` on `ea_branch_members.role`** — route all role changes through RPCs.

---

## Part 8 — Removed user with active assignments

### Current behaviour

- `property_ea_assignments` are **branch-scoped**, not user-scoped.
- Removal deletes **user ↔ branch** link, not the assignment.
- **Access ceases** because `is_ea_assigned_to_property` inner-joins `ea_branch_members`.

### Recommendation (MVP)

| Concern | Treatment |
|---------|-----------|
| Active property access | Automatic loss via membership join — **no reassignment required for security** |
| Historical attribution | Retain `assigned_by_user_id`, activities, delink audit |
| Active operational responsibility | **No per-user assignment row today** — branch owns assignment |
| Homeowner invitations in flight | Continue under branch authority; removed user cannot act |
| Re-invite same person | New invitation → new membership row |

**Do not** auto-reassign branch properties to Owner on Staff removal — unnecessary for current schema.

---

## Part 9 — Invited but not joined users

### Current support

| Capability | Status |
|------------|--------|
| View pending | ✅ Managers |
| Revoke | ✅ `revoke_ea_branch_invitation` |
| Expiry shown | ✅ |
| Resend | ❌ Must revoke and recreate (or add resend RPC) |
| Accept after revoke | ❌ Blocked (`invitation_revoked`) |
| Accept twice | ❌ Blocked (`invitation_already_accepted`) |

**Revoked invitation tokens:** hash stored; acceptance checks `invitation_revoked_at` — **not reusable**.

### Design additions

- Optional **`resend_ea_branch_invitation`** (rotate token, extend expiry, audit event)
- Show **Revoked** status in directory for managers (currently hidden — only pending/expired queried)

---

## Part 10 — UI/UX design (minimum)

### Location

Keep **`/account#team`** for MVP (existing). Optional later: Command Centre → Branch settings link.

### Team list columns

| Column | Content |
|--------|---------|
| Name | `contact_name` or email local-part |
| Email | Auth email |
| Role | Owner / Staff |
| Status | Active · Pending invitation · Expired · Revoked (post-design) |
| Actions | Contextual |

### Actions by row type

| Row | Manager actions |
|-----|-----------------|
| Active Staff | **Remove access** |
| Active Owner | **Transfer ownership** (not Remove) |
| Pending invite | **Revoke** · **Resend** (if implemented) |
| Self (Owner) | **Transfer ownership** — not Remove |

### Confirmation copy (draft for founder review)

**Remove Staff:**

> Remove access for **[name]**?  
> They will no longer be able to access this branch or its properties in Keynetic. Their previous activity may remain in branch history.

**Transfer ownership:**

> Transfer branch ownership to **[name]**?  
> You will become a Staff member and they will be able to manage team access.

**Revoke invitation:**

> Cancel invitation for **[email]**?  
> They will not be able to join using the current link.

Implement **confirm dialogs** — currently Remove/Revoke fire immediately (gap).

---

## Part 11 — Audit logging

### Current state

**No dedicated EA branch membership audit table.** Related: `property_delink_events`, `chain_completion_events`, `gdpr_erasure_audit_events` (different scope).

### Recommended: `ea_branch_membership_events`

Append-only; RLS deny for authenticated; service role / security-definer insert only.

| Field | Notes |
|-------|-------|
| `event_type` | `invited`, `invitation_revoked`, `invitation_accepted`, `member_removed`, `ownership_transferred`, `role_changed`, `member_reinvited` |
| `branch_id` | Required |
| `actor_user_id` | Nullable for system |
| `subject_user_id` | Nullable (invite email hash/id for pre-accept) |
| `previous_role` / `new_role` | Optional |
| `metadata` | `{ invitation_id }` — avoid duplicating email |
| `created_at` | Timestamp |

Emit from team RPCs only — not client inserts.

---

## Part 12 — Privacy / GDPR implications

Per existing approved documentation (`GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md`, `GDPR_DATA_INVENTORY.md`, `GDPR_PHASE3B_PRIVACY_ADMIN.md`):

| Topic | Guidance |
|-------|----------|
| Branch removal vs erasure | **Distinct** — removing branch access is operational access control, not GDPR erasure |
| Retention after removal | Membership row may be deleted or pseudonymised; **operational history retains actor IDs** where lawful |
| Re-invite | Lawful if business relationship resumes |
| Personal data in team directory | Email displayed to branch managers — existing pattern |
| Controller/processor | Items awaiting legal review remain **OPEN** (checklist §14.2 #1) |

**Flag for legal review (no new legal conclusions):**

- Retention period for `ea_branch_membership_events`
- Whether revoked membership rows must be erasure-scoped on individual GDPR requests
- Co-owner / transfer wording in customer-facing terms

---

## Part 13 — Multi-branch future compatibility

| Current blocker | Future change |
|-----------------|---------------|
| `ea_branch_members_one_branch_per_user_idx` | Drop/replace with `(user_id, branch_id)` unique |
| `user_has_ea_branch_membership()` in accept RPC | Scope to target branch only |
| `loadAgentHomeContext` single membership | Branch switcher UI |
| Removal | Must scope to `branch_id` only — **design already branch-scoped** |
| Billing per branch (FD-031) | Compatible |

**Recommendation:** Keep all new RPCs **`p_branch_id`-scoped**. Do not store global EA role in `profiles`.

---

## Part 14 — Security threat review

| Threat | Rank | Mitigation status |
|--------|------|-------------------|
| Removed Staff retains access | — | **Mitigated** (live membership joins) |
| Staff escalates to Owner | P1 | Partial — RPC blocks; **RLS UPDATE open** |
| Staff removes Owner | — | **Mitigated** (`cannot_remove_owner`) |
| Ownerless branch | P1 | **Not mitigated** (OC-01) |
| Revoked invitation reused | — | **Mitigated** |
| Double accept | — | **Mitigated** |
| Stale browser session | P2 | UX refresh recommended |
| Direct Supabase IDOR (cross-branch) | — | **Not found** in audit |
| API route missing check | P2 | Layout guards present; verify in regression tests |
| Service-role misuse | P2 | Existing pattern — no change |
| Ownership transfer race | P1 | Needs atomic RPC |
| Cross-branch access | — | **Mitigated** (one branch/user + RLS) |
| Pre-removal export/cache | — | **Cannot prevent** — out of scope |

---

## Part 15 — Query & cost governance

| Check | Impact |
|-------|--------|
| Membership enforcement | Existing helpers already query `ea_branch_members` — **no new repeated scan** if reused |
| Soft status filter | Would add `and status = 'active'` to helpers — negligible |
| Audit events | One INSERT per mutation — acceptable |
| Team directory | Single RPC per page load — unchanged |
| Command centre | Summary view unchanged |

**Security correctness over micro-optimisation** — do not cache membership in JWT claims without invalidation strategy.

---

## Part 16 — Staged implementation plan (post-approval)

| Phase | Deliverables |
|-------|--------------|
| **1. Foundations** | `ea_branch_membership_events`; helper `is_active_ea_branch_member`; invariant trigger or constraint for ≥1 `branch_admin` |
| **2. Secure revocation** | Harden `remove_ea_branch_member`; revoke direct role UPDATE; confirmation UX |
| **3. Ownership transfer** | `transfer_ea_branch_ownership` RPC; block co-owner invite or align with policy |
| **4. Team UI** | Transfer dialog; remove instant-click; status labels; mobile pass |
| **5. Invitations** | Resend RPC (optional); show revoked; fix email-send founder check |
| **6. Audit events** | Wire all team RPCs |
| **7. Testing** | Part 17 tests + `verify-ea-branch-team` expansion |
| **8. Docs / checklist** | Mark workstream **IMPLEMENTED** after founder verification |

**Migrations:** new audit table, ownership RPC, policy drops on direct UPDATE, optional membership columns  
**RLS:** tighten `ea_branch_members` UPDATE; filter active status if soft-delete adopted  
**API:** optional route handler wrappers — prefer RPC-only  
**Backfill:** ensure every branch has ≥1 `branch_admin`; founder/backfill migration already run  
**Production:** deploy migrations before UI; run invariant audit script pre-deploy

---

## Part 17 — Mandatory test plan

| # | Test | Type |
|---|------|------|
| 1 | Owner removes Staff | RPC + UI |
| 2 | Removed Staff loses access immediately | RLS / RPC |
| 3 | Removed Staff hits known branch URL | Route 404 |
| 4 | Removed Staff hits known property URL | Route 404 |
| 5 | Removed Staff calls `is_ea_assigned_to_property` | RPC false |
| 6 | Removed Staff logged in; command centre empty | Integration |
| 7 | Staff cannot remove Owner | RPC error |
| 8 | Staff cannot promote self | RPC/RLS denial |
| 9 | Owner transfers ownership | RPC atomic |
| 10 | Old Owner removable after transfer | RPC |
| 11 | Last Owner cannot leave branch ownerless | RPC/trigger |
| 12 | Pending invitation revoked | RPC |
| 13 | Revoked token cannot accept | RPC |
| 14 | Re-invite previously removed user | End-to-end |
| 15 | Historical activity still attributed | Data check |
| 16 | Cross-branch isolation | RLS (future: multi-branch) |
| 17 | Concurrent ownership transfer | DB concurrency |
| 18 | Mobile team management UX | Manual / E2E |

Add **`scripts/verify-ea-branch-access-revocation.ts`** for automated RLS/RPC checks in Development.

---

## Part 18 — Founder decisions required

| # | Decision |
|---|----------|
| FD-OC-01 | **Owner-only** vs **co-owner** model — disallow invite-as-Owner until transfer exists? |
| FD-OC-02 | After transfer, does outgoing Owner become **Staff** or leave branch entirely? |
| FD-OC-03 | Retire **`is_ea_branch_founder`** team-manager bypass after backfill stable? |
| FD-OC-04 | Hard delete vs soft **`revoked`** membership rows |
| FD-OC-05 | Resend invitation in MVP or revoke+recreate only |
| FD-OC-06 | Require confirm dialogs + email notify on removal (optional) |
| FD-OC-07 | Platform support path for inaccessible Owner (post-MVP acceptable?) |

---

## Return index (30 items)

1. **Executive summary** — see top  
2. **Current architecture** — Part 1  
3. **Owner/Delegate semantics** — Part 1 table  
4. **Current user-management capabilities** — Part 2  
5. **Can users be removed?** — **Staff yes; Owner/self no**  
6. **Authorisation/RLS model** — Part 3  
7. **Security gaps** — OC-01–OC-05  
8. **Employee leaves today** — Staff: manager removes → access gone; Owner: blocked without transfer  
9. **Session after removal** — Stays authenticated; branch access denied live  
10. **Recommended MVP membership** — Part 6 + active row + audit events  
11. **Recommended Owner permissions** — Part 5 MVP matrix  
12. **Recommended Staff permissions** — Part 5 MVP matrix  
13. **Removal semantics** — Part 6  
14. **Ownership transfer** — Part 7  
15. **Active assignments** — Part 8  
16. **Pending invitations** — Part 9  
17. **Audit logging** — Part 11  
18. **GDPR** — Part 12  
19. **Multi-branch** — Part 13  
20. **Threat model** — Part 14  
21. **Query/cost** — Part 15  
22. **Schema/migrations** — Part 16  
23. **RLS/RPC/API** — Parts 3, 7, 16  
24. **UI changes** — Part 10  
25. **Implementation plan** — Part 16  
26. **Test plan** — Part 17  
27. **Founder decisions** — Part 18  
28. **Files updated** — this doc; `PRODUCTION_READINESS_CHECKLIST.md`; cross-ref in `AUTH_ARCHITECTURE.md`  
29. **No implementation** — confirmed  
30. **Proceed?** — **Yes, after founder approval** of MVP matrix, OC-01 remediation, and ownership transfer design  

---

## Related documentation

- [Production Readiness Checklist §14](./PRODUCTION_READINESS_CHECKLIST.md)
- [Auth Architecture](./AUTH_ARCHITECTURE.md)
- [GDPR Right to Erasure Architecture](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md)
- [Participation De-link](./PARTICIPATION_DELINK.md)
- [Launch Content Founder Decisions](./LAUNCH_CONTENT_FOUNDER_DECISIONS.md) — FD-031, FD-036, FD-037

---

*End of audit — Workstream 1 **`FOUNDER_APPROVED_COMPLETE`** (22 Jul 2026) — [sign-off record](./PRELAUNCH_EA_ACCESS_FOUNDER_SIGNOFF.md).*
