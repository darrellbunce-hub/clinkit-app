/**
 * UK address lookup — Ideal Postcodes (Development integration).
 *
 * Status: **IMPLEMENTED IN REPO** — **not** Production-approved.
 * Provider DPA / retention / subprocessor review required before Production.
 *
 * ## Provider
 * - Ideal Postcodes (UK PAF initially)
 * - Server-only adapter: `lib/address/providers/idealPostcodes.ts`
 * - Env: `IDEAL_POSTCODES_API_KEY` (never `NEXT_PUBLIC_*`, never client)
 *
 * ## API surface
 * - `POST /api/address/suggest` — authenticated; autocomplete suggestions
 * - `POST /api/address/resolve` — authenticated; paid retrieve of selected id
 *
 * Ideal Postcodes endpoints used by the adapter:
 * - `GET /v1/autocomplete/addresses?q=…`
 * - `GET /v1/autocomplete/addresses/{id}/gbr`
 *
 * ## Storage
 * No schema migration. Continues to store only:
 * - `properties.address`
 * - `properties.postcode`
 *
 * No UPRN / UDPRN / lat-lng / provider ids stored for MVP.
 *
 * ## Cost controls
 * - Debounce (~300ms) + minimum query length (3) + max length (120)
 * - No lookup on page render
 * - No lookup for Searching placeholders (address not entered)
 * - Suggest is typeahead; resolve only on user selection
 * - Short in-process resolve cache (same selection) to avoid double charge
 * - Per-user in-process rate limits (suggest 30/min, resolve 10/min)
 * - **No Redis required** for address lookup
 *
 * ## Privacy
 * Query text and selected addresses are sent to Ideal Postcodes for lookup.
 * Ideal Postcodes is a **subprocessor candidate** — configure DPA / retention
 * in the Ideal Postcodes dashboard and complete legal review before Production.
 * Do not mark legally approved from this document alone.
 *
 * App logging must not include full address queries or postcodes.
 *
 * ## Fallback
 * Provider outage / timeout / empty balance → manual address entry remains available.
 *
 * ## Verifier
 * `npx tsx scripts/verify-address-lookup-development.ts`
 * `npx tsx scripts/verify-address-lookup-development.ts --execute`
 */

export {};
