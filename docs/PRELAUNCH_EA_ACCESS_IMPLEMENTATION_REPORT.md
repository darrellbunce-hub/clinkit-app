# Pre-Launch Workstream 1 — Implementation Completion Report

**Workstream:** EA Branch User Access, Revocation & Ownership Continuity  
**Status:** `IMPLEMENTATION_COMPLETE_AWAITING_DEVELOPMENT_MIGRATION`  
**Date:** 21 July 2026  
**Founder approval to implement:** 21 July 2026  
**Founder sign-off on implementation:** **Pending**

---

## Summary

Implemented founder-approved MVP controls for branch team administration:

- **Exactly one Owner** (`branch_admin`) per branch — deferred DB invariant
- **OC-01 closed** — revoked authenticated `UPDATE` on `ea_branch_members`
- **Atomic ownership transfer** — `transfer_ea_branch_ownership` with remain-as-Staff or leave-branch
- **Staff-only invitations** — Owner invite path blocked in RPC and UI
- **Founder team-management bypass retired** — team authority from active Owner membership only
- **Append-only audit events** — `ea_branch_membership_events`
- **Confirmation UX** — remove access, cancel invitation, transfer ownership

**Production:** Not modified.  
**Development migration:** Required — not applied in this session.

---

## Migration

| File | Purpose |
|------|---------|
| `supabase/migrations/20260721100000_ea_branch_access_ownership_continuity.sql` | Audit table, invariant trigger, RPC hardening, transfer RPC, OC-01 |

---

## Application changes

| Area | Files |
|------|-------|
| Team lib | `lib/estateAgent/branchTeam.ts` |
| Team UI | `components/account/TeamMembersSection.tsx`, `InviteTeamMemberDialog.tsx`, `TransferOwnershipDialog.tsx`, `TeamActionConfirmDialog.tsx` |
| Verification | `scripts/verify-ea-branch-access-revocation.ts`, `scripts/verify-ea-branch-team.ts` |

---

## One-Owner invariant enforcement

1. **Data repair** on migration — demote duplicate Owners; promote earliest member if none
2. **Deferred constraint trigger** `ea_branch_owner_invariant_trigger` — `count(branch_admin) = 1` at transaction commit
3. **Revoked authenticated UPDATE** on `ea_branch_members` + dropped `ea_branch_members_update_admins` policy
4. **All role changes** via security-definer RPCs only (`transfer_ea_branch_ownership`, founding insert policy unchanged)
5. **Advisory lock** on branch during ownership transfer

---

## Verification (local — no Development DB migration applied)

| Check | Result |
|-------|--------|
| `npx tsx scripts/verify-ea-branch-team.ts` | **PASS** (4/4) |
| `npx tsx scripts/verify-ea-branch-access-revocation.ts` | **PASS** (4/4) |
| `npm run build` | **PASS** |
| `npx tsc --noEmit` | **PASS** |
| `npm run lint` | **55 total / 22 errors / 33 warnings** — matches Stage 6 baseline |

Direct RLS/RPC integration tests requiring Development Supabase — **pending migration apply**.

---

## Development migration steps

See **[Development Verification Guide](./PRELAUNCH_EA_ACCESS_DEVELOPMENT_VERIFICATION.md)** for:

1. Preflight SQL (`scripts/verify-ea-branch-access-migration-preflight.sql`)
2. Exact SQL Editor migration instructions
3. Post-migration SQL (`scripts/verify-ea-branch-access-post-migration.sql`)
4. Integration script (`npx tsx scripts/verify-ea-branch-access-dev-integration.ts --execute`)
5. Founder manual UI test sequence
6. Post-verification report template

Summary:

1. Review migration SQL in repo.
2. Run preflight SQL on Development (`bbbsxzxcjkmpqsfvmhbo`).
3. Apply **entire** `20260721100000_ea_branch_access_ownership_continuity.sql` in one SQL Editor execution.
4. Run post-migration SQL + integration script with `--execute`.
5. Complete manual browser tests and verification report.

---

## Remaining risks / legal review

- Audit event retention period
- Support runbook for inaccessible sole Owner ([EA_BRANCH_OWNER_SUPPORT_RUNBOOK.md](./EA_BRANCH_OWNER_SUPPORT_RUNBOOK.md))
- No removal notification email (deferred by founder)

---

## Related documentation

- [Audit & design](./PRELAUNCH_EA_ACCESS_AND_BRANCH_MEMBERSHIP_AUDIT.md)
- [Auth Architecture](./AUTH_ARCHITECTURE.md)
- [Production Readiness Checklist §14](./PRODUCTION_READINESS_CHECKLIST.md)

---

*Awaiting founder review after Development migration and testing.*
