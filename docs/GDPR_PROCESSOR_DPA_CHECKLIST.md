# GDPR Processor & DPA Checklist — Keynetic

**Version:** Phase 1  
**Privacy contact:** privacy@keynetic.co.uk *(proposed)*  
**Related:** [Data Inventory](./GDPR_DATA_INVENTORY.md) · [Erasure Runbook](./GDPR_ERASURE_OPERATIONAL_RUNBOOK.md)

---

## Status legend

| DPA status | Meaning |
|------------|---------|
| **unknown** | No evidence in repository |
| **needs_acceptance** | Known processor; DPA not confirmed signed |
| **confirmed** | Evidence in repo or founder confirmation (document date) |

Do **not** mark DPA **confirmed** without evidence.

---

## Active processors (in repository)

### Supabase (Auth + Postgres + Storage)

| Item | Detail |
|------|--------|
| **DPA status** | **unknown** — accept via Supabase Dashboard / order form |
| **Data processed** | All application DB tables, Auth users, sessions, API logs |
| **Data location** | Project region — **verify Production Dashboard** |
| **Retention** | DB: controller-defined; Backups: Pro **7 days** daily (verify); API logs: Pro **7 days** default (verify) |
| **Erasure propagation** | **Required** — Auth delete + DB mutations on live database |
| **Backup/log implications** | Erased PII may remain in backups until expiry; see [Backup Runbook](./GDPR_BACKUP_ERASURE_RUNBOOK.md) |
| **Deletion API verified?** | Auth Admin API for users; SQL for rows — **yes (standard Supabase)** |
| **Pre-launch actions** | [ ] Sign DPA [ ] Confirm region [ ] Confirm backup/PITR [ ] Document Dashboard admins |

### Resend (transactional email)

| Item | Detail |
|------|--------|
| **DPA status** | **unknown** |
| **Data processed** | Recipient email, HTML/text bodies (may include **names, property addresses** in invitation templates), provider message IDs |
| **Data location** | Resend infrastructure — **verify DPA / SCCs** |
| **Retention** | **Not verified in repo** — confirm Resend documentation before claiming deletion capability |
| **Erasure propagation** | **Required** — manual/API request to delete or suppress contact when RTBF executed |
| **Deletion API verified?** | **Not verified in repo** — do not claim until confirmed from current Resend docs |
| **Pre-launch actions** | [ ] Sign DPA [ ] Confirm retention [ ] Document erasure procedure [ ] Confirm webhook payload PII |

**In-repo integration:** `lib/communications/resend.ts`, `email_events` audit table.

### Vercel (hosting, cron, logs)

| Item | Detail |
|------|--------|
| **DPA status** | **unknown** |
| **Data processed** | Request routing, environment variables (secrets not logged), build logs, optional log drains |
| **Data location** | Vercel region — verify |
| **Retention** | Plan-dependent log retention — **verify Dashboard** |
| **Erasure propagation** | **Limited** — no per-user deletion API for platform logs |
| **Backup/log implications** | URLs in logs may contain property IDs; minimise client/server PII logging |
| **Deletion API verified?** | **No general RTBF API** — retention expiry only |
| **Pre-launch actions** | [ ] Sign DPA [ ] Confirm log retention [ ] Disable unnecessary log drains [ ] Review cron route logs |

**In-repo:** `vercel.json` lifecycle cron, `lib/security/httpHeaders.ts`.

### Upstash Redis (optional cache)

| Item | Detail |
|------|--------|
| **DPA status** | **unknown** |
| **Enabled?** | **Verify** — requires `UPSTASH_REDIS_REST_URL` + token |
| **Data processed** | Address search cache (`lib/cache/addressCache.ts`), rate-limit identifiers |
| **Retention** | TTL ~24h for address cache (if enabled) |
| **Erasure propagation** | Purge keys matching user/property/email on RTBF — manual or scripted |
| **Deletion API verified?** | Key delete via REST — **yes if enabled** |
| **Pre-launch actions** | [ ] Confirm if enabled in Production [ ] Sign DPA if enabled [ ] Document purge procedure |

---

## Planned / not implemented

| Processor | Evidence | Pre-launch |
|-----------|----------|------------|
| **Stripe** | `EaCompany.stripe_customer_id` field; landing page pricing copy only | DPA + deletion API when billing implemented |
| **Future analytics** | Phase 3 benchmarks — not integrated | DPIA before integration |
| **Affiliate providers** | Not in repo | N/A |
| **Sentry / error monitoring** | Not in repo | N/A if not added |

---

## Erasure propagation summary

| Processor | RTBF action |
|-----------|-------------|
| Supabase DB | Controlled erasure RPC / manual SQL (Phase 3) |
| Supabase Auth | Delete user **last** |
| Resend | Manual deletion/suppression request |
| Vercel | Rely on log expiry; minimise logged PII |
| Upstash | Delete cache keys if enabled |
| Stripe (future) | Customer delete via Stripe API |

---

## Privacy policy / subprocessors list

Publish subprocessors mirroring this checklist after DPA status confirmed.

---

*Checklist for operational compliance preparation — not legal advice.*
