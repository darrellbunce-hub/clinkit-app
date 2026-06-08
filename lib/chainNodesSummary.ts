/**
 * Participant-safe Buyer Ready summary row from chain_nodes_chain_summary view.
 */
export type ChainNodesChainSummary = {
  id: number;
  chain_id: number;
  node_type: string;
  position: number;
  linked_property_id: number | null;
  status: string;
  progress: number;
  public_stage_label: string;
  latest_activity_at: string | null;
};

/**
 * Maps a summary row into the shape expected by buildChainTopology().
 */
export function summaryToBuyerReadyTopologyInput(
  summary: ChainNodesChainSummary
) {
  return {
    id: summary.id,
    node_type: summary.node_type,
    stage: undefined,
    public_stage_label:
      summary.public_stage_label,
    status: summary.status,
    progress: summary.progress,
    latest_activity_at:
      summary.latest_activity_at,
  };
}

/**
 * Staleness check using summary latest_activity_at (no private activity text).
 */
export function isBuyerReadySummaryStale(
  summary: ChainNodesChainSummary | null | undefined,
  staleAfterDays = 21
): boolean {
  if (!summary?.latest_activity_at) {
    return true;
  }

  const daysSinceUpdate = Math.floor(
    (Date.now() -
      new Date(
        summary.latest_activity_at
      ).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  return daysSinceUpdate > staleAfterDays;
}
