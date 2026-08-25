/**
 * Stage 3.5 — Buyer Ready timing catalogue (DESIGN ONLY).
 *
 * Proposed expected timeframes for Buyer Ready dependency scoring.
 * NOT implemented in production. Domain validation recommended before final publication.
 */
import {
  parseExpectedTimeframe,
  type StageTimingDefinition,
} from "@/lib/chainIntelligenceDesign/proposedModel";

export type BuyerReadyTimingClassification =
  | "timed_milestone"
  | "staleness_monitoring"
  | "not_timed"
  | "domain_validation_required";

export type BuyerReadyStageCatalogEntry = StageTimingDefinition & {
  order: number;
  isProgressionDependency: boolean;
  timingClassification: BuyerReadyTimingClassification;
  timingRationale: string;
  delayedEffect: string;
  blockedEffect: string;
  withdrawalEffect: string;
};

/** Proposed catalogue — max durations aligned to purchase-side conveyancing where parallel. */
export const PROPOSED_BUYER_READY_TIMING_CATALOG: BuyerReadyStageCatalogEntry[] =
  [
    {
      order: 0,
      value: "mortgage_preparation",
      label: "Mortgage Preparation",
      nextStep: "Mortgage In Principle",
      expectedTimeframe: parseExpectedTimeframe("1–2 weeks"),
      isProgressionDependency: true,
      timingClassification: "domain_validation_required",
      timingRationale:
        "Legacy default stage in code (`ensureBuyerReadyOnJoin`) but absent from BUYER_READY_STAGES UI list — map to mortgage_in_principle on backfill.",
      delayedEffect: "Treat as early mortgage readiness delay.",
      blockedEffect: "Apply critical blocked cap.",
      withdrawalEffect: "Lost critical dependency.",
    },
    {
      order: 1,
      value: "mortgage_in_principle",
      label: "Mortgage In Principle",
      nextStep: "Mortgage Application Submitted",
      expectedTimeframe: parseExpectedTimeframe("1–2 weeks"),
      isProgressionDependency: true,
      timingClassification: "timed_milestone",
      timingRationale:
        "Early financial readiness — typical lender/agreement window.",
      delayedEffect: "Progressive timing deterioration after grace.",
      blockedEffect: "Critical blocked cap on chain confidence.",
      withdrawalEffect: "Lost critical dependency — major chain impact.",
    },
    {
      order: 2,
      value: "mortgage_application",
      label: "Mortgage Application Submitted",
      nextStep: "Mortgage Offer Received",
      expectedTimeframe: parseExpectedTimeframe("2–4 weeks"),
      isProgressionDependency: true,
      timingClassification: "timed_milestone",
      timingRationale:
        "Lender processing — variable but bounded; **D** for exact bounds until product sign-off.",
      delayedEffect: "Progressive deterioration; bottleneck for chain.",
      blockedEffect: "Critical blocked cap.",
      withdrawalEffect: "Lost critical dependency.",
    },
    {
      order: 3,
      value: "mortgage_offer",
      label: "Mortgage Offer Received",
      nextStep: "Solicitor Instructed",
      expectedTimeframe: parseExpectedTimeframe("1–2 weeks"),
      isProgressionDependency: true,
      timingClassification: "timed_milestone",
      timingRationale: "Instruction handoff to conveyancing.",
      delayedEffect: "Timing deterioration.",
      blockedEffect: "Critical blocked cap.",
      withdrawalEffect: "Lost critical dependency.",
    },
    {
      order: 4,
      value: "solicitor_instructed",
      label: "Solicitor Instructed",
      nextStep: "Searches Ordered",
      expectedTimeframe: parseExpectedTimeframe("1–2 weeks"),
      isProgressionDependency: true,
      timingClassification: "timed_milestone",
      timingRationale: "Parallel with sale-side conveyancing from this point.",
      delayedEffect: "Timing deterioration.",
      blockedEffect: "Critical blocked cap.",
      withdrawalEffect: "Lost critical dependency.",
    },
    {
      order: 5,
      value: "searches_ordered",
      label: "Searches Ordered",
      nextStep: "Survey Booked",
      expectedTimeframe: parseExpectedTimeframe("1–3 weeks"),
      isProgressionDependency: true,
      timingClassification: "timed_milestone",
      timingRationale: "Overlaps with sale-side searches — critical-path not sum.",
      delayedEffect: "Timing deterioration.",
      blockedEffect: "Critical blocked cap.",
      withdrawalEffect: "Lost critical dependency.",
    },
    {
      order: 6,
      value: "survey_booked",
      label: "Survey Booked",
      nextStep: "Survey Completed",
      expectedTimeframe: parseExpectedTimeframe("1–2 weeks"),
      isProgressionDependency: true,
      timingClassification: "timed_milestone",
      timingRationale: "Survey scheduling window.",
      delayedEffect: "Timing deterioration.",
      blockedEffect: "Critical blocked cap.",
      withdrawalEffect: "Lost critical dependency.",
    },
    {
      order: 7,
      value: "survey_completed",
      label: "Survey Completed",
      nextStep: "Enquiries Raised",
      expectedTimeframe: parseExpectedTimeframe("1–2 weeks"),
      isProgressionDependency: true,
      timingClassification: "timed_milestone",
      timingRationale: "Report/enquiries handoff.",
      delayedEffect: "Timing deterioration.",
      blockedEffect: "Critical blocked cap.",
      withdrawalEffect: "Lost critical dependency.",
    },
    {
      order: 8,
      value: "enquiries_raised",
      label: "Enquiries Raised",
      nextStep: "Enquiries Reviewed",
      expectedTimeframe: parseExpectedTimeframe("1–4 weeks"),
      isProgressionDependency: true,
      timingClassification: "timed_milestone",
      timingRationale: "Legal enquiries — often chain bottleneck.",
      delayedEffect: "Strong bottleneck effect when overdue.",
      blockedEffect: "Critical blocked cap.",
      withdrawalEffect: "Lost critical dependency.",
    },
    {
      order: 9,
      value: "enquiries_reviewed",
      label: "Enquiries Reviewed",
      nextStep: "Contracts Signed",
      expectedTimeframe: parseExpectedTimeframe("1–3 weeks"),
      isProgressionDependency: true,
      timingClassification: "timed_milestone",
      timingRationale: "Response/review window.",
      delayedEffect: "Timing deterioration.",
      blockedEffect: "Critical blocked cap.",
      withdrawalEffect: "Lost critical dependency.",
    },
    {
      order: 10,
      value: "contracts_signed",
      label: "Contracts Signed",
      nextStep: "Ready To Exchange",
      expectedTimeframe: parseExpectedTimeframe("1–2 weeks"),
      isProgressionDependency: true,
      timingClassification: "timed_milestone",
      timingRationale: "Pre-exchange readiness.",
      delayedEffect: "Timing deterioration.",
      blockedEffect: "Critical blocked cap.",
      withdrawalEffect: "Lost critical dependency.",
    },
    {
      order: 11,
      value: "ready_to_exchange",
      label: "Ready To Exchange",
      nextStep: "Exchange Contracts",
      expectedTimeframe: parseExpectedTimeframe("1–7 days"),
      isProgressionDependency: true,
      timingClassification: "timed_milestone",
      timingRationale: "Short pre-exchange window.",
      delayedEffect: "Timing deterioration.",
      blockedEffect: "Critical blocked cap.",
      withdrawalEffect: "Lost critical dependency.",
    },
    {
      order: 12,
      value: "exchange_contracts",
      label: "Exchange Contracts",
      nextStep: "Completion Date Agreed",
      expectedTimeframe: parseExpectedTimeframe("1–7 days"),
      isProgressionDependency: true,
      timingClassification: "timed_milestone",
      timingRationale: "Exchange completion step.",
      delayedEffect: "Timing deterioration.",
      blockedEffect: "Critical blocked cap.",
      withdrawalEffect: "Lost critical dependency.",
    },
    {
      order: 13,
      value: "completion_date_agreed",
      label: "Completion Date Agreed",
      nextStep: "Completed",
      expectedTimeframe: parseExpectedTimeframe("1–4 weeks"),
      isProgressionDependency: true,
      timingClassification: "timed_milestone",
      timingRationale: "Completion scheduling.",
      delayedEffect: "Timing deterioration.",
      blockedEffect: "Critical blocked cap.",
      withdrawalEffect: "Lost critical dependency.",
    },
  ];

export function buildBuyerReadyTimingMap(): Map<
  string,
  BuyerReadyStageCatalogEntry
> {
  return new Map(
    PROPOSED_BUYER_READY_TIMING_CATALOG.map((entry) => [
      entry.value,
      entry,
    ])
  );
}

export const CANONICAL_BUYER_READY_TIMING =
  buildBuyerReadyTimingMap();

export const BUYER_READY_STAGE_ORDER =
  PROPOSED_BUYER_READY_TIMING_CATALOG.filter(
    (entry) => entry.value !== "mortgage_preparation"
  ).map((entry) => entry.value);

/**
 * Buyer Ready stage-entry clock (current codebase audit):
 *
 * - Stage update via buyer-ready page inserts activity with stage label (similar to properties).
 * - No `stage_entered_at` on chain_nodes today.
 * - Default join stage `mortgage_preparation` may not match UI stage list.
 * - Derivable from activities when update matches stage label (**B**).
 * - Unavailable when no matching activity (**D**).
 */
export const BUYER_READY_STAGE_ENTRY_AUDIT = {
  authoritativeColumn: null as string | null,
  derivation: "Newest activity matching formatted stage label on chain_nodes update",
  defaultStageMismatch:
    "mortgage_preparation used in ensureBuyerReadyOnJoin but not in BUYER_READY_STAGES",
  proposedColumn: "chain_nodes.stage_entered_at",
} as const;
