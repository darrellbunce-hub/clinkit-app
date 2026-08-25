# GDPR Right to Erasure — Operational Runbook (Launch)

**Version:** Phase 1 — manual/admin-assisted  
**Privacy contact:** privacy@keynetic.co.uk *(proposed — mailbox setup and delivery testing required before launch)*  
**Status:** Operational procedure — Phase 3 Development execution tooling available ([Phase 3 doc](./GDPR_PHASE3_ERASURE_EXECUTION.md)); Production rollout requires separate approval  
**Related:** [Erasure Architecture](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md) · [Data Retention Schedule](./GDPR_DATA_RETENTION_SCHEDULE.md) · [Backup Runbook](./GDPR_BACKUP_ERASURE_RUNBOOK.md)

---

## Critical separations

| Action | What it is | RTBF? |
|--------|------------|-------|
| **Participation de-link** | User leaves a transaction; history retained | **No** |
| **Lifecycle release / anonymisation** | Automated property cleanup | **No** |
| **Formal Right to Erasure** | Verified data-subject request | **Yes — this runbook** |

If a user asks to "leave" or "stop using" a transaction, offer **de-link** first. If they request **account/data deletion**, use this runbook.

---

## Response timeframes

| Standard | Timeframe |
|----------|-----------|
| **UK GDPR statutory** | One **calendar month** from receipt of a valid request (extendable up to two further months if complex — inform requester within first month) |
| **Keynetic internal target** | Aim to process **straightforward** requests within **72 hours where reasonably possible** |

Do **not** guarantee 72-hour completion publicly. Complex cases (active shared transactions, identity disputes, lawful retention, processor dependencies) may require longer assessment within the statutory window.

---

## Pre-launch manual actions

- [ ] Create and test **privacy@keynetic.co.uk** mailbox (forwarding, access control, secure storage)
- [ ] Assign privacy request handler(s)
- [ ] Confirm Supabase Production backup/PITR settings ([Backup Runbook](./GDPR_BACKUP_ERASURE_RUNBOOK.md))
- [ ] Confirm DPAs signed ([Processor Checklist](./GDPR_PROCESSOR_DPA_CHECKLIST.md))
- [ ] Publish Privacy Policy and erasure request instructions (content phase)

---

## Workflow overview

```
Request received
  → Log securely
  → Verify identity
  → Resolve user account
  → Check active participation / shared transactions
  → Distinguish de-link vs formal erasure
  → Impact/scope assessment (Phase 2: automated report)
  → Admin approval (full / partial / refused)
  → Controlled execution (Phase 3+: automated RPC)
  → External processor actions
  → Supabase Auth deletion LAST
  → Minimal completion audit
  → Confirm to requester
  → Suppression ledger entry (Phase 4+)
```

---

## Step-by-step procedure

### 1. Request received

**Channel:** privacy@keynetic.co.uk (or in-app erasure request form when published).

**Do not** trigger automatic deletion from any self-service UI at launch.

Record in secure internal log (spreadsheet, ticket system, or future `erasure_requests` table):

| Field | Store |
|-------|-------|
| Request ID | Generated UUID |
| Received at | Timestamp (starts statutory clock when request is valid) |
| Channel | Email / in-app |
| Requester email | **Temporary** — delete per erasure audit retention policy after case closed |
| Request type | Full account erasure / partial / unclear |
| Status | `requested` |

### 2. Log request securely

- Restrict access to privacy lead and authorised admins
- Do not forward full request content to unsecured channels
- Do not log request body in application `console` or Vercel logs

### 3. Verify identity

**Minimum before processing:**

- Match to authenticated account **or**
- Confirm control of registered email (reply from that address + account challenge) **or**
- Additional verification for high-risk cases

**Clock note:** If identity documents are required, the statutory period may start when sufficient information is received ([ICO time limits](https://ico.org.uk/for-the-public/time-limits-for-responding-to-data-protection-rights-requests/)).

**If identity cannot be verified:** Pause processing; request proportionate verification. Do not erase the wrong account.

### 4. Determine requesting user / account

- Resolve `auth.users.id` from verified email or authenticated session
- Load `profiles` account type (homeowner vs estate agent)
- **MANUAL today:** Query Supabase Dashboard / SQL (service role) for participation summary

### 5. Check active transaction participation

Identify:

- Active `property_operational_identities`
- Counterparty / delegate / EA assignments
- Properties in non-terminal lifecycle states
- Pending invitations sent or received

**If active shared transaction exists:** proceed to shared-data assessment — do **not** assume full property deletion.

### 6. Distinguish de-link from formal erasure

| User intent | Route |
|-------------|-------|
| "I want to leave this transaction" | Participation de-link (`execute_participation_delink`) — **not this runbook** |
| "Delete my account / all my personal data" | This runbook |
| Unclear | Clarify in writing before proceeding |

Document the user's confirmed intent in the case record.

### 7. Assess shared transaction dependencies

For each property/chain relationship:

- Count other active participants (homeowner, counterparty, EA, delegate)
- Classify sole-participant vs shared ([Address decision model](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md#part-4--property-address-erasure-contextual-model))
- Flag properties where address retention may be required for other participants

**Product principle:** Erase the **person–property identity link** without automatically destroying shared property records others still need.

### 8. Identify direct and indirect PII

Use [Data Inventory](./GDPR_DATA_INVENTORY.md) checklist:

- Auth + profile
- Operational identities, members, delegates, counterparty
- Claim metadata, invitations
- `email_events` (by user id and email match)
- Activities, chain attribution fields
- JSONB metadata (manual spot-check until Phase 2 report)
- Analytics re-identification risk ([Architecture — Analytics](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md#analytics-snapshots--anonymity-classification))

**Phase 2:** Replace manual inventory with `generate_erasure_impact_report(user_id)`.

### 9. Assess lawful retention exceptions

**Not legal advice.** Escalate to legal counsel when:

- Refusal under Article 17(3) may apply
- Active dispute or regulatory obligation suspected
- Partial erasure only is appropriate

Document proposed lawful basis for any retained data before execution.

### 10. Approve erasure scope

Admin decision:

| Outcome | Meaning |
|---------|---------|
| **Full erasure approved** | All personal data removable; no blocking shared records |
| **Partial erasure approved** | Remove user's identity links and direct PII; retain shared operational records with documented justification |
| **Refused with lawful reason** | Inform requester within statutory deadline with explanation |
| **Deferred — manual review** | Legal/complex case |

Record approver, timestamp, and decision rationale (minimal PII in long-term audit).

### 11. Execute controlled erasure

**⚠ NOT AVAILABLE AT PHASE 1 LAUNCH — requires Phase 3 authorisation**

When tooling exists:

1. Run `generate_erasure_impact_report` (read-only) — Phase 2
2. Run `execute_verified_erasure(erasure_request_id)` — Phase 3
3. Follow phased order in architecture doc (DB → processors → Auth last)

**Phase 1 manual fallback (only if launch requires before RPC — high risk):**

- Service-role SQL per approved scope checklist
- Document every table/action manually
- **Do not delete Auth user until DB actions verified**

### 12. Propagate deletion to external processors

See [Processor Checklist](./GDPR_PROCESSOR_DPA_CHECKLIST.md):

| Processor | Typical action |
|-----------|----------------|
| **Resend** | Request deletion/suppression of contact and message data for requester email |
| **Upstash Redis** | Purge cache keys if address/email cached |
| **Vercel** | No user PII deletion API — note log retention |
| **Supabase Auth** | Step 13 — last |

Document processor ticket IDs and outcomes in case file.

### 13. Delete Auth identity last

**Only after** database erasure/redaction for approved scope is complete and verified.

Use Supabase Dashboard Auth admin or Admin API.

Verify: profile gone, user cannot sign in, no unexpected FK errors.

### 14. Record minimal non-PII completion evidence

Long-term internal record (after case closed):

| Retain | Do not retain |
|--------|---------------|
| Request ID, dates, outcome enum | Requester email (after confirmation sent) |
| Action categories applied | Full impact report with PII |
| Approver ID | Property addresses |
| Processor ticket references | Free-text request body |

**Phase 4+:** Append hash-only entry to suppression ledger.

### 15. Confirm completion to requester

Send confirmation to verified contact channel:

- What categories were erased
- What was retained and **high-level** lawful reason (legal-reviewed wording)
- That de-link and lifecycle processes are separate
- No promise of backup surgical deletion — live systems cleared per scope

Complete within statutory deadline; target 72h internal for straightforward cases.

### 16. Suppression ledger entry

**⚠ NOT IMPLEMENTED — Phase 4+**

After ledger exists: record HMAC hashes only (no raw email) for backup re-application per [Backup Runbook](./GDPR_BACKUP_ERASURE_RUNBOOK.md).

### 17. Backup restore awareness

If disaster restore occurs after erasure, follow [Backup Runbook — post-restore re-erasure](./GDPR_BACKUP_ERASURE_RUNBOOK.md#post-restore-procedure).

---

## Failure and escalation

| Situation | Action |
|-----------|--------|
| Cannot verify identity | Request proportionate ID; pause clock per ICO guidance |
| Active shared transaction blocks full erasure | Offer partial erasure + de-link; legal review if disputed |
| Execution RPC partial failure | Do not delete Auth; re-run idempotent execution; escalate technical |
| Resend deletion fails | Mark partial; retry; document in case |
| Requester disputes retention | Escalate to legal counsel |
| Suspected malicious request | Verify thoroughly; do not erase without certainty |
| Wrong account risk | **Stop** — re-verify |

**Escalation contacts:** Privacy lead (founder) → legal counsel → Supabase/Resend support as needed.

---

## Estate agent organisation note

Erasing an **individual EA user** does **not** automatically delete branch/company records. If last branch member, flag for admin review — do not auto-delete organisation.

---

## Analytics note

Do not assume analytics snapshots are anonymous. Phase 2 impact report must flag re-identification risk. Retain snapshots after erasure **only** if verified anonymous — see architecture doc.

---

*Operational runbook — not legal advice. Destructive execution requires Phase 2/3 approval.*
