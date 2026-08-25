# mortgage_preparation — Chain Intelligence decision

**Date:** June 2026 · **Stage:** 3.5 implementation

## Finding

`mortgage_preparation` is created as the default Buyer Ready stage in legacy join flows (`ensureBuyerReadyOnJoin`, historical `start-move` inserts) but is **not** listed in `BUYER_READY_STAGES` (customer UI starts at `mortgage_in_principle`).

## Decision (approved implementation)

| Scope | Treatment |
|-------|-----------|
| **New records** | **Option B** — default stage is now `mortgage_in_principle` with `stage_entered_at` set on insert |
| **Chain Intelligence catalogue** | **Option D** — legacy `mortgage_preparation` retains its **own** timing entry (1–2 weeks operational default); **not** silently mapped to MIP |
| **Backfill** | **Option C (conservative)** — match activity label `"Mortgage Preparation"` only; if no reliable match → `stage_entered_at` NULL |
| **Historical semantics** | **Not equivalent** to `mortgage_in_principle` — do not auto-remap stage values in DB |

## Rationale

Silent remapping would misrepresent historical product state. New joins align with the UI workflow. Intelligence scores legacy rows using the dedicated legacy catalogue entry when stage remains `mortgage_preparation`.

## Follow-up (optional product)

- UI prompt for legacy `mortgage_preparation` rows to confirm current stage
- Explicit buyer-withdrawal operational workflow (`lost` dependency state) — not in codebase at Stage 3.5
