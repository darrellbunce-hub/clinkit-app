# Stage 5 Completion Report — Transactional Email Content

**Date:** 21 July 2026  
**Status:** **FOUNDER_APPROVED_COMPLETE**  
**Founder sign-off:** 21 July 2026

**Authority:** [Founder Decisions](./LAUNCH_CONTENT_FOUNDER_DECISIONS.md) · [Stage 4 Report](./LAUNCH_STAGE4_COMPLETION_REPORT.md) · [Communications](./COMMUNICATIONS.md) · [Production Readiness Checklist](./PRODUCTION_READINESS_CHECKLIST.md)

---

## Summary

Stage 5 audited all transactional email templates and send paths, implemented founder-approved content improvements (invite → connect terminology, Stage 4 product truth, consistent transactional footer), and documented active vs unwired templates.

**Founder-approved complete.** Legal policy drafts remain **DRAFT_FOR_LEGAL_REVIEW** (separate from Stage 5 sign-off).

**Not started:** Stage 6 · Pre-Launch Operational Readiness **implementation** · Stripe/billing · Production deployment · Auth behaviour changes · email architecture changes.

---

## Outstanding items (must not be lost)

These items are **explicitly recorded** at founder sign-off. They are **not** resolved by Stage 5 approval.

| # | Item | Status / action |
|---|------|-----------------|
| 1 | **FD-004 — invitation address exposure** | **PENDING_LEGAL_REVIEW.** Full property address **retained in body** (founder-approved). Full address **retained in subject for now** (`Connect {address} on Keynetic`). Subject-line exposure requires explicit legal/privacy review **before Production launch**. **Do not change body or subject automatically** without the outcome of that review. |
| 2 | **Supabase Auth email templates** | **Manual Production readiness verification required:** `reset-password` and `confirm-signup`. Confirm live Supabase Dashboard configuration and content before Production launch. See `docs/AUTH_ARCHITECTURE.md`. |
| 3 | **`NEXT_PUBLIC_APP_URL`** | **Pre-Launch requirement** — recorded in [Production Readiness Checklist §13](./PRODUCTION_READINESS_CHECKLIST.md). Before Production launch, verify all transactional email links resolve to the approved Production Keynetic origin. Development, Preview, localhost, or incorrect environment URLs must not appear in Production transactional emails. |
| 4 | **`RESEND_API_KEY` and sender/domain** | **Pre-Launch requirement** — verify approved Resend sender/domain configuration in Production. Do not expose or document secret values. |
| 5 | **Unwired templates** | **Welcome** and **Property connected** (`property-claimed`) remain **inactive** — no production send path. Must not be described elsewhere as active customer communications unless send paths are implemented and verified. |
| 6 | **FD-039 — “Moving Made Clear” tagline** | **Resolved at Stage 6** — see [Stage 6 report](./LAUNCH_STAGE6_COMPLETION_REPORT.md) · FD-039 |
| 7 | **Transactional vs marketing** | Preserve distinction: current templates are **transactional**; future marketing categories remain registry placeholders only (`marketing-emails`, etc.). |
| 8 | **Invite → Connect terminology** | **Founder-approved and preserved** for customer-facing transactional copy (Invitation → Connect; avoid primary “Claim” language). Internal claim architecture unchanged. |
| 9 | **Stage 6** | **FOUNDER_APPROVED_COMPLETE** (21 Jul 2026). Next programme: Pre-Launch Operational Readiness — **not started**. |

---

## 1. Complete email inventory

| Template ID | File | Active send? | Trigger / send path |
|-------------|------|--------------|---------------------|
| `homeowner-invitation` | `HomeownerInvitation.tsx` | **Yes** | EA resend from Command Centre → `POST /api/communications/homeowner-invitation` → `sendHomeownerInvitation()` |
| `estate-agent-invitation` | `EstateAgentInvitation.tsx` | **Yes** | Branch team invite → `POST /api/communications/estate-agent-invitation` → `sendEstateAgentInvitation()` |
| `lifecycle-dormancy-warning` | `DormancyWarning.tsx` | **Yes** | Lifecycle worker → `processDormancyWarningNotifications()` → `sendDormancyWarningEmail()` |
| `property-claimed` | `PropertyClaimed.tsx` | **No (unwired)** | `sendClaimSuccessful()` exists; no production caller |
| `welcome` | `WelcomeEmail.tsx` | **No (unwired)** | `sendWelcomeEmail()` exists; no production caller |
| `password-reset` | `PasswordReset.tsx` | **No (reference only)** | Production reset via **Supabase Auth** `resetPasswordForEmail()` — see `docs/AUTH_ARCHITECTURE.md` |
| `invitation-reminder` | — | **Future** | Registry placeholder only |
| `invitation-expired` | — | **Future** | Registry placeholder only |
| `chain-update` | — | **Future** | Registry placeholder only |
| `completion-confirmed` | — | **Future** | Registry placeholder only |

### Supabase Auth emails (not in repo templates)

| Email | Configuration |
|-------|----------------|
| Email verification (signup) | Supabase **Confirm signup** template — manual Dashboard config |
| Password reset | Supabase **Reset password** template — manual Dashboard config per `docs/AUTH_ARCHITECTURE.md` |
| Magic link / other | Not used in current journeys |

---

## 2. Active vs unused

**Active (3):** homeowner invitation · estate-agent invitation · dormancy warning

**Unwired templates (3):** welcome · property connected confirmation · password reset (Keynetic template is reference; Supabase sends production reset)

**Future registry entries (5):** invitation reminder/expired · chain update · completion confirmed · marketing · notification categories

---

## 3. Sender / metadata

| Field | Value |
|-------|--------|
| From | `Keynetic <notifications@keynetic.co.uk>` (`EMAIL_FROM` override) |
| Provider | Resend (`lib/communications/resend.ts`) |
| Audit | `email_events` via `create_email_event` RPC — stores template, recipient_email, property_id, chain_id, invitation_id (no address in metadata) |
| Links | `getAppBaseUrl()` — must set `NEXT_PUBLIC_APP_URL` / `APP_URL` in each environment |

---

## 4. Files changed

- `emails/templates/HomeownerInvitation.tsx`
- `emails/templates/EstateAgentInvitation.tsx`
- `emails/templates/WelcomeEmail.tsx`
- `emails/templates/PropertyClaimed.tsx`
- `emails/templates/PasswordReset.tsx`
- `emails/templates/DormancyWarning.tsx`
- `emails/components/Footer.tsx`
- `emails/components/ContentContainer.tsx`
- `lib/communications/templateRegistry.ts`
- `scripts/verify-transactional-email-content.ts` *(new)*
- `docs/COMMUNICATIONS.md`
- `docs/LAUNCH_CONTENT_FOUNDER_DECISIONS.md`
- `docs/LAUNCH_STAGE5_COMPLETION_REPORT.md` *(this file)*

---

## 5–10. Content changes (summary)

### Homeowner invitation
- Invite → connect terminology; CTA **Connect your property**
- Stage 4 positioning (shared view, free, partial chain, not independently verified)
- Preheader **no longer includes full address** (body retains address per FD-004)
- Subject unchanged: `Connect {address} on Keynetic` — **FD-004 legal review pending**

### EA invitation
- Coordination platform + **works alongside your CRM**
- Branch/workspace context; no enterprise/billing claims

### Welcome (unwired)
- Stage 4 positioning; live updates; free for homeowners; useful next steps

### Property connected (unwired)
- Customer copy uses **connected** terminology
- Subject changed to **Your property is connected on Keynetic** (no address in subject — minimisation for confirmation email)

### Password reset (reference)
- Clear security copy; no property data; documents Supabase as production sender

### Dormancy warning
- Footer reason added; already minimises address (unchanged body)

---

## 11. Property-address exposure (FD-004)

| Location | Homeowner invitation | Property connected | Dormancy |
|----------|---------------------|-------------------|----------|
| **Subject** | Full address (**FD-004 approved body; subject legal review pending**) | No address (Stage 5 change) | No address |
| **Preheader** | No full address (Stage 5) | Generic | Generic |
| **Body** | Full address (**founder-approved FD-004**) | Full address | No address |

---

## 12. Personal-data / minimisation

- **email_events:** recipient email + optional property_id/chain_id/invitation_id — no address stored
- **Resend payload:** to, subject, html, text only — no custom metadata with PII
- **Invitation links:** token in URL query (`/claim?token=…`, `/estate-agents/join?token=…`) — required for mechanism; not duplicated in subject
- **No access codes, internal IDs, or chain IDs** in visible email copy

---

## 13. Link / CTA safety

- Invitation links built via `buildServerClaimInvitationUrl` / `buildServerEaBranchInvitationUrl` using `getAppBaseUrl()`
- Password reset uses `buildPasswordRecoveryConfirmUrl(window.location.origin)` → Supabase template must use `RedirectTo` + `TokenHash` (documented)
- Routes exist: `/claim`, `/estate-agents/join`, `/dashboard`, `/property/{id}?lifecycle=dormancy-warning`
- **Production risk:** unset `NEXT_PUBLIC_APP_URL` falls back to localhost — operational config requirement (Pre-Launch Readiness)

---

## 14. Footer / privacy

Transactional footer now includes:
- Privacy Policy link · privacy@ · account settings
- Template-specific “why you received this” reason
- Transactional-not-marketing distinction

---

## 15. Brand consistency

- Header: Keynetic icon + wordmark (unchanged)
- Footer tagline: **Shared visibility for property chains** (Stage 4 aligned)

---

## 16. “Moving Made Clear” tagline

| Finding | Detail |
|---------|--------|
| **In transactional emails** | **Not present** anywhere in repo |
| **Previously removed** | No git history of tagline in email templates in current codebase |
| **Stage 6 follow-up** | Founder requested explicit Stage 6 item: review tagline restoration across app + email branding (do not auto-restore in Stage 5) |

Recorded in founder decisions register as **FD-039** (Stage 6).

---

## 17. Claims qualified

Removed/avoided across templates:
- real-time / guaranteed visibility / independent verification / enterprise / billing-live implications

---

## 18. Security / privacy defects

**None discovered requiring architectural change.**

---

## 19. Legal review dependencies

| Item | Status |
|------|--------|
| **FD-004** | Body address retained; **subject line exposure** remains pending legal review |
| Policy drafts | Unchanged **PENDING_LEGAL_REVIEW** |

---

## 20. Manual configuration actions

1. **Supabase Dashboard — Reset password template** — align with `docs/AUTH_ARCHITECTURE.md`
2. **Supabase Dashboard — Confirm signup template** — when email verification enabled
3. **Environment — `NEXT_PUBLIC_APP_URL`** — must be correct per environment before live sends
4. **`RESEND_API_KEY`** + **`EMAIL_SENDING_ENABLED`** — required for live sends

---

## 21. Development preview instructions

With `npm run dev`:

1. Open `/dev/emails` (development only)
2. Or `GET /api/dev/emails/render?template=homeowner-invitation` (and other template IDs)
3. Run `npx tsx scripts/verify-transactional-email-content.ts`
4. Run `npx tsx scripts/verify-lifecycle-dormancy-warning-email.ts` (mocked sends)

---

## 22–23. Verification

| Check | Result |
|-------|--------|
| `npm run build` | Pass |
| `npx tsc --noEmit` | Pass |
| `npm run lint` | 55 / 22 / 33 — no regression |
| `verify-transactional-email-content.ts` | Pass |
| `verify-launch-stage3-legal.ts` | Pass |
| `verify-lifecycle-dormancy-warning-email.ts` | *(run separately if Dev DB available)* |
| Chain Intelligence / schema / Auth / GDPR | Unchanged |

---

## 24. Recommendation

**Stage 5 founder-approved complete.**

**Next planned stage:** Stage 6 — Terminology / UX polish (includes FD-039 tagline review). **Not begun.**

**Before Production launch:** complete Pre-Launch transactional email checks in [Production Readiness Checklist §13](./PRODUCTION_READINESS_CHECKLIST.md) and resolve **FD-004** subject-line legal review.

---

*Stage 5 founder-approved complete. Documentation sign-off recorded 21 July 2026. No application behaviour changed in this sign-off step.*
