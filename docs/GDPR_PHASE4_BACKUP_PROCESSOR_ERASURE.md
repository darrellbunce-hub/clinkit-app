# GDPR Phase 4 — Backup Re-erasure, Suppression Ledger & Processor Completion

**Status:** IMPLEMENTED (Development) · VERIFIED via `scripts/verify-gdpr-erasure-phase4.ts`

**Related:** [Phase 3 Execution](./GDPR_PHASE3_ERASURE_EXECUTION.md) · [Backup Runbook](./GDPR_BACKUP_ERASURE_RUNBOOK.md) · [Operational Runbook](./GDPR_ERASURE_OPERATIONAL_RUNBOOK.md) · [Launch Checklist](./GDPR_LAUNCH_CHECKLIST.md)

---

## Purpose

Phase 4 completes the operational architecture for GDPR erasure after live database execution:

1. **Keyed suppression ledger** — recognise erased identities after backup restore without storing raw email
2. **Auth-last sequencing with suppression** — fingerprint recorded while Auth email is still available
3. **External processor completion semantics** — Resend, Vercel, Upstash tracked honestly
4. **Privacy Admin completion checklist** — operator-readable status without PII/fingerprints
5. **Restore/re-erasure procedure** — documented operational control (not fake backup editing)

---

## Suppression ledger design

| Property | Value |
|----------|-------|
| Table | `gdpr_erasure_suppression_ledger` |
| Stored values | HMAC-SHA-256 fingerprints only |
| Algorithm label | `hmac_sha256_v1` |
| Raw email | **Never stored** |
| HMAC key | **Never stored in DB** |

### Fingerprint construction (server-side only)

Environment variable: **`GDPR_SUPPRESSION_HMAC_KEY`**

```
subject_user_id_hash = HMAC-SHA256(key, "uid:" + user_id)
email_hash           = HMAC-SHA256(key, "email:" + normalised_email)
```

Normalisation: trim + lowercase email.

### Pseudonymous data assessment

**LEGAL REVIEW REQUIRED:** HMAC outputs remain **pseudonymous personal data** under UK GDPR when linked to erasure operations. Treat ledger rows as sensitive operational data with strict access controls and retention review.

---

## Key management

| Rule | Status |
|------|--------|
| Key in Git | ✗ forbidden |
| Key in browser/client bundles | ✗ forbidden |
| Key in logs | ✗ forbidden |
| Key in Supabase DB | ✗ forbidden |
| Production provisioning | Secrets manager / Vercel env (manual) |

Missing key → suppression recording **fails closed** (`suppression_hmac_key_missing`).

---

## Sequencing (Auth-last preserved)

```
Database erasure complete (awaiting_auth_deletion)
  → derive HMAC fingerprints server-side (Auth email still available)
  → record_gdpr_erasure_suppression_ledger (idempotent)
  → Supabase Auth deleteUser
  → complete_gdpr_erasure_auth_deletion
  → recompute completion from processor states
```

`complete_gdpr_erasure_auth_deletion` rejects completion if suppression not recorded.

---

## Authoritative ledger survival strategy

**PROBLEM:** Supabase PITR/backup restore rolls back the application database, which may remove suppression entries created after the restore point.

**IMPLEMENTED (Development):** In-database ledger + matching RPC for restore simulation.

**MANUAL OPERATION (Production — required):**

Maintain an **authoritative suppression export** outside the restored database:

- Encrypted append-only export after each completed erasure, **or**
- Separate secure store / project not restored with application PITR

On restore:

1. Isolate restored environment (no public traffic)
2. Import/retain current authoritative ledger
3. Match restored Auth identities via HMAC fingerprints
4. Re-run impact assessment + controlled re-erasure
5. Verify all matches handled before go-live

See [GDPR_BACKUP_ERASURE_RUNBOOK.md](./GDPR_BACKUP_ERASURE_RUNBOOK.md).

---

## Processor action model

Extended statuses on `gdpr_erasure_processor_actions`:

| Status | Meaning |
|--------|---------|
| `pending` | Action required |
| `manual_review` | Operator review required |
| `processing` | In progress |
| `completed` | Manually verified complete |
| `failed` | Failed / needs review |
| `not_required` | Not required for this request |
| `not_applicable` | Processor not in use |
| `retention_expiry` | Satisfied by provider retention expiry |

**Completion rule:** Request reaches `completed` only when Auth deletion is done **and** no required external processor remains in a blocking state (`pending`, `manual_review`, `processing`, `failed`).

`retention_expiry`, `not_applicable`, `not_required`, `completed` are **satisfied**.

---

## Resend treatment

**IMPLEMENTED in Keynetic DB:** `REDACT_EMAIL_REFERENCE` redacts `email_events.recipient_email` locally.

**PROVIDER VERIFICATION REQUIRED:**

- Resend recipient/message retention policy
- Whether per-recipient deletion/suppression API exists
- DPA/subprocessor terms

**Privacy Admin:** Resend remains `pending` until operator marks `completed` manually after verified provider action. Local DB redaction **does not** auto-complete Resend.

---

## Vercel / log treatment

**LIKELY DATA:** Request metadata, error traces (PII minimised in app code), cron output.

**Treatment:** No fake per-user log deletion automation. Default processor row: `manual_review`. Operator may mark:

- `completed` — after verified manual review/action
- `retention_expiry` — when satisfied by Vercel log retention policy

**MANUAL OPERATION:** Confirm Vercel log retention + drain configuration in Dashboard.

---

## Upstash treatment

**IMPLEMENTED audit finding:** `@upstash/redis` present; used for address search cache and rate limits when env vars set.

| Cache | Classification | Erasure strategy |
|-------|----------------|------------------|
| Address lookup keys | Potentially personal (query strings) | TTL 24h; purge on erasure if enabled — **MANUAL OPERATION** |
| Rate-limit keys | Pseudonymous (admin UUID) | TTL window expiry |

**Privacy Admin:** Shows Upstash as **Not applicable** when no processor row exists.

**PROVIDER VERIFICATION REQUIRED:** Production Upstash enablement + DPA.

---

## Privacy Admin integration

`/admin/privacy/[requestId]` includes **Completion checklist**:

- Keynetic database
- Backup re-erasure protection (no fingerprint shown)
- Supabase Auth
- Resend / Vercel / Upstash processor rows

All reads/actions remain **platform admin + AAL2**.

---

## RPCs (service_role only)

| RPC | Purpose |
|-----|---------|
| `record_gdpr_erasure_suppression_ledger` | Idempotent ledger write |
| `match_gdpr_suppression_ledger_identities` | Restore matching (fingerprints only) |
| `recompute_gdpr_erasure_completion` | Promote `partially_completed` → `completed` |
| `update_gdpr_erasure_processor_action` | Extended statuses + operator attribution |

---

## Verification

```bash
npx tsx scripts/verify-gdpr-erasure-phase4.ts
npx tsx scripts/verify-gdpr-erasure-execution.ts
npx tsx scripts/verify-privacy-admin-security.ts
npm run build
```

---

## Manual Development steps

1. Apply migration `20260719100000_gdpr_erasure_phase4.sql` to Development Supabase
2. Set `GDPR_SUPPRESSION_HMAC_KEY` in `.env.local` (32+ byte random secret)
3. Run verification scripts above
4. Browser: complete erasure flow; confirm checklist states update correctly

---

## Remaining launch blockers

| Item | Status |
|------|--------|
| Production `GDPR_SUPPRESSION_HMAC_KEY` | MANUAL OPERATION |
| Authoritative ledger export outside DB | MANUAL OPERATION |
| Backup restore tabletop drill | MANUAL OPERATION |
| Resend deletion API verification | PROVIDER VERIFICATION REQUIRED |
| Vercel DPA + retention confirmation | PROVIDER VERIFICATION REQUIRED |
| Upstash Production enablement + DPA | PROVIDER VERIFICATION REQUIRED |
| `email_events` retention automation | PROPOSED — not scheduled in Phase 4 |
| Legal review of HMAC pseudonym classification | LEGAL REVIEW REQUIRED |
