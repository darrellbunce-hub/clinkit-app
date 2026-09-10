# GDPR Data Retention Schedule — Keynetic

**Version:** Phase 1 — proposed policy  
**Status:** Periods marked **proposed/TBD** require founder and/or legal approval before publication  
**Related:** [Data Inventory](./GDPR_DATA_INVENTORY.md) · [Erasure Runbook](./GDPR_ERASURE_OPERATIONAL_RUNBOOK.md) · [Communications](./COMMUNICATIONS.md)

---

## How to read this schedule

| Column | Meaning |
|--------|---------|
| **Operational retention** | While user/property relationship is active |
| **Post-transaction retention** | After archive/release/anonymisation or de-link |
| **Erasure treatment** | On formal RTBF (see architecture) |
| **Lifecycle treatment** | Automated lifecycle worker behaviour |
| **Backup treatment** | Immutable backups until expiry; re-erasure on restore |
| **Status** | `approved` / `proposed` / `TBD` |

**Legend:** This document does **not** invent statutory legal retention periods. Where law may require longer retention, status is **legal review required**.

---

## Summary table

| Data category | Operational retention | Post-transaction retention | Erasure treatment | Lifecycle | Backup | Legal review? | Status |
|---------------|----------------------|----------------------------|-------------------|-----------|--------|---------------|--------|
| Auth identity | Account lifetime | N/A | Delete Auth user last | N/A | Expires with backup window; ledger re-apply | Possible security fraud hold | **proposed** |
| Profiles | Account lifetime | N/A | Delete row | N/A | Same | No | **proposed** |
| Property addresses | Active transaction | Until release/anonymise or RTBF assessment | Contextual — see architecture | Redact on `anonymised` | Same | Shared data — **yes** | **proposed** |
| Postcodes | Same as address | Same | Contextual | `REDACTED` on anonymise | Same | **yes** | **proposed** |
| Operational identities | Active participation | Historic status after delink/release | Remove/null user link | Delink/release RPCs | Same | Partial — **yes** | **proposed** |
| Property members | Active | Removed on archive | Delete user rows | Archive deletes | Same | No | **proposed** |
| Counterparties | Active | Revoked on delink/archive | Remove user link | Archive | Same | No | **proposed** |
| Delegates | Active | Revoked | Delete/revoke rows | Archive | Same | No | **proposed** |
| EA assignments | Active assignment | Revoked; historic row may remain | Revoke; null assigner | Archive revokes | Same | No | **proposed** |
| Claim metadata | Active claim flow | Reduced on release | Null invite PII | Anonymise nulls invites | Same | No | **proposed** |
| Claim invitations | Pending + audit | Historic hashes | Revoke pending; null actors | Revoked on delink paths | Same | No | **proposed** |
| Activities | Active transaction | Documented scrub/delete intent; **not automated** | Scrub/delete user-attributable | Not auto-scrubbed | Same | **yes** (free text) | **proposed** |
| Chains | Active chain | Structural retention | Null user refs; contextual name | Completion triggers grace | Same | Shared — **yes** | **proposed** |
| Lifecycle states/events | Active | Permanent audit | Null user metadata | Worker-managed | Same | Audit — **yes** | **proposed** |
| De-link events | Permanent audit | Permanent | Null `actor_user_id` | N/A | Same | **yes** | **proposed** |
| Completion events | Permanent audit | Permanent | Null actor | N/A | Same | **yes** | **proposed** |
| Analytics snapshots | Created at release | **Permanent** (if anonymous) | Retain only if verified anonymous | Created pre-anonymise | Same | **yes** | **proposed** |
| Email events | Indefinite today | See [Email Events Policy](#email-events-retention-proposal) | Redact recipient email | N/A | Same | **yes** | **proposed** |
| Resend/provider data | Provider-controlled | Per Resend policy | Manual deletion request | N/A | N/A | **yes** | **TBD** |
| Redis cache | TTL ~24h (if enabled) | Expires | Purge on erasure | N/A | N/A | No | **proposed** |
| Security/platform logs | Vercel/Supabase plan defaults | 7 days (Pro default — verify) | Not user-deletable | N/A | N/A | **yes** | **TBD** |
| Erasure request audit | Case duration | **24 months** after closure (proposed) | Minimal non-PII | N/A | Ledger hash only | **yes** | **proposed** |
| Suppression ledger | N/A | Indefinite (hash-only) | N/A | N/A | Re-apply on restore | **yes** | **proposed** (Phase 4) |

---

## Detailed categories

### Auth identity (`auth.users`)

| | |
|-|-|
| **Example fields** | email, metadata, verification timestamps |
| **Purpose** | Authentication, authorisation |
| **Operational** | Until account deleted |
| **Post-transaction** | N/A |
| **Erasure** | Supabase Auth Admin delete — **last step** |
| **Lifecycle** | Not managed by property lifecycle |
| **Backup** | May persist until backup expiry; suppression ledger on restore |
| **Legal review** | Fraud/abuse investigation may justify short extension — **TBD** |

### Profiles

| | |
|-|-|
| **Example fields** | `contact_name`, `account_type`, `email_domain` |
| **Purpose** | Account routing, EA display |
| **Erasure** | Delete profile row with Auth |

### Property addresses & postcodes

| | |
|-|-|
| **Example fields** | `properties.address`, `properties.postcode` |
| **Purpose** | Operational transaction location |
| **Operational** | Duration of active operational relationship |
| **Post-transaction** | Lifecycle may redact on `anonymised`; RTBF uses **contextual model** |
| **Erasure** | See [contextual address architecture](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md#part-4--property-address-erasure-contextual-model) |
| **Lifecycle** | `[Released property]` / `REDACTED` on property anonymisation |
| **Note** | Public listing elsewhere (e.g. portals) is **not** automatic retention justification |

### Analytics snapshots (`property_analytics_snapshots`)

| | |
|-|-|
| **Example fields** | `property_ref`, `chain_ref`, `source_property_id`, `payload` |
| **Purpose** | Aggregated performance metrics |
| **Post-transaction** | Permanent **if genuinely anonymous** |
| **Erasure** | Retain only after Phase 2/3 anonymity verification — else delete or further anonymise |
| **Lifecycle** | Created before property anonymisation |
| **Classification** | Currently **pseudonymous / potentially re-identifiable** — see architecture |

### Email events retention proposal

See dedicated section below and [COMMUNICATIONS.md](./COMMUNICATIONS.md).

---

## Email events retention (working product policy)

**Status:** **implemented** in migration `20260910210000_data_retention_and_activity_controls.sql`  
**Automation:** Vercel cron `GET/POST /api/cron/data-retention` (`0 30 3 * *` → `30 3 * * *`) via `CRON_SECRET` + service_role RPCs.  
**Separate from** property-lifecycle cron (`/api/cron/property-lifecycle`).

These periods are **Keynetic working product/business policy**, not claims that UK law mandates the exact numbers.

### Field-level behaviour

| Field | PII? | Working retention | RTBF | Automation |
|-------|------|-------------------|------|------------|
| `recipient_email` | **Yes** | Raw **0–90 days**; then `redacted+<id>@erased.local` | Redact immediately | `retain_email_events_batch` |
| `provider_message_id` | Indirect | Cleared on 90-day redact | Cleared | Same |
| `error_message` | **May contain PII** | Cleared/set `[redacted]` on 90-day redact | Scrub | Same |
| `provider_events` | **May contain PII** | Cleared to `[]` on 90-day redact | Scrub | Same |
| `template`, `status`, timestamps, FKs | Operational | Kept through redaction; **row deleted after 24 months only if already redacted** | Metrics retained until delete | Same |
| Email HTML/subject bodies | — | **Not stored in Keynetic DB** (Resend only) | Manual Resend request | N/A |

### Billing email dispatches

| Field | Behaviour |
|-------|-----------|
| `recipient_email` | Redact after **24 months** (ledger row **retained** for idempotency/audit) |
| Ledger identity / status / timestamps / FKs | Retained |
| GDPR `REDACT_EMAIL_REFERENCE` | Also redacts matching `billing_customer_email_dispatches` via `_gdpr_redact_billing_customer_email_dispatches` |

### Invitations

Invite emails redacted **30 days after expiry** when no active invitation remains; token hashes retained (up to security/audit need, working target 24 months for hashes).

### Observability

`maintenance_job_runs` records non-personal run counts/status. Dry-run: `preview_retain_*_batch` (service_role only — not a public HTTP endpoint).

**Provider-side (Resend) retention/deletion is not automated by Keynetic.**

**Legal review still required** before publishing exact periods in the public Privacy Policy.

---

## Participation de-link vs lifecycle vs RTBF

| Process | Data after event |
|---------|------------------|
| **De-link** | History, analytics, audit retained |
| **Lifecycle anonymise** | Property address redacted; snapshots may remain; **not** full user erasure |
| **RTBF** | User personal data removed/redacted per approved scope |

---

## Backup treatment (all categories)

| Fact | Policy |
|------|--------|
| Live erasure | Primary obligation |
| Backup copies | May persist until Supabase backup retention expires (Pro: **7 days** — verify) |
| Restore | Must re-apply erasures via suppression ledger (Phase 4+) |

See [GDPR_BACKUP_ERASURE_RUNBOOK.md](./GDPR_BACKUP_ERASURE_RUNBOOK.md).

---

## Review cycle

- Review this schedule before public Privacy Policy publication
- Review after Phase 2 impact report implementation
- Review when Stripe or new processors go live

---

*Policy proposals — not legal advice. Founder/legal approval required before external publication.*
