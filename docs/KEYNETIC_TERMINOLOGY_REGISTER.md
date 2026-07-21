# Keynetic Terminology Register

**Version:** Post–Stage 6 founder sign-off — authoritative for implementation  
**Purpose:** Customer-facing language standards for Stages 3–6 and Stage 3.5  
**Related:** [Founder Decisions](./LAUNCH_CONTENT_FOUNDER_DECISIONS.md) · [Stage 6 Report](./LAUNCH_STAGE6_COMPLETION_REPORT.md) · [Stage 2 Validation](./LAUNCH_STAGE2_TECHNICAL_VALIDATION.md)

Founder decisions (FD-001–FD-041) supersede conflicting entries from the original audit and Stage 2 report.  
Do **not** rename code identifiers in planning or content-only phases.

---

## How to use this register

| Column | Meaning |
|--------|---------|
| **Customer-facing term (approved)** | Preferred wording for UI, emails, marketing |
| **Internal / technical term** | Code, RPC, schema — do not expose to users |
| **Founder decision** | Reference to decision register |
| **Notes** | Implementation guidance |

---

## Core product concepts

| Concept | Customer-facing (approved) | Internal / technical | Founder decision | Notes |
|---------|---------------------------|----------------------|------------------|-------|
| Platform category (public/homeowner) | **Property chain tracking and coordination platform** | — | FD-015 | Not a CRM; **do not** describe homeowners' experience as an "operational platform" (Stage 6 / FD-041) |
| Platform category (estate agent) | **Shared operational platform for property chains** | — | FD-015 | Audience-specific wording OK |
| CRM relationship | **Works alongside your CRM** | — | FD-015, FD-031 | Never CRM replacement |
| Property chain | **Your property chain** / **Property chain** | `chains`, `chain_id` | FD-016 | Glossary on first use for non-industry users |
| Move / transaction | **Your move** (homeowner/public) · **Transaction** (EA/formal) · **Property transaction** (legal) | `property`, operational workflow | FD-016 | Contextual variation permitted |
| Shared truth | **One shared view of the chain** (variations allowed) | Single operational chain model | FD-017 | Do not imply all participants must connect first |
| Brand tagline | **Moving Made Clear** | — | FD-039 | Public marketing headers (homepage `/` + EA landing) · footers · email footer; auth does not hide homepage tagline; app routes logo-only |
| Operational owner | **You manage this property** / **Managed by** (homeowner) · **Operational owner** (EA workspace only) | `operational_owner`, `canEditProperty()` | FD-018, FD-041 | **Never** expose "operational owner" to **homeowner** customers |

---

## Participants & roles

| Concept | Customer-facing | Internal | Founder decision | Notes |
|---------|-----------------|----------|------------------|-------|
| Homeowner | **Homeowner** | `homeowner`, `account_type` | FD-019 | OK |
| Estate agent | **Estate agent** | `estate_agent` | FD-019 | Prefer over standalone "agent" |
| Branch | **Branch** (EA structures only) | branch assignment | FD-019 | Not synonym for estate agent |
| Buyer / seller | **Buyer** / **Seller** | topology roles | FD-019 | When role-specific |
| Delegate | **Can update this property on your behalf** | EA delegation | FD-020 | Keep "delegate" internal |
| Invitation journey | **Invitation** → **Connect** | `property_claim`, invite token | FD-021 | "Claim" is technical — internal where possible |

---

## Chain connection & access

| Concept | Customer-facing | Internal | Founder decision | Notes |
|---------|-----------------|----------|------------------|-------|
| Chain access code | **Chain access code** | `access_code` | FD-022 | Terminology approved; **no masking behaviour change** in content phase |
| Join | **Join existing chain** | `join-chain` | — | OK |
| Connected | **Connected** | linked topology | — | See status labels |
| Searching (no purchase yet) | **Searching for your next home** | `searching placeholder` | FD-023 | **Never** "searching placeholder" |
| Break / disconnect | **Disconnect from chain** | topology break | FD-024 | **APPROVED** — not "Break chain connection" |

---

## Lifecycle & participation exit

| Concept | Customer-facing | Internal | Founder decision | Notes |
|---------|-----------------|----------|------------------|-------|
| Participation de-link | **Leave this transaction** | `participation_delink` | FD-025 | Supporting: "Stop participating in this move" |
| De-link vs erasure | Short note: leaving ≠ requesting deletion of personal data | — | FD-009 | Link to privacy@ / Privacy Policy; unobtrusive |
| Dormancy | Plain explanation of inactivity/release | lifecycle dormancy | FD-026 | Not erasure; avoid "dormancy release" in UI |
| Lifecycle anonymisation | Legal/policy language only if needed | `anonymised` state | FD-026 | Customer copy: what happened / why / next step |
| GDPR erasure | **Request deletion of your personal data** | Privacy Admin RTBF | FD-001 | Legal term: **Right to erasure** via privacy@ |
| Auth account removal | *(No customer-facing concept)* | Auth delete (internal workflow step) | FD-001 | Do **not** use "Remove your login account" |

---

## Progress & intelligence

| Concept | Customer-facing | Internal | Founder decision | Notes |
|---------|-----------------|----------|------------------|-------|
| Chain progress | **Chain progress** | milestone/status progression | FD-027 | Distinct from confidence |
| Chain status (homeowner chain page) | **Chain status** | `computeChainHealth()` / operational conditions | FD-041 | Supersedes FD-038 **Operational status** on homeowner chain page only; values unchanged |
| Chain confidence | **Chain confidence** (system-generated indicator) | confidence algorithm | FD-027–029, FD-035 | **Target:** expected timeframes + buffer — **current code not approved** |
| Estimated completion | **Estimated completion window** | ETA logic | FD-029, FD-035 | Consolidate single source; no "Forecast Engine" |
| User sentiment | **Happy / Unsure / Concerned** (if shown) | user-provided signal | FD-027 | **Third distinct concept** — never conflate with confidence |
| Delay | **Delay reported** | delay reason codes | FD-033 | Structured reasons — good |
| Live updates | **Live updates** · **Live shared updates** · **Live property chain visibility** | polling/refresh | FD-002, FD-030 | Prefer over absolute "real-time" |
| Real-time | Use only if factually supportable | — | FD-002 | Not globally banned |
| Analytics / benchmarks | **Operational insights** | analytics snapshots | FD-003, FD-030 | Regional benchmarking: **Coming soon** on EA page OK |
| Anonymised benchmarks | **Do not use** until verified | — | FD-003, FD-030 | Replaces audit "anonymised regional benchmarks" |

---

## Estate agent commercial

| Concept | Customer-facing | Internal | Founder decision | Notes |
|---------|-----------------|----------|------------------|-------|
| Command centre | **Operational Command Centre** | `/agent` | FD-031 | Approved |
| Homeowner pricing | **Free for homeowners** | — | FD-031 | OK |
| Founding offer | **Founding branch offer** (when billing live) | pricing config | FD-007, FD-031 | **£79/month per branch** (first 20 founding) · **£99/month per branch** standard |
| Subscription unit | **Per estate agent branch** | `ea_branches` (target) | FD-031, FD-036 | Schema stub on company — architecture review before Stripe |
| EA business terms | Separate from platform Terms | — | FD-011 | Commercial/legal document |

---

## Privacy & legal

| Concept | Customer-facing | Internal | Founder decision | Notes |
|---------|-----------------|----------|------------------|-------|
| Privacy contact | **privacy@keynetic.co.uk** | Privacy Admin | FD-008 | Footer + account + privacy page |
| Platform admin | *(not customer-facing)* | `admin@`, platform_admins | FD-008 | Never privacy contact |
| Personal data | **Your information** (product) · **Personal data** (legal) | GDPR classes | FD-032 | Layer plain + legal |
| Property address | Contextually personal data | contextual PII | FD-032 | Not universally public or private |
| Right to erasure CTA | **Request deletion of your personal data** | privacy@ workflow | FD-001 | Not "Delete account" |

---

## Status vocabulary

| Internal status | Customer-facing label | Status |
|-----------------|----------------------|--------|
| `pending_connection` | **Awaiting connection** | **APPROVED** (FD-033) |
| `broken_connection` | **Connection issue** | **APPROVED** |
| `delayed` | **Delay reported** | **APPROVED** |
| `healthy` (topology) | **Connected** | **APPROVED** — not "On track" · not "Healthy" |
| Chain confidence band ≥70 | *(Pending Stage 3.5 redesign)* | Review label "Healthy" |

---

## Chain intelligence — distinct concepts (do not conflate)

| Concept | What it is | What it is NOT |
|---------|------------|----------------|
| **Chain progress** | Milestone/status progression | User opinion |
| **Chain confidence** | Keynetic assessment of progress within **expected stage timeframes** (target design) | User sentiment · guarantee · verified fact |
| **User sentiment** | Happy / Unsure / Concerned (if in product) | Chain confidence |
| **Estimated completion window** | System estimate from recorded data | Guaranteed completion date |

**Pre-copy gate:** FD-035 **Stage 3.5** — current Chain Confidence **not approved**. Tooltip direction approved in principle (FD-029) **after** redesign validated.

**Three distinct concepts (FD-027):** Chain Progress · Chain Confidence · User sentiment — never conflate.

---

## Internal IDs

| Rule | Founder decision |
|------|------------------|
| Remove from routine UI | "Chain #123", "Property 456" — **FD-005 / FD-034** |
| URLs / systems | May retain technical IDs |
| Support contexts | Discreet support reference only where useful |

---

## Terms to avoid in customer-facing copy

| Avoid | Prefer | Reason | Founder decision |
|-------|--------|--------|------------------|
| Delete account (unqualified) | Request deletion of your personal data / privacy@ | No self-serve GDPR delete | FD-001 |
| Remove your login account | Right to erasure request process | Auth delete is internal | FD-001 |
| Delete / Erase (de-link) | Leave this transaction | Participation exit ≠ erasure | FD-025 |
| Anonymised benchmarks | Operational insights / Coming soon | Not verified at launch | FD-003, FD-030 |
| Real-time (absolute) | Live updates / live shared updates | Unless verified | FD-002, FD-030 |
| CRM replacement | Works alongside your CRM | Positioning | FD-015 |
| Operational owner | You manage this property / Managed by | Ownership ambiguity | FD-018, FD-041 |
| Operational status (homeowner) | Chain status | Internal operational conditions | FD-041 |
| Operational (homeowner surfaces) | Plain English — progress, updates, attention needed | Stage 6 homeowner rule | FD-041 |
| Searching placeholder | Searching for your next home | Internal term | FD-023 |
| Break the chain | Disconnect from chain | Implies real-world collapse | FD-024 |
| Forecast Engine | Estimated completion window | Overstates capability | FD-029 |
| On track (for `healthy` status) | Connected | Topology ≠ schedule | FD-033 |
| Lifecycle anonymisation / dormancy release | Plain outcome explanation | Internal mechanics | FD-026 |
| Guaranteed / always / prevents collapse | Designed to / helps / indication only | Unsupported claims | FD-012 |
| 72 hours (as legal deadline) | Statutory period in policy; internal target separate | ICO compliance | — |

---

## Audit overrides (founder review)

| Original audit recommendation | Founder decision |
|------------------------------|------------------|
| LCA-031 / LCA-069: Reduce invitation emails | **Not approved** — retain full body; subject line **separate legal review** (FD-004) |
| LCA-042: Mask/copy access codes | **Not approved** (FD-022) |
| "Remove your login account" | **Rejected** (FD-001) |
| Generic single Terms | **Expanded** to Platform + EA Business Terms (FD-011) |
| Penalty-model confidence as product truth | **Rejected** — Stage 3.5 redesign (FD-035) |
| "Founding branch offer" pending | **APPROVED** per-branch model (FD-007/031) — copy when Stripe ready |
| Generic cookie banner | Stage 2 complete — no banner required for current code (legal caveat) (FD-014) |

---

*Implementation deferred to Stages 3–6 and Stage 3.5 per [Founder Decisions](./LAUNCH_CONTENT_FOUNDER_DECISIONS.md).*
