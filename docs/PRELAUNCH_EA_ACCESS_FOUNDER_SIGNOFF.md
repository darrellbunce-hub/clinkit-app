# Pre-Launch Workstream 1 — Founder Sign-Off

**Workstream:** EA Access & Branch Membership  
**Status:** **`FOUNDER_APPROVED_COMPLETE`**  
**Sign-off date:** 22 July 2026  
**Founder decision:** Security and access-control objectives are **founder-approved** based on automated Development verification plus manual Staging verification.

**Production deployment:** **NOT performed** for this workstream.  
**Production security parity review:** **OPEN** — see [Production Readiness Checklist §14](./PRODUCTION_READINESS_CHECKLIST.md).  
**Observability workstream:** **NOT started**.

---

## 1. Sign-off scope

This sign-off covers **EA branch access control and ownership continuity** — not invitation UX polish, timestamp formatting, mobile layout polish, Production migration, or platform observability.

| In scope (approved) | Out of scope (separate Pre-Launch items) |
|---------------------|------------------------------------------|
| One Owner per branch | Existing-account invitation UX (FD-042) |
| Staff cannot escalate privileges | Wrong-email invitation UX (FD-043) |
| Owner team management | Invitation timestamp/timezone (FD-044) |
| Staff removal + access revocation | Mobile/visual UX checks (FD-045) |
| Re-invitation after removal | Production Supabase migration |
| Wrong-email invitation blocking (`email_mismatch`) | Full platform security audit (§14.3 D) |
| Ownership transfer (remain Staff + leave branch) | Observability (§14.3 A) |
| Auth account separate from branch membership | |

---

## 2. Automated Development verification

| Check | Result | Date |
|-------|--------|------|
| Migration `20260721100000_ea_branch_access_ownership_continuity.sql` | Applied to Development | Jul 2026 |
| Migration `20260721110000_ea_branch_owner_invariant_lifecycle_fix.sql` | Applied to Development · post-migration verification **PASS** · **Git-tracked** | Jul 2026 |
| Integration suite `verify-ea-branch-access-dev-integration.ts --execute` | **29/29 PASS** | Jul 2026 |
| Static suite `verify-ea-branch-access-revocation.ts` | **5/5 PASS** | Jul 2026 |

---

## 3. Founder manual verification (Staging)

Environment: **Staging Vercel Preview** (`staging-test` branch) → **Development Supabase** (`bbbsxzxcjkmpqsfvmhbo`).

### 3.1 Team management UI

| # | Test | Result |
|---|------|--------|
| 1 | Team Members management UI visible to branch Owner | **PASS** |

### 3.2 Staff removal

| # | Test | Result |
|---|------|--------|
| 2 | Owner removes Staff via Remove Access confirmation dialog | **PASS** |
| 3 | Removed Staff loses access to previously accessible property URL | **PASS** |
| 4 | Application returns Page not found / no access | **PASS** |
| 5 | Supabase Auth account remains | **PASS** |
| 6 | Removed user can still authenticate | **PASS** |
| 7 | Authentication alone does not restore branch/property access | **PASS** |
| 8 | Dashboard shows no previous branch workspace while unlinked | **PASS** |

### 3.3 Re-invitation

| # | Test | Result |
|---|------|--------|
| 9 | Removed Staff can be invited again | **PASS** |
| 10 | Authenticated as correct invited email → invitation accepted | **PASS** |
| 11 | Branch access restored only after invitation acceptance | **PASS** |
| 12 | Branch membership removal confirmed separate from Auth account deletion | **PASS** |

### 3.4 Wrong-email protection

| # | Test | Result |
|---|------|--------|
| 13 | Accept `privacy@keynetic.co.uk` invitation while authenticated as `support@keynetic.co.uk` blocked with `email_mismatch` | **PASS** |

### 3.5 Ownership transfer

| # | Test | Result |
|---|------|--------|
| 14 | Ownership transferred successfully between two branch members | **PASS** |
| 15 | New Owner gained Owner / team-management controls | **PASS** |
| 16 | Previous Owner (remaining as Staff) lost Owner / team-management controls | **PASS** |
| 17 | Visible permission switch after transfer confirmed manually | **PASS** |
| 18 | Transfer → **leave branch**: outgoing Owner membership removed | **PASS** |
| 19 | Outgoing Owner lost EA dashboard / branch workspace access | **PASS** |
| 20 | Remaining authenticated did not restore access after leave transfer | **PASS** |
| 21 | Successor remained sole Owner with correct Owner permissions | **PASS** |

---

## 4. Security guarantees signed off

The founder approves the following **security/access-control guarantees** for Development and Staging (not Production until parity review):

1. **Exactly one Owner** (`branch_admin`) per populated branch at transaction commit.
2. **Staff cannot promote themselves** or demote an Owner via direct membership UPDATE (OC-01 closed).
3. **Staff cannot manage team membership** (invite, remove, transfer, cancel invitations).
4. **Owner can remove Staff**; removal is immediate on subsequent server-side authorisation checks.
5. **Removed Staff** lose branch, property, and chain access; Auth session persistence does not restore authorisation.
6. **Removed Staff may be re-invited**; access restores only via accepted invitation.
7. **Invitations cannot create Owners**; ownership changes only via transfer RPC.
8. **Wrong-email invitation acceptance blocked** (`email_mismatch`).
9. **Ownership transfer is atomic**; failed transfer leaves existing ownership intact.
10. **Outgoing Owner may remain as Staff or leave the branch**; leave path removes membership and access.
11. **Cross-branch isolation** enforced (Development automated suite).
12. **Audit events** recorded for designed membership mutations (Development automated suite).
13. **Branch/company teardown** compatible with Owner invariant after lifecycle corrective migration.

---

## 5. Open Pre-Launch follow-ups (not blockers)

These items **do not block** EA Access security sign-off. They remain **OPEN** in [Production Readiness Checklist §14.2](./PRODUCTION_READINESS_CHECKLIST.md).

### FD-042 — Existing-account invitation UX

Previously removed Staff retain Supabase Auth accounts by design. Unauthenticated invitation open can present account creation even when Auth account exists. Founder completed re-invitation by signing into existing account, reopening invitation link, and accepting.

**Required follow-up:**

- Assess improved UX for existing Keynetic accounts
- Clear “Already have a Keynetic account? Sign in to accept this invitation” path
- Preserve invitation context through authentication
- Do **not** delete Auth accounts on branch removal
- Do **not** introduce account/email enumeration
- Do **not** weaken one-company-per-domain protection

### FD-043 — Wrong-email invitation UX

`email_mismatch` security behaviour is **correct**.

**Required follow-up:**

- Replace raw `(email_mismatch)` customer-visible diagnostic with plain-English guidance where appropriate
- Provide safe sign-out / switch-account journey
- Preserve invitation context

### FD-044 — Invitation timestamp / timezone investigation

Founder observed ~1 hour discrepancy in July (displayed ~7:49pm vs UK local ~8:49pm).

**Required follow-up:**

- Investigate UTC vs `Europe/London` formatting
- BST/GMT-aware customer-facing timestamps
- Invitation expiry presentation
- EA and homeowner invitation timestamps (shared formatting where applicable)
- Database timestamps remain UTC
- Do **not** hardcode a +1 hour offset

### FD-045 — Remaining visual/mobile UX checks (non-blockers)

| Check | Status |
|-------|--------|
| Mobile Team Members layout | **OPEN** — UX, not access-control |
| Mobile remove/transfer confirmation dialogs | **OPEN** — UX |
| EA marketing navigation anchors (post nav-fix Staging deploy) | **OPEN** — UX |
| Revoked invitation visible-state UX | **OPEN** — UX |

---

## 6. Production status

| Item | Status |
|------|--------|
| EA access migrations on Production Supabase | **NOT applied** |
| EA access code on Production (`main`) | **NOT deployed** (per §11 gates) |
| Production security / RLS parity review | **OPEN** |
| Founder sign-off for Production launch | **Separate gate** — requires §11 + Production pre-flight |

---

## 7. Related documentation

| Document | Purpose |
|----------|---------|
| [Implementation report](./PRELAUNCH_EA_ACCESS_IMPLEMENTATION_REPORT.md) | What was built |
| [Development verification guide](./PRELAUNCH_EA_ACCESS_DEVELOPMENT_VERIFICATION.md) | How it was tested |
| [Audit & design](./PRELAUNCH_EA_ACCESS_AND_BRANCH_MEMBERSHIP_AUDIT.md) | Original gap analysis |
| [Production Readiness Checklist §14](./PRODUCTION_READINESS_CHECKLIST.md) | Programme register |
| [Founder decisions](./LAUNCH_CONTENT_FOUNDER_DECISIONS.md) | FD-042–FD-045 |
| [Auth Architecture — EA branch authorisation](./AUTH_ARCHITECTURE.md) | Auth vs authorisation model |

---

## 8. Recommended next Pre-Launch workstream

**Production observability & incident alerting** (Checklist §14.3 A) — after explicit founder go-ahead to begin implementation. **Not started.**

---

*EA Access & Branch Membership — **FOUNDER_APPROVED_COMPLETE** (22 July 2026). Documentation-only update; no application or Production changes in this sign-off.*
