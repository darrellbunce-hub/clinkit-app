import {
  CHAIN_TILE_LABEL,
  getOperationalSaleChainHeadline,
} from "@/lib/operationalPosition";

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

  positionKind?: "buyer_ready" | "sale";
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

  const headlineTitle = isOperationalSale
    ? getOperationalSaleChainHeadline()
    : displayTitle;

  const positionLabel =
    positionKind === "buyer_ready"
      ? "Buyer Ready"
      : displayTitle;

  return (

    <div className="flex flex-col items-center min-w-[160px]">

      {isOperationalPosition &&
        positionKind === "buyer_ready" && (

        <div
          className="
            mb-3
            rounded-full
            bg-blue-600
            px-3
            py-1
            text-xs
            font-semibold
            text-white
            whitespace-nowrap
          "
        >
          ★ Your Position
        </div>

      )}

      <div
        className={`
          w-20 h-20 rounded-3xl
          border-[3px]
          flex items-center justify-center
          text-5xl bg-white

          ${
            isOperationalPosition
              ? "border-blue-600 ring-4 ring-blue-100"

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
  displayTitle === "Buyer Ready"
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

      {isOperationalPosition &&
        positionKind === "buyer_ready" && (

        <p className="mt-1 text-sm font-medium text-blue-700">
          {positionLabel}
        </p>

      )}

      <p className="text-sm text-slate-600">
        {stageLabel}
      </p>

      <div className="mt-3 w-full h-2 rounded-full bg-slate-200 overflow-hidden">

        <div
          className={`
            h-full rounded-full

            ${
              status === "healthy"
                ? "bg-green-500"

                : status === "pending_connection"
                ? "bg-amber-400"

                : status === "broken_connection"
                ? "bg-red-500"

                : status === "delayed"
                ? "bg-amber-500"

                : "bg-slate-400"
            }
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

    </div>

  );

}
