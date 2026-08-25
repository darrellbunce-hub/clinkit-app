# Communications

Keynetic transactional email is delivered through a single Resend-backed pipeline in `lib/communications/`.

## Architecture

```
send*() helper
  → render*() (React Email templates in emails/templates/)
  → deliverEmail()
  → queueEmailEvent() → create_email_event RPC
  → Resend provider
  → mark_email_event_sent / mark_email_event_failed
```

Audit records live in `email_events` (append-only provider lifecycle via `append_email_event_provider_event`).

## Configuration

| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Enables live provider sends |
| `EMAIL_SENDING_ENABLED=false` | Disables provider sends (returns `email_sending_disabled`) |
| `EMAIL_FROM` | From address (default `Keynetic <notifications@keynetic.co.uk>`) |
| `BILLING_OPS_ALERT_EMAIL` | Day 1 Stripe billing ops alert recipient (e.g. `admin@keynetic.co.uk`). Unset = detect issues but skip email. |
| `NEXT_PUBLIC_APP_URL` / `APP_URL` / `VERCEL_URL` | Base URL for in-app links |

Application links must never hard-code localhost, staging, or production domains in code — use `getAppBaseUrl()`.

## Templates

Registered in `lib/communications/templateRegistry.ts`. Live templates:

| ID | Purpose |
|----|---------|
| `homeowner-invitation` | EA invites homeowner to connect property |
| `estate-agent-invitation` | Branch team invitation |
| `password-reset` | Account password reset |
| `welcome` | New account welcome |
| `property-claimed` | Successful property connection confirmation (template ready; send not wired) |
| `lifecycle-dormancy-warning` | Connected transaction dormancy warning |

Preview/sample rendering: `renderEmailTemplateById()` · `/dev/emails` · `GET /api/dev/emails/render?template=…`

Stage 5 content verification:

```bash
npx tsx scripts/verify-transactional-email-content.ts
```

## Lifecycle dormancy warning email

Sent when a connected property enters `dormancy_warning` and notification is pending.

### Recipient rules

Recipients are resolved exclusively from `property_operational_identities`:

- `status = 'active'` operational homeowner only
- Verified auth email (`auth.users.email_confirmed_at IS NOT NULL`)
- Property must be in `dormancy_warning` with `dormancy_warning_notified_at IS NULL`

**Excluded in this phase:**

- `property_members` rows (non-authoritative)
- Counterparty participants (`property_counterparty_participants`)
- Delegates (`property_delegates`)
- Estate agents
- Delinked/released identities
- Unverified or banned users

Chain-wide warnings: each affected property's operational homeowner receives their own email. No combined chain email.

### Privacy

The dormancy warning template intentionally avoids:

- Property addresses
- Other participants
- Chain topology
- Free-text fields

Wording is generic: "your property transaction on Keynetic".

### CTA behaviour

Link format: `/property/{propertyId}?lifecycle=dormancy-warning` (via `buildDormancyWarningPropertyUrl()`).

The email link does **not** confirm activity. Authentication is required; confirmation uses `confirm_transaction_still_active()` from the homeowner UI (not yet implemented).

### Idempotency

| Field | Purpose |
|-------|---------|
| `dormancy_warning_notified_at` | Set only after successful send |
| `dormancy_warning_notification_claimed_at` | Short-lived in-flight claim |

Flow:

1. Worker lists pending chain targets (`list_dormancy_warning_notification_targets`)
2. Resolves recipient (`get_dormancy_warning_email_recipient`)
3. Claims send slot (`try_claim_dormancy_warning_notification`)
4. Sends via `sendDormancyWarningEmail()` → `deliverEmail()`
5. On success: `mark_dormancy_warning_notification_sent`
6. On failure/skip: `release_dormancy_warning_notification_claim` (allows retry)

Stale claims expire after the claim lease (default 900s) so crashed workers do not block forever.

### Notification cycle reset

`confirm_transaction_still_active()` clears `dormancy_warning_notified_at` and `dormancy_warning_notification_claimed_at` when returning to `active`. A future stale cycle can send a new warning.

### Verification

```bash
npx tsx scripts/verify-lifecycle-dormancy-warning-email.ts
```

Uses mocked sends by default — does not consume Resend quota during automated verification.

## GDPR / retention

`email_events.recipient_email` is personal data. Lifecycle anonymisation does **not** redact email audit rows. Formal Right to Erasure treatment is defined in [GDPR Data Inventory](./GDPR_DATA_INVENTORY.md) and [GDPR Right to Erasure Architecture](./GDPR_RIGHT_TO_ERASURE_ARCHITECTURE.md). Proposed retention periods: [GDPR Data Retention Schedule](./GDPR_DATA_RETENTION_SCHEDULE.md). No automated purge exists today.
