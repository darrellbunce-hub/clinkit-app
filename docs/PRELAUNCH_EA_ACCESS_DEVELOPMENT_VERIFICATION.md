# EA Branch Access — Development Verification Guide

**Workstream:** Pre-Launch Operational Readiness — Workstream 1  
**Status:** Ready for Development migration and testing (not founder-approved complete)  
**Development Supabase:** `bbbsxzxcjkmpqsfvmhbo` only  
**Production:** Do not modify

---

## Step 1 — Migration preflight review (summary)

### Safety assessment

| Check | Assessment |
|-------|------------|
| Current Development schema compatibility | **Safe** if EA team migrations through `20260712210000` are already applied (tables + `remove_ea_branch_member`) |
| Duplicate Owner repair | **Deterministic** — keeps earliest `joined_at`, then `id`; demotes extras to `agent` (no deletes) |
| Missing Owner repair | **Deterministic** — promotes earliest member on populated branches |
| Zero-member branches | **Safe** — repair skips them; deferred invariant only runs when `ea_branch_members` rows change |
| Staff rows deleted? | **No** — repair only UPDATEs roles |
| Pending Owner invitations | **Revoked** (sets `invitation_revoked_at`; idempotent for already-revoked) |
| OC-01 closure | Drops UPDATE policy + `REVOKE UPDATE` from `authenticated` |
| Founder bypass | Removed from `is_ea_branch_team_manager` / `can_access_ea_branch_team` |
| Transfer + deferred trigger | **Compatible** — trigger is `DEFERRABLE INITIALLY DEFERRED`; transfer promotes successor before demoting/removing outgoing Owner; exactly one Owner at commit |
| Idempotency | **Mostly safe to re-run full file** after partial failure (`CREATE OR REPLACE`, `IF NOT EXISTS`, repair UPDATEs no-op when already fixed). Exception: audit events are **not** deduplicated on re-run of RPCs, but re-running the migration SQL itself does not re-insert audit rows. |

### Known edge case (informational)

**Zero-member branches:** The one-Owner invariant is not enforced until a membership row is inserted/updated/deleted. First member on an empty branch must be a founding `branch_admin` or join an branch that already has an Owner before Staff accept. Normal EA onboarding always creates an Owner first.

### Trigger vs transfer (remain_staff / leave_branch)

Within one RPC transaction:

1. Promote Staff → `branch_admin` (briefly two Owners in transaction)
2. Demote outgoing Owner → `agent` **or** DELETE outgoing membership
3. At **COMMIT**, deferred trigger verifies `count(branch_admin) = 1`

---

## Step 2 — Exact migration instructions

### 1. Preflight command

In Supabase Dashboard → **Development project** (`bbbsxzxcjkmpqsfvmhbo`) → **SQL Editor**:

Paste and run the **entire** file:

`scripts/verify-ea-branch-access-migration-preflight.sql`

### 2. Expected preflight result

| Column | Expected before first apply |
|--------|----------------------------|
| `prerequisites_met` | `true` |
| `migration_fully_applied` | `false` |
| `recommended_action` | **`APPLY_MIGRATION`** |
| `branches_with_multiple_owners` | Any number (repair runs during migration) |
| `branches_with_members_but_no_owner` | Any number (repair runs during migration) |
| `expected_duplicate_owner_demotions` | Count of extra Owner rows to demote |
| `expected_missing_owner_promotions` | Count of branches needing Owner promotion |
| `expected_owner_invitation_revocations` | Count of pending Owner invites to revoke |

If `recommended_action` = **`BLOCKED_PREREQUISITES`**, apply earlier EA migrations first.

If **`ALREADY_COMPLETE`**, skip migration; go to post-migration verification.

If **`PARTIAL_APPLY`**, re-run the **full** migration file (see below).

### 3. Exact migration file

`supabase/migrations/20260721100000_ea_branch_access_ownership_continuity.sql`

### 4. How to run

**Yes — paste and run the ENTIRE migration file in one SQL Editor execution.**

Do not split the file. The data repair, trigger creation, and RPC replacements must run in one transaction (Supabase SQL Editor default).

Confirm the SQL Editor is connected to **Development** (`bbbsxzxcjkmpqsfvmhbo`), not Production.

### 5. Expected successful result

SQL Editor shows **Success. No rows returned** (or equivalent success message).

No `ea_branch_owner_invariant_violation` error.

### 6. Post-migration verification query

Run the **entire** file:

`scripts/verify-ea-branch-access-post-migration.sql`

### 7. Expected post-migration result

| Column | Expected |
|--------|----------|
| `migration_complete` | **`true`** |
| `populated_branches_with_zero_owners` | **`0`** |
| `populated_branches_with_multiple_owners` | **`0`** |
| `pending_owner_invites_remaining` | **`0`** |
| `authenticated_update_revoked` | **`true`** |
| `next_step` | Proceed to integration script |

Then run automated integration tests (Step 3 below).

---

## Step 3 — Automated Development integration tests

### Commands

```bash
# Read-only: confirms migration objects exist (after migration applied)
npx tsx scripts/verify-ea-branch-access-dev-integration.ts

# Mutating: creates isolated test users, runs security scenarios, cleans up
npx tsx scripts/verify-ea-branch-access-dev-integration.ts --execute

# Optional: also remove orphaned ea-access-dev fixtures from prior failed runs
npx tsx scripts/verify-ea-branch-access-dev-integration.ts --execute --cleanup-stale
```

### Safeguards

- Loads `.env.local`
- Refuses unless project ref = `bbbsxzxcjkmpqsfvmhbo`
- Refuses if `VERCEL_ENV=production`
- Never prints secrets
- Default mode is read-only
- `--execute` required for mutations
- `--cleanup-stale` removes orphaned `ea-access-dev-*` fixture auth users from prior failed runs only
- Each run uses **unique agency domains**:
  - Primary branch: `ea-access-dev-<run-id>.test`
  - Cross-branch agency: `ea-access-dev-<run-id>-b.test`
- Owner + Staff share the primary domain; outsider uses the secondary domain
- Automatic pre/post cleanup for the current run stamp; never deletes non-test Development data

### Static checks (no migration required)

```bash
npx tsx scripts/verify-ea-branch-team.ts
npx tsx scripts/verify-ea-branch-access-revocation.ts
```

### Coverage matrix

| # | Scenario | Automated `--execute` | Notes |
|---|----------|----------------------|-------|
| 1 | One Owner per branch | Partial | New fixture branch only |
| 2 | Direct UPDATE denied | Yes | Staff JWT + `.update()` |
| 3–7 | Staff escalation blocked | Yes | RPC + UPDATE |
| 8 | Owner removes Staff | Yes | |
| 9–12 | Removed Staff authz | Yes | directory + summaries |
| 13–18 | Transfer remain/leave | Yes | authenticated RPCs |
| 19 | Failed transfer atomicity | Yes | |
| 20–22 | Invitation security | Yes | |
| 23 | Audit events | Yes | `member_removed` |
| 24 | Cross-branch isolation | Yes | two-branch fixture |
| 25 | Multi-branch same user | N/A | MVP one-branch-per-user index |

### Mandatory manual browser tests

| Scenario | Why manual |
|----------|------------|
| Removed Staff opens known `/agent` URL | Stale UI + redirect behaviour |
| Removed Staff opens known `/property/[id]` URL | Layout 404 UX |
| Mobile Team UI layout | Responsive confirmation dialogs |
| Owner demote via browser devtools Supabase client | Optional duplicate of script UPDATE test |

---

## Step 4 — Founder manual UI test sequence (Development)

Use two browsers (or normal + incognito). App: local dev server against Development Supabase.

### A. Log in as Owner

**Action:** `/estate-agents/login` with your EA Owner account.  
**Expected:** Redirect to `/agent` or account; no errors.

### B. View Team

**Action:** `/account#team`  
**Expected:** Team list shows you as **Owner** / **Active**. **Invite Team Member** and **Transfer Ownership** visible.

### C. Invite Staff

**Action:** Invite a test colleague email you control.  
**Expected:** Success message; pending invitation appears as **Staff** / **Pending Invitation**. No Owner role option in invite form.

### D. Accept Staff invitation

**Action:** Open invite link in second browser; sign up or log in as invitee; accept.  
**Expected:** Join succeeds; invitee lands in branch workspace.

### E. Staff cannot manage team

**Action:** Log in as Staff → `/account#team`  
**Expected:** See team members but **no** Invite, Transfer, Remove, or Cancel invitation buttons.

### F. Remove Staff

**Action:** As Owner → **Remove access** on Staff → confirm.  
**Expected:** Staff row disappears from list.

### G. Removed Staff loses branch access

**Action:** As removed Staff, visit `/agent` and refresh.  
**Expected:** Empty command centre or redirect; no branch property data. Account login still works.

### H. Transfer ownership and remain as Staff

**Action:** Re-invite Staff if needed. As Owner → **Transfer Ownership** → select Staff → **Remain in the branch as Staff** → confirm.  
**Expected:** Success; you appear as **Staff**; other user as **Owner** with team controls.

### I. New Owner sees Owner controls

**Action:** Log in as new Owner → `/account#team`  
**Expected:** Invite, Transfer, Remove access available.

### J. Old Owner has Staff permissions

**Action:** Log in as former Owner.  
**Expected:** No team management buttons.

### K. Transfer ownership and leave

**Action:** As Owner, transfer to Staff choosing **leave the branch**.  
**Expected:** You lose branch workspace access; new Owner retains controls.

### L. Cancel pending invitation

**Action:** Invite someone; **Cancel invitation** → confirm.  
**Expected:** Pending row gone or marked inactive.

### M. Revoked invitation unusable

**Action:** Open old invite link after cancel.  
**Expected:** Clear error — invitation no longer active.

---

## Step 5 — Post-migration verification report template

Complete after migration + tests. Save as `docs/PRELAUNCH_EA_ACCESS_DEVELOPMENT_VERIFICATION_REPORT.md`.

| # | Item | Result (fill in) |
|---|------|----------------|
| 1 | Migration result | |
| 2 | Data repair (branches checked / duplicate Owners / missing Owners / zero-member) | |
| 3 | One-Owner invariant verification | |
| 4 | Direct UPDATE denial | |
| 5 | Staff privilege-escalation tests | |
| 6 | Staff removal | |
| 7 | Removed-user active session | |
| 8 | Known URL/data access after removal | |
| 9 | Transfer — remain Staff | |
| 10 | Transfer — leave branch | |
| 11 | Failed-transfer atomicity | |
| 12 | Invitation security | |
| 13 | Audit events | |
| 14 | Cross-branch isolation | |
| 15 | Automated integration (`--execute`) | |
| 16 | Manual browser tests still required | |
| 17 | `npm run build` | |
| 18 | `npx tsc --noEmit` | |
| 19 | `npm run lint` vs 55/22/33 | |
| 20 | Defects discovered | |
| 21 | Another Development migration needed? | |
| 22 | Ready for founder sign-off? | |

---

## Related files

| File | Purpose |
|------|---------|
| `scripts/verify-ea-branch-access-migration-preflight.sql` | Pre-apply read-only check |
| `scripts/verify-ea-branch-access-post-migration.sql` | Post-apply read-only check |
| `scripts/verify-ea-branch-access-dev-integration.ts` | Live JWT integration tests |
| `docs/PRELAUNCH_EA_ACCESS_IMPLEMENTATION_REPORT.md` | Implementation summary |

---

*Do not mark FOUNDER_APPROVED_COMPLETE until this verification report is reviewed.*
