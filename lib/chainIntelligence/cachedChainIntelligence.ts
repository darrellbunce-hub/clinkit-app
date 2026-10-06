import type { SupabaseClient } from "@supabase/supabase-js";

import { wholeDaysSinceTimestamp } from "@/lib/activityIntelligence";
import {
  describeChainHealth,
  type ChainHealthStatus,
} from "@/lib/chainIntelligence";
import {
  CHAIN_CONFIDENCE_UNAVAILABLE_MESSAGE,
  confidenceBand,
  confidencePresentation,
  toCustomerFacingConfidenceScore,
} from "@/lib/chainIntelligence/presentation";
import { mapChainHealthSlugToLabel } from "@/lib/operationalSummary/mapHealthStatus";

export type CachedChainIntelligenceState = "missing" | "stale" | "fresh";

/** get_chain_operational_intelligence payload. */
export type CachedChainIntelligence = {
  chain_id: number;
  summary_state: CachedChainIntelligenceState;
  computed_at: string | null;
  summary_version: number | null;
  health_status: string | null;
  confidence_score: number | null;
  confidence_band: string | null;
  confidence_unavailable: boolean;
  data_coverage_status: string | null;
  coverage_label: string | null;
  estimated_completion_window: string | null;
  next_recalculation_at: string | null;
  blocked_count: number;
  delay_count: number;
  stale_count: number;
  buyer_ready_stale: boolean;
  requires_replacement_buyer: boolean;
  bottleneck_property_id: number | null;
  stale_property_ids: number[];
  property_clocks: Array<{
    property_id: number;
    activity_clock_at: string | null;
  }>;
};

export async function loadCachedChainIntelligence(
  supabase: SupabaseClient,
  chainId: number
): Promise<CachedChainIntelligence | null> {
  const { data, error } = await supabase.rpc(
    "get_chain_operational_intelligence",
    { p_chain_id: chainId }
  );

  if (error || !data) {
    return null;
  }

  return data as CachedChainIntelligence;
}

export const CHAIN_INTELLIGENCE_CALCULATING_LABEL = "Calculating";

export const CHAIN_STATUS_CALCULATING_MESSAGE =
  "Chain status is being calculated and will appear here shortly.";

export const CHAIN_CONFIDENCE_CALCULATING_MESSAGE =
  "Chain Confidence is being calculated and will appear here shortly.";

export const CHAIN_INTELLIGENCE_UPDATING_NOTE =
  "Updating with the latest chain activity.";

type ChainPropertyRef = { id: number; chainPosition: number };

export type CachedChainIntelligencePresentation<
  T extends ChainPropertyRef
> = {
  state: CachedChainIntelligenceState | "loading";
  chainHealth: ChainHealthStatus | null;
  chainHealthLabel: string;
  chainHealthMessage: string;
  confidenceScore: number | null;
  confidenceLabel: string;
  confidenceColour: string;
  confidenceBg: string;
  confidenceUnavailable: boolean;
  confidenceUnavailableMessage: string;
  coverageLabel: string | null;
  dataCoverage: string | null;
  estimatedChainCompletion: string;
  bottleneckProperty: (T & { lastUpdatedDays: number }) | null;
  staleProperties: Array<T & { lastUpdatedDays: number }>;
};

function toChainHealthStatus(
  slug: string | null
): ChainHealthStatus | null {
  if (!slug) {
    return null;
  }

  const label = mapChainHealthSlugToLabel(slug);

  return label === "Stable" ||
    label === "Active" ||
    label === "At Risk" ||
    label === "Replacement Buyer Required"
    ? label
    : null;
}

/**
 * Chain view presentation of the cached server summary. Property references
 * resolve against the viewer's own chain properties; day counts are taken
 * from the cached activity clock at render time.
 */
export function presentCachedChainIntelligence<
  T extends ChainPropertyRef
>(params: {
  cached: CachedChainIntelligence | null | undefined;
  chainProperties: T[];
  scheduledCompletionMode: boolean;
  referenceDate?: Date;
}): CachedChainIntelligencePresentation<T> {
  const cached = params.cached;
  const unavailable = confidencePresentation({
    score: null,
    band: "Unavailable",
  });

  if (!cached || cached.summary_state === "missing") {
    return {
      state: cached ? "missing" : "loading",
      chainHealth: null,
      chainHealthLabel: CHAIN_INTELLIGENCE_CALCULATING_LABEL,
      chainHealthMessage: CHAIN_STATUS_CALCULATING_MESSAGE,
      confidenceScore: null,
      confidenceLabel: unavailable.label,
      confidenceColour: unavailable.colour,
      confidenceBg: unavailable.bg,
      confidenceUnavailable: true,
      confidenceUnavailableMessage: CHAIN_CONFIDENCE_CALCULATING_MESSAGE,
      coverageLabel: null,
      dataCoverage: null,
      estimatedChainCompletion: CHAIN_INTELLIGENCE_CALCULATING_LABEL,
      bottleneckProperty: null,
      staleProperties: [],
    };
  }

  const referenceDate = params.referenceDate ?? new Date();
  const chainHealth = toChainHealthStatus(cached.health_status);
  const confidenceScore = cached.confidence_unavailable
    ? null
    : toCustomerFacingConfidenceScore(cached.confidence_score);
  const presentation = confidencePresentation({
    score: confidenceScore,
    band: confidenceBand(confidenceScore),
  });

  const clockByPropertyId = new Map(
    cached.property_clocks.map((clock) => [
      clock.property_id,
      clock.activity_clock_at,
    ])
  );

  const withClockDays = (property: T) => ({
    ...property,
    lastUpdatedDays:
      wholeDaysSinceTimestamp(
        clockByPropertyId.get(property.id) ?? null,
        referenceDate
      ) ?? 0,
  });

  const propertyById = new Map(
    params.chainProperties.map((property) => [property.id, property])
  );

  const bottleneck =
    cached.bottleneck_property_id != null
      ? propertyById.get(cached.bottleneck_property_id) ?? null
      : null;

  const staleProperties = (cached.stale_property_ids ?? [])
    .map((propertyId) => propertyById.get(propertyId))
    .filter((property): property is T => property != null)
    .map(withClockDays);

  return {
    state: cached.summary_state,
    chainHealth,
    chainHealthLabel: chainHealth ?? CHAIN_INTELLIGENCE_CALCULATING_LABEL,
    chainHealthMessage: chainHealth
      ? describeChainHealth(chainHealth, params.scheduledCompletionMode)
      : CHAIN_STATUS_CALCULATING_MESSAGE,
    confidenceScore,
    confidenceLabel: presentation.label,
    confidenceColour: presentation.colour,
    confidenceBg: presentation.bg,
    confidenceUnavailable: confidenceScore == null,
    confidenceUnavailableMessage: CHAIN_CONFIDENCE_UNAVAILABLE_MESSAGE,
    coverageLabel: cached.coverage_label,
    dataCoverage: cached.data_coverage_status,
    estimatedChainCompletion: cached.estimated_completion_window ?? "",
    bottleneckProperty: bottleneck ? withClockDays(bottleneck) : null,
    staleProperties,
  };
}
