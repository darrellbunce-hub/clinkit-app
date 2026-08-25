# GDPR Backup Erasure Runbook — Keynetic

**Version:** Phase 1  
**Privacy contact (proposed):** privacy@keynetic.co.uk  
**Related:** [Erasure Architecture](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md) · [Retention Schedule](./GDPR_DATA_RETENTION_SCHEDULE.md) · [Operational Runbook](./GDPR_ERASURE_OPERATIONAL_RUNBOOK.md)

---

## Purpose

Document how Keynetic handles personal data that may **remain inside Supabase database backups** after a successful Right to Erasure execution, and how to prevent erased data re-entering production through restore operations.

This runbook does **not** implement backup modification. It defines process, roles, and technical follow-up.

---

## Confirmed technical facts (from Supabase documentation)

Sources: [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups), [PITR pricing](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery)

| Fact | Detail |
|------|--------|
| Pro plan daily backups | **7 days** retention (Team: 14; Enterprise: up to 30) |
| PITR | Optional paid add-on (~$100/month per 7-day retention window; up to 28 days self-serve) |
| Backup type | Logical (&lt;15GB) or physical (&gt;15GB / PITR) — not user-selectable in all cases |
| Restore | Full project restore; **project inaccessible during restore** |
| Surgical row deletion inside immutable backup | **Not supported** — backups are point-in-time snapshots |

---

## Assumptions (verify before launch)

| Assumption | Verification action |
|------------|---------------------|
| Production uses Supabase **Pro** | Dashboard → Project Settings → Subscription |
| PITR **not** enabled initially | Dashboard → Database → Backups → Point in Time |
| No off-site manual `pg_dump` exports | Confirm with founder |
| Erasure executed on **live** database only | Process design |

---

## 1. What happens if erased PII remains in an immutable backup?

**Technical fact:** Erased rows and redacted fields **will remain** in historical daily backups and WAL archives until those backups **expire** out of the retention window.

**Operational consequence:** A data subject whose erasure completed today may still exist in backups from yesterday through day 7 (Pro default).

**This is industry-standard** for snapshot-based backup systems. The live production database reflects erasure; backups are time capsules.

---

## 2. Does UK GDPR necessarily require editing every historical backup immediately?

**Not legal advice.** Keynetic should obtain legal counsel on this point. Common controller practice (subject to legal review):

- **Primary obligation:** Erase personal data from **live processing systems** without undue delay (Article 17).
- **Backups:** Controllers often document that backup copies are **not accessed for processing** except disaster recovery, are **time-limited**, and erasure is **re-applied after restore** if data resurfaces.
- **Immediate surgical backup editing** is typically **technically infeasible** on managed Postgres backups.

Keynetic must **not** claim backups contain no personal data after erasure. Privacy notice should describe backup retention and restore procedure at a high level (legal review of wording).

---

## 3. Documented backup retention (recommended publication)

| Layer | Retention | Access |
|-------|-----------|--------|
| Supabase Pro daily backups | 7 days (confirm on Production) | Supabase platform admins only |
| PITR (if enabled) | Configurable 7–28 days | Same |
| Supabase API logs (Pro) | 7 days default | Dashboard |
| Vercel logs | Plan-dependent | Vercel dashboard |
| Manual exports | **Policy: none** unless documented | Founder only |

**Action before launch:** Record actual Production settings in internal compliance register (screenshot + date).

---

## 4. What happens if a backup containing erased data is restored?

**Risk:** Full restore to a point **before** erasure reintroduces all deleted/redacted PII into the live database.

### Pre-restore checklist

- [ ] Confirm restore is **necessary** (disaster only — not routine)
- [ ] Export list of **all erasures** since restore target timestamp from suppression ledger
- [ ] Schedule maintenance window
- [ ] Notify privacy lead

### Post-restore procedure

1. Complete Supabase restore per Dashboard guidance
2. **Immediately** run automated **re-erasure job** against suppression ledger:
   - Match `email_hash` / `user_id` entries erased after restore point
   - Re-apply `execute_verified_erasure` idempotently OR dedicated `reapply_suppression_ledger()` RPC
3. Verify sample records (service role audit script — no PII in logs)
4. Document incident: restore time, erasures re-applied, verification outcome
5. Assess whether data subjects whose erasure was reversed require **notification** — **legal review**

**Never restore to a point before erasure without a re-erasure plan.**

---

## 5. Suppression / erasure ledger (recommended)

### Purpose

Enable automatic re-application of erasures after backup restore **without storing erased emails in plaintext**.

### Proposed design (not implemented)

| Field | Content |
|-------|---------|
| `id` | UUID |
| `subject_user_id_hash` | HMAC-SHA256(user_id, server_pepper) — **not reversible** |
| `email_hash` | HMAC-SHA256(normalised_email, server_pepper) |
| `erased_at` | timestamptz |
| `erasure_request_id` | FK to audit request |
| `action_manifest_version` | Integer — schema version of actions applied |

**Do not store:** raw email, name, address, erasure request free text.

### Re-application logic

On restore, for each ledger entry where `erased_at > restore_point`:

1. If `subject_user_id_hash` matches a live auth user → run erasure execution
2. Else match `email_hash` against normalised `email_events.recipient_email`, invite tables
3. Log re-application count to `erasure_actions` (no PII)

### Ledger retention

Retain ledger **indefinitely** (contains no direct identifiers) OR purge entries older than backup retention window + margin — **legal review** on whether hashes constitute personal data (likely low risk if peppered).

---

## 6. How the ledger avoids becoming a new PII store

| Control | Rationale |
|---------|-----------|
| One-way HMAC only | Cannot recover email from hash without pepper compromise |
| Pepper in secrets manager (not DB) | Separate from backup |
| No names/addresses in ledger | Minimisation |
| Periodic review | Ensure erasure RPC never writes raw PII to ledger |

---

## 7. Supabase Pro backup / PITR — manual confirmation checklist

Before launch, complete in Supabase Dashboard (Production project):

| # | Check | Record result |
|---|-------|---------------|
| 1 | Plan tier (Pro/Team/Enterprise) | |
| 2 | Daily backup retention days | |
| 3 | PITR enabled? Yes/No | |
| 4 | If PITR: retention window (days) | |
| 5 | Database size (logical vs physical backup mode) | |
| 6 | Last successful backup timestamp | |
| 7 | Who has Dashboard access (named individuals) | |
| 8 | Supabase DPA signed? | |
| 9 | Region / data residency | |
| 10 | Log drain enabled? Content? | |

---

## Operational roles

| Role | Responsibility |
|------|----------------|
| **Privacy lead (founder)** | Approve erasures; authorize restore |
| **Technical admin** | Execute erasure RPCs; restore; re-erasure |
| **Legal counsel** | Backup wording; notification after accidental restore |

---

## Drill (recommended before launch)

1. On **Development** project only (`bbbsxzxcjkmpqsfvmhbo`):
   - Create synthetic user + minimal PII
   - Execute test erasure (when RPC exists)
   - Record ledger entry
   - **Do not restore Production**
2. Tabletop exercise: "Restore to T-2 days with 1 erasure in between" — walk through re-erasure steps on paper

**Do not** restore Development over Production or vice versa.

---

## Items requiring legal review

1. Privacy notice disclosure for backup retention period
2. Whether re-erasure after restore triggers breach notification
3. Whether HMAC hashes are personal data in UK GDPR terms
4. Cross-border backup storage (Supabase region)

---

*Operational runbook design only. Not legal advice.*
