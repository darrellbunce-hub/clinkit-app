import {
  CHAIN_TILE_LABEL,
  getOperationalBuyerReadyHeadline,
  getOperationalSaleChainHeadline,
} from "@/lib/operationalPosition";
import {
  OPERATIONAL_NODE_RING_CLASS,
} from "@/lib/theme/themeTokens";
import { chainNodeProgressFillClasses } from "@/lib/theme/chainViz";

type ChainNodeProps = {

  propertyNumber: number;
  displayTitle: string;
  stageLabel: string;

  progress: number;

  updatedDaysAgo: number;

  currentUserRole: string | null;

  status: string;
  buyer_connected: boolean;

  seller_connected: boolean;

  isOperationalPosition?: boolean;

  positionKind?: "awaiting_buyer" | "buyer_ready" | "sale";
};

export default function ChainNode({

  propertyNumber,

  stageLabel,
  displayTitle,
  progress,

  updatedDaysAgo,

  currentUserRole,

  status,
  buyer_connected,

  seller_connected,

  isOperationalPosition = false,

  positionKind,
}: ChainNodeProps) {

  const isOperationalSale =
    isOperationalPosition &&
    positionKind === "sale";

  const isOperationalBuyerReady =
    isOperationalPosition &&
    positionKind === "buyer_ready";

  const isAwaitingBuyer =
    positionKind === "awaiting_buyer";

  const headlineTitle = isOperationalSale
    ? getOperationalSaleChainHeadline()
    : isOperationalBuyerReady
    ? getOperationalBuyerReadyHeadline()
    : displayTitle;

  return (

    <div className="flex flex-col items-center min-w-[160px]">

      <div
        className={`
          w-20 h-20 rounded-3xl
          border-[3px]
          flex items-center justify-center
          text-5xl bg-surface-card

          ${
            isAwaitingBuyer
              ? "border-amber-400 border-dashed bg-amber-50/50"

              : isOperationalPosition
              ? OPERATIONAL_NODE_RING_CLASS

              : status === "healthy"
              ? "border-green-500"

              : status === "pending_connection"
              ? "border-amber-400"

              : status === "broken_connection"
              ? "border-red-500"

              : status === "delayed"
              ? "border-amber-500"

              : "border-slate-300"
          }
        `}
      >

{
  isAwaitingBuyer
    ? "❓"

    : displayTitle === CHAIN_TILE_LABEL.buyerReady
    ? "🧍"

    : displayTitle === CHAIN_TILE_LABEL.nextHomeSearch
    ? "🔎"

    : status === "pending_connection" &&
      currentUserRole === "buyer"
    ? "⏳"

    : status === "pending_connection"
    ? "🔑"

    : status === "broken_connection"
    ? "⛓️"

    : "🏠"
}

      </div>

      <h3 className="mt-4 text-lg font-bold text-slate-900">

      
      {headlineTitle}

      </h3>

      <p
        className={
          isAwaitingBuyer
            ? "text-sm text-amber-700 font-medium"
            : "text-sm text-slate-600"
        }
      >
        {stageLabel}
      </p>

      {isAwaitingBuyer ? null : (
        <>
          <div className="mt-3 w-full h-2 rounded-full bg-chain-progress-track overflow-hidden">

            <div
              className={`
                h-full rounded-full
                ${chainNodeProgressFillClasses(status)}
              `}
              style={{
                width: `${progress}%`,
              }}
            />

          </div>

          <p className="mt-2 text-sm text-slate-500">
            {progress}% complete
          </p>

          <p className="mt-2 text-xs text-slate-400">
            Updated {updatedDaysAgo} days ago
          </p>
        </>
      )}

    </div>

  );

}
