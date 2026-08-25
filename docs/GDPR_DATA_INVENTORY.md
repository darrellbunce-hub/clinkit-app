# GDPR Personal Data Inventory — Keynetic

**Audit date:** 2026-07-18 (Phase 1 governance update)  
**Privacy contact (proposed):** privacy@keynetic.co.uk — *verify mailbox before launch*  
**Related:** [Right to Erasure Architecture](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md) · [Retention Schedule](./GDPR_DATA_RETENTION_SCHEDULE.md) · [Operational Runbook](./GDPR_ERASURE_OPERATIONAL_RUNBOOK.md)

---

## How to read this document

| Column | Meaning |
|--------|---------|
| **Category** | Direct ID / indirect ID / operational / analytics / security-audit / potentially personal |
| **Lifecycle anonymisation** | Whether `execute_property_lifecycle_anonymise` affects this store today |
| **Proposed erasure** | Recommended treatment during formal UK GDPR Right to Erasure (subject to legal review) |
| **Legal retention** | Whether Keynetic may have grounds to retain some data after an erasure request |

**Important separation (non-negotiable):**

| Mechanism | Purpose |
|-----------|---------|
| **Participation de-link** | Operational release of one participant; history retained; reversible operationally |
| **Lifecycle release / anonymisation** | Property-level automated cleanup after dormancy/completion; **not** full RTBF |
| **Formal Right to Erasure** | Per-user data-subject request; dedicated auditable workflow (not yet implemented) |

---

## 1. Supabase Auth (`auth.users` — managed by Supabase, not in repo migrations)

| Field | Category | Access | Retention today | Lifecycle anonymisation | Proposed erasure | Legal retention? | Uncertainty |
|-------|----------|--------|-----------------|-------------------------|------------------|------------------|-------------|
| `id` (UUID) | Direct ID | Service role; referenced across DB | Until account deleted | No | Delete via Auth Admin API **after** DB erasure ledger complete | Possibly in audit ledger as pseudonymous ref | Auth deletion order critical |
| `email` | Direct ID | Auth flows; RPCs (`get_user_email_by_id`, dormancy recipient) | Until account deleted | No | Delete with Auth user | Unlikely after erasure complete | Resend may retain separately |
| `email_confirmed_at` | Operational | Auth gate | With account | No | Delete with account | No | — |
| `phone` | Direct ID (if used) | Auth | With account | No | Delete if present | No | **Unknown if Keynetic uses phone auth** |
| `raw_user_meta_data` / `user_metadata` | Potentially personal | Auth / profile bootstrap | With account | No | Clear on erasure | No | **Audit Supabase Dashboard for stored keys** |
| `banned_until` | Security | Admin | With account | No | Delete with account | Possible fraud/security retention — **legal review** | — |

**Access:** End user (own session); service role (workers, email resolution); branch admins via `get_user_email_by_id` RPC for team directory.

---

## 2. Profiles (`public.profiles`)

| Field | Category | Access | Retention | Lifecycle anonymisation | Proposed erasure | Legal retention? |
|-------|----------|--------|-----------|-------------------------|------------------|------------------|
| `id` | Direct ID | Self; RLS | With account | No | Delete row after pseudonymising FKs | Audit refs only |
| `contact_name` | Direct ID | Self; EA team directory | With account | No | Null or delete row | Unlikely |
| `account_type`, `role` | Operational | Middleware routing | With account | No | Delete with profile | Unlikely |
| `email_domain` | Indirect ID | EA company matching | With account | No | Null | Unlikely |
| `onboarding_completed_at` | Operational | Internal | With account | No | Delete with profile | Unlikely |

**Migration sources:** `20260610150000_phase1_ea_foundation_schema.sql`, `20260709150000_ensure_user_profiles.sql`

---

## 3. Properties (`public.properties`)

| Field | Category | Access | Retention | Lifecycle anonymisation | Proposed erasure | Legal retention? |
|-------|----------|--------|-----------|-------------------------|------------------|------------------|
| `address` | Direct ID (location) | RLS-scoped participants / assigned EAs | Operational until archive/release/anonymise | **Yes** → `[Released property]` | **Context-dependent** — see architecture doc | Shared transaction may require retention |
| `postcode` | Direct ID (location) | Same | Same | **Yes** → `REDACTED` | Context-dependent | Same |
| `created_by_user_id` | Direct ID | Service role; internal | Historic | No | Null or pseudonymise | May retain for shared record integrity |
| `last_operational_activity_at` | Operational | Lifecycle worker | Operational | No | Null on user-specific scrub only | N/A |
| Stage/status/topology fields | Operational | Participants | Operational | No | Retain on shared records | Legitimate interest for other participants |

**Note:** Base `properties` table DDL is not in repo migrations (pre-existing schema). Column list inferred from migrations and app code.

---

## 4. Chains (`public.chains`)

| Field | Category | Access | Retention | Lifecycle anonymisation | Proposed erasure | Legal retention? |
|-------|----------|--------|-----------|-------------------------|------------------|------------------|
| `name` | Potentially personal (free text) | Chain participants | Operational | No | Redact if user-authored and sole participant | Shared chain: retain structural data |
| `access_code` | Sensitive (not PII) | Participants | Operational | No | Rotate/regenerate if needed | N/A |
| `created_by_user_id` | Direct ID | Internal | Historic | No | Null | Shared chain |
| `completion_*_user_id` (multiple) | Direct ID | Audit | Append-only | No | Null user refs; retain dates | Transaction audit |
| `completed_at`, `last_operational_activity_at` | Operational | Lifecycle | Operational | No | Retain on shared records | N/A |

---

## 5. Property membership & operational identity

### `property_members` (legacy sync table)

| Field | Category | Lifecycle anonymisation | Proposed erasure |
|-------|----------|-------------------------|------------------|
| `user_id` | Direct ID | Deleted on `execute_property_lifecycle_archive` | Delete rows for requesting user |
| `role` | Operational | Deleted on archive | Delete with membership |

### `property_operational_identities`

| Field | Category | Lifecycle anonymisation | Proposed erasure |
|-------|----------|-------------------------|------------------|
| `homeowner_user_id` | Direct ID | Status → `delinked`/`released` on archive/delink | Null user ref or delete row per policy |
| `metadata` jsonb | Potentially personal | Not scrubbed | **Structured scrub** — reject unknown keys at write time in future |
| `status`, timestamps | Operational/audit | Updated by delink/lifecycle | Retain status history without user ID where possible |

### `property_counterparty_participants`

| Field | Proposed erasure |
|-------|------------------|
| `user_id` | Delete or null for requesting counterparty only |
| Other fields | Retain operational structure for remaining participants |

### `property_delegates`

| Field | Proposed erasure |
|-------|------------------|
| `delegate_user_id`, `invited_by_user_id` | Delete/revoke rows involving requesting user |

### `property_ea_assignments`

| Field | Proposed erasure |
|-------|------------------|
| `assigned_by_user_id` | Null; retain assignment history for branch if EA erasure |

---

## 6. Claim & invitation data

### `property_claim_metadata`

| Field | Category | Lifecycle anonymisation | Proposed erasure |
|-------|----------|-------------------------|------------------|
| `invite_email` | Direct ID | **Yes** — nulled on anonymise | Redact/null on erasure |
| `invite_display_name` | Direct ID | **Yes** — nulled | Redact/null |
| `originated_by_user_id`, `claimed_by_user_id` | Direct ID | Not on anonymise | Null |

### `property_claim_invitations`

| Field | Category | Proposed erasure |
|-------|----------|------------------|
| `invitation_token_hash` | Security | Delete/revoke pending invites |
| `created_by_user_id`, rejection/acknowledgment user IDs | Direct ID | Null |
| `invitation_rejection_reason` | Structured (slug only) | Retain code; null user refs |

### `ea_branch_invitations`

| Field | Category | Proposed erasure |
|-------|----------|------------------|
| `invite_email`, `invite_name` | Direct ID | Redact/null |
| `created_by_user_id`, `accepted_by_user_id` | Direct ID | Null |

---

## 7. Estate agent organisation tables

### `ea_companies`

| Field | Category | Proposed erasure |
|-------|----------|------------------|
| `name`, `email_domain` | Business PII | Retain if other branch members remain; else delete company |
| `created_by_user_id` | Direct ID | Null |
| `stripe_customer_id` | Billing identifier | Delete via Stripe API when billing live — **planned/not implemented in app** |

### `ea_branches`

| Field | Proposed erasure |
|-------|------------------|
| `name`, `town_or_city`, `postcode` | Business location | Retain for operational branch if org continues |
| `region_code` | Analytics | Retain (non-identifying district level) |

### `ea_branch_members`

| Field | Proposed erasure |
|-------|------------------|
| `user_id` | **ON DELETE CASCADE** from auth | Remove membership row before or with auth delete |

---

## 8. Activities (`public.activities`)

| Field | Category | Access | Retention | Lifecycle anonymisation | Proposed erasure |
|-------|----------|--------|-----------|-------------------------|------------------|
| `update` | **High PII risk** (text) | RLS participants | Documented: scrub-or-delete post-archive; **not automated** | No | Delete user-attributable rows OR replace with generic system text |
| `updated_by` | Indirect (role label) | Participants | Retained | No | Retain generic role only |
| `property_id`, `timestamp` | Operational | Participants | Retained | No | Retain on shared property |

**App behaviour:** `ChainContext.tsx` inserts system-formatted stage labels (e.g. "Contracts Exchanged"), not user prose. **Risk:** future features or bugs could insert free text.

---

## 9. Lifecycle & audit tables

### `property_lifecycle_states`

| Field | Lifecycle anonymisation | Proposed erasure |
|-------|-------------------------|------------------|
| State timestamps | Unaffected | Retain on shared property |
| `metadata` jsonb | May contain worker run IDs | Scrub user-specific keys only |

### `property_lifecycle_events`

| Field | Proposed erasure |
|-------|------------------|
| `from_state`, `to_state`, `trigger`, `scenario`, `reason` | Retain (non-identifying operational audit) |
| `metadata` jsonb | Scrub user IDs/emails if present |

### `property_lifecycle_still_active_confirmations`

| Field | Proposed erasure |
|-------|------------------|
| `user_id` | **ON DELETE CASCADE** | Delete rows for user |
| `confirmation_code` | Structured (`still_active`) | Delete with row |

### `property_delink_events`

| Field | Proposed erasure |
|-------|------------------|
| `actor_user_id` | Null after erasure |
| `reason_code` | Retain (structured slug) |
| `metadata` jsonb | Scrub PII |

### `chain_completion_events`

| Field | Proposed erasure |
|-------|------------------|
| `actor_user_id` | Null |
| `payload` jsonb | Scrub user refs |
| Dates | Retain for shared transaction audit |

---

## 10. Analytics (`property_analytics_snapshots`)

| Field | Category | Lifecycle anonymisation | Proposed erasure | Phase 1 classification |
|-------|----------|-------------------------|------------------|--------------------------|
| `property_ref`, `chain_ref` | Pseudonymous UUID | Created at snapshot | Retain only if verified anonymous | Random UUID — low direct ID |
| `source_property_id` | **Re-linkage key** | Set at snapshot | Null/delete if re-linkable | **High re-ID risk** |
| `payload.postcodeDistrict` | Statistical | Included | Retain if k-anonymity verified | **Medium** small-area risk |
| `payload.regionCode` | Statistical | Included | Likely retain | Low |
| `payload` metrics/booleans | Statistical | Included | Likely retain | Low |
| `captured_at` | Temporal | Permanent | Low alone | Low–medium combined |

**Phase 1 verdict:** **Pseudonymous / potentially re-identifiable** — not verified anonymous for RTBF retention.

**Builder exclusions** (`lib/lifecycle/analyticsSnapshot.ts`): emails, names, full addresses, live user IDs.

See [Architecture — Analytics classification](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md#analytics-snapshots--anonymity-classification).

---

## 11. Email & communications

### `email_events`

| Field | Category | Retention today | Proposed retention | Proposed erasure |
|-------|----------|-----------------|-------------------|------------------|
| `recipient_email` | Direct ID | **Indefinite** | **90 days raw → transform** | Redact/hash on RTBF immediately |
| `sent_by` | Direct ID | Until auth delete | 90 days / null on erasure | Null |
| `template`, `status`, timestamps | Audit/metrics | Indefinite | **24 months** | Retain |
| `provider_message_id` | Processor ref | Indefinite | **12 months** | Retain until Resend deleted |
| `error_message` | Potentially personal | Indefinite | **90 days** | Scrub |
| `provider_events` jsonb | Potentially personal | Indefinite | **90 days** | Scrub |

Full proposal: [Retention Schedule](./GDPR_DATA_RETENTION_SCHEDULE.md#email-events-retention-proposal). **No deletion jobs in Phase 1.**

### Email templates (in transit via Resend)

Templates may include: names, **full property addresses** (homeowner invitation, property claimed), magic links tied to identity.

**Dormancy warning template:** intentionally avoids address (verified in `docs/COMMUNICATIONS.md`).

### Supabase Auth transactional emails

Password reset, verification — managed by Supabase Auth, not `email_events`.

---

## 12. Derived / cache tables

### `property_operational_summary`, `chain_operational_summary`

| Risk | Treatment |
|------|-----------|
| Derived from properties/activities; may echo alerts | Refresh or delete cache rows on erasure |

### Upstash Redis (`lib/cache/addressCache.ts`, `rateLimit.ts`)

| Data | TTL | Proposed erasure |
|------|-----|------------------|
| Address search cache (if enabled) | 24h default | Let expire; optional key purge by pattern |
| Rate limit identifiers | Short | May include email/property id — purge on erasure |

**Status:** Redis integration present; address cache usage **confirm at launch**.

---

## 13. Views (read paths — not separate storage)

| View | PII exposed |
|------|-------------|
| `chain_properties_participant` | Own property address/postcode only |
| `chain_properties_ea_operational` | Own or EA-assigned addresses |
| `agent_branch_property_summaries` | Addresses, invite emails (EA scope) |
| `ea_branch_directory` | Branch postcodes, business names |

Erasure must update underlying tables; views inherit corrected data.

---

## 14. Application / client-side ephemeral data

| Location | PII | Risk |
|----------|-----|------|
| Browser cookies (Supabase session) | Session tokens | Cleared on logout |
| `start-move/page.tsx` console.log | Address/postcode | **Removed Phase 1** |
| `chain/[chainId]/page.tsx` debug logs | User/property context | **Removed Phase 1** |
| `join-chain/page.tsx` debug logs | User/property IDs | **Redacted Phase 1** |
| Vercel request logs | **Unknown** — may include URLs | Confirm Vercel log retention/DPA |
| Supabase API logs (Pro: 7-day default) | **Unknown** | Confirm Dashboard settings |

**Not found in repo:** IP address columns, user-agent storage, Sentry, PostHog, Vercel Analytics SDK.

---

## 15. External systems summary

| System | Data transmitted | In-repo evidence | Deletion propagation needed? |
|--------|------------------|------------------|------------------------------|
| **Supabase** | All DB + Auth | Core platform | Yes — Auth + DB |
| **Resend** | Email, HTML bodies, provider IDs | `lib/communications/resend.ts` | Yes — processor deletion request |
| **Vercel** | Hosting, env, cron, logs | `vercel.json`, deployment | Logs expire per plan; confirm DPA |
| **Upstash Redis** | Cache keys/values | `lib/cache/redis.ts` | Purge if PII cached |
| **Stripe** | Customer ID field only | `EaCompany.stripe_customer_id` | **Planned/not implemented** — future DPA + deletion API |
| **Affiliate/analytics SDKs** | — | **Not present** | N/A |

---

## 16. Orphan / discovery gaps

| Gap | Risk | Mitigation (proposed) |
|-----|------|------------------------|
| Base schema tables not in repo | Incomplete inventory | Export canonical DDL from Supabase before implementation |
| `auth.users` deleted before DB scan | Cannot resolve email for `email_events` matching | **Impact report before Auth delete** |
| Email-only invitees without accounts | PII in `invite_email` without `user_id` | Erasure by verified email match across tables |
| JSONB metadata unconstrained | Hidden PII | Schema allow-list + erasure scrub pass |
| `activities.update` free-text policy not enforced in DB | Hidden PII | CHECK constraint or app-only structured inserts |
| Multiple users on one property | Over-erasure | Shared-data assessment step in workflow |
| Backups | PII reappears on restore | Suppression ledger — see backup runbook |

---

## 17. Inventory uncertainty register

Items requiring confirmation outside this repository:

1. Canonical DDL for `profiles`, `properties`, `activities`, `property_members`, `chains`, `chain_nodes`
2. Supabase Auth settings: phone, MFA metadata, custom user metadata keys
3. Production vs Development log drain configuration
4. Whether Upstash address cache is enabled in production
5. Resend data retention and deletion API capabilities (current docs)
6. Stripe integration timeline and customer data scope
7. ICO registration / data protection fee status for Keynetic Ltd (or equivalent entity)
8. Whether any manual/support inbox stores request emails outside DB

---

*This inventory supports architecture design only. It is not legal advice.*
