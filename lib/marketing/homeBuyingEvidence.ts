/**
 * Approved UK home buying evidence for public marketing.
 * Wording aligned to MHCLG June 2026 home buying and selling reform roadmap.
 * Keynetic is not government endorsed — stats validate the problem space only.
 */

export const HOME_BUYING_REFORM_ROADMAP_URL =
  "https://www.gov.uk/government/consultations/home-buying-and-selling-reform/outcome/home-buying-and-selling-reform-roadmap";

export const HOME_BUYING_REFORM_ROADMAP_TITLE =
  "Home buying and selling reform roadmap (June 2026)";

export const HOME_BUYING_EVIDENCE_STATS = [
  {
    id: "completion-time",
    value: "120 days",
    description:
      "Average time from offer accepted to completion, according to the UK Government's June 2026 home buying and selling reform roadmap.",
  },
  {
    id: "fall-through-rate",
    value: "1 in 3",
    description:
      "Approximately one in three property transactions falls through, according to the same Government roadmap.",
  },
  {
    id: "failed-transaction-cost",
    value: "£400m",
    description:
      "Government estimate of annual wasted costs to buyers and sellers associated with failed transactions.",
  },
] as const;

export const HOME_BUYING_KEY_INSIGHT =
  "The problem isn't that people expect their house move to be instant. They expect to know what's happening.";

export const HOME_BUYING_EVIDENCE_ATTRIBUTION =
  "Source: UK Government home buying and selling reform roadmap (June 2026). These figures describe the wider market — Keynetic is not government endorsed.";
