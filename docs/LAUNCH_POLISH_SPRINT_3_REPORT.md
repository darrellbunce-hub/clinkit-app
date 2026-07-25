# Launch Polish Sprint 3 — Terms Acceptance

## Summary

Mandatory Terms of Use and Privacy Policy acceptance is enforced during account creation for homeowners and estate agents. Acceptance is recorded in an append-only audit table with document version, timestamp, and user ID.

## Changes

### Database

- Migration `supabase/migrations/20260725150000_signup_legal_acceptance.sql`
  - Table `public.legal_acceptances` with `user_id`, `document_type`, `document_version`, `accepted_at`
  - Document types: `terms_of_use`, `estate_agent_terms`, `privacy_policy`
  - RLS: authenticated users can `SELECT` their own rows only; inserts via RPC only
  - RPC `record_signup_legal_acceptances(p_terms_document, p_terms_version, p_privacy_version, p_accepted_at)` — idempotent per user/document/version
  - No backfill for existing users

### Version identifiers

- `lib/legal/constants.ts` — `LEGAL_DOCUMENT_VERSIONS` (`2026-06-v1` for all documents at launch)

### UI

- `components/legal/LegalAcceptanceFields.tsx` — two mandatory checkboxes with prominent document links (`target="_blank"`, `rel="noopener noreferrer"`)
  - Homeowner: Terms of Use + Privacy Policy
  - Estate agent: Estate Agent Terms + Privacy Policy

### Signup integration

- `app/login/page.tsx` — homeowner create account gated on both checkboxes; records acceptance after successful `signUp`
- `app/estate-agents/signup/page.tsx` — estate agent create account with separate terms document, shared privacy policy

### Persistence helpers

- `lib/legal/pendingLegalAcceptance.ts` — sessionStorage queue when email verification prevents an immediate session
- `lib/legal/recordSignupLegalAcceptance.ts` — RPC call, queue, and flush helpers

### Email verification path

- `app/verify-email/page.tsx` — flushes pending acceptance when a session becomes available
- `app/login/page.tsx` and `app/estate-agents/login/page.tsx` — flush pending acceptance after successful login (harmless for existing users with no pending data)

## Non-goals (unchanged)

- Login flows for existing users — no acceptance requirement
- Password policy, Supabase Auth configuration, and authentication behaviour beyond pre-signup checkbox enforcement
- `CollectionPointNotice` remains separate (informational privacy notice per FD-013)

## Validation

```bash
npx tsc --noEmit
npm run build
npx tsx scripts/verify-legal-acceptance-signup.ts
npx tsx scripts/verify-launch-stage3-legal.ts
npx tsx scripts/verify-auth-password-policy.ts
npx tsx scripts/verify-auth-password-checklist-surfaces.ts
npx tsx scripts/verify-login-redirect.ts
```

## Apply migration

```bash
supabase db push
# or your usual migration workflow
```

After migration, new signups record two rows per user (terms + privacy). Existing users without acceptance rows are unaffected and can continue to log in.
