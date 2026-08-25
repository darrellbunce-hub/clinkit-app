# EA Branch Access — Inaccessible Sole Owner (Support Runbook)

**Workstream status:** **`FOUNDER_APPROVED_COMPLETE`** (22 Jul 2026)  
**Runbook status:** Draft operational procedure — requires security/legal review before Production use  
**Related:** [Pre-Launch EA Access Audit](./PRELAUNCH_EA_ACCESS_AND_BRANCH_MEMBERSHIP_AUDIT.md) · [Founder sign-off](./PRELAUNCH_EA_ACCESS_FOUNDER_SIGNOFF.md)

---

## Purpose

Document the **exception path** when a branch's sole Owner cannot perform ownership transfer because they:

- left the organisation unexpectedly;
- lost access to their Keynetic account or email;
- are otherwise unavailable.

This is **not** a self-service product feature in MVP.

---

## Principles

1. **Never** leave a branch ownerless through an unsafe shortcut.
2. **Never** reassign ownership without appropriate identity and authority verification.
3. **Prefer** normal product flow: existing Owner invites Staff → transfers ownership → optionally leaves.
4. Platform-admin intervention is **last resort** only.
5. All actions must be **audited** (`ea_branch_membership_events` + internal support record).

---

## Preconditions (verify before action)

| Check | Requirement |
|-------|-------------|
| Requestor identity | Verified representative of the estate agency branch/company (not merely a former employee) |
| Business authority | Written confirmation from agency leadership or equivalent per Keynetic support policy |
| Branch identification | Confirmed `ea_branches.id`, company name, and affected Owner user ID |
| Product path exhausted | No active Owner can sign in to complete `transfer_ea_branch_ownership` |
| Successor identified | Named active Staff member **already in** `ea_branch_members` with role `agent`, **or** verified successor must accept a new Staff invitation first |

If no Staff member exists, **first** issue a Staff invitation to the verified successor and wait for acceptance before transfer.

---

## Prohibited actions

- Promoting a user to Owner via direct SQL `UPDATE` outside a controlled migration/RPC
- Using `service_role` to bypass audit logging
- Granting `platform_admins` to agency staff
- Deleting the branch or company without GDPR/legal review

---

## Approved technical path (Development / Production support)

Use **`transfer_ea_branch_ownership`** via service-role or SQL Editor **only** when executed as the protected RPC (not ad-hoc row updates):

1. Confirm successor `ea_branch_members.id` (role `agent`) for the branch.
2. Authenticate/support-impersonate is **out of scope for MVP** — execute as controlled backend operation with documented ticket ID.
3. Call RPC as the current Owner user session **if** recovery session is possible; otherwise escalate to platform engineering for a **one-off service procedure** that:
   - validates ticket + verification evidence;
   - invokes the same atomic RPC semantics (promote successor, demote/remove prior Owner);
   - writes `ea_branch_membership_events` with `metadata.support_ticket_id`.

**Do not implement ad-hoc SQL in this workstream.** Engineering must wrap any break-glass path in a dedicated audited RPC in a future gated change if required.

---

## Post-action

1. Confirm exactly one `branch_admin` on the branch.
2. Confirm prior Owner no longer has branch authorisation (if they left).
3. Notify verified agency contact through approved support channel.
4. Record closure in support ticket with event IDs from `ea_branch_membership_events`.

---

## Open items for legal/security review

- Evidence standard for agency authority verification
- Retention of support intervention records
- Whether break-glass RPC requires dual control
- Customer notification obligations

---

*This runbook does not authorise Production changes by itself. Production intervention requires explicit operational approval.*
