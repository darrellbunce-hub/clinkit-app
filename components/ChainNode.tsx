type ChainNodeProps = {

  propertyNumber: number;

  stageLabel: string;

  progress: number;

  updatedDaysAgo: number;

  currentUserRole: string | null;

  status: string;

};

export default function ChainNode({

  propertyNumber,

  stageLabel,

  progress,

  updatedDaysAgo,

  currentUserRole,

  status,

}: ChainNodeProps) {

  return (

    <div className="flex flex-col items-center min-w-[160px]">

      <div
        className={`
          w-20 h-20 rounded-3xl
          border-[3px]
          flex items-center justify-center
          text-5xl bg-white

          ${
            status === "healthy"
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
  status === "pending_connection" &&
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

      {
  status === "pending_connection" &&
  currentUserRole === "buyer"
    ? "Your Purchase"

    : status === "pending_connection"
    ? "Awaiting Buyer Connection"

    : currentUserRole === "seller"
    ? "Your Sale"

    : currentUserRole === "buyer"
    ? "Buyer Ready"

    : `Property ${propertyNumber}`
}

      </h3>

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