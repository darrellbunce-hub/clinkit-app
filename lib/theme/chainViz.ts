export type ChainConnectorState =
  | "connected"
  | "broken"
  | "awaiting"
  | "neutral";

export function chainConnectorClasses(
  state: ChainConnectorState
): string {
  const base = "w-24 h-1 rounded-full";

  switch (state) {
    case "connected":
      return `${base} bg-chain-connector-healthy`;
    case "broken":
      return `${base} bg-red-400`;
    case "awaiting":
      return `${base} bg-amber-400`;
    case "neutral":
      return `${base} bg-chain-connector-neutral`;
  }
}

/** Dashed amber connector before the operational sale when awaiting a purchaser. */
export function chainAwaitingBuyerConnectorClasses(): string {
  return "w-24 border-t-4 border-dashed border-amber-400";
}

export function chainNodeProgressFillClasses(
  status: string
): string {
  switch (status) {
    case "healthy":
      return "bg-chain-progress-fill";
    case "pending_connection":
      return "bg-amber-400";
    case "broken_connection":
      return "bg-red-500";
    case "delayed":
      return "bg-amber-500";
    default:
      return "bg-chain-connector-neutral";
  }
}
