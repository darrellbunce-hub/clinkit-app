type ChainNodeProps = {

    propertyNumber: number;
  
    stageLabel: string;
  
    progress: number;
  
    updatedDaysAgo: number;
  
  };
  
  export default function ChainNode({
    propertyNumber,
    stageLabel,
    progress,
    updatedDaysAgo,
  }: ChainNodeProps) {
  
    return (
  
      <div className="flex flex-col items-center min-w-[160px]">
  
        <div
          className="
            w-20 h-20 rounded-3xl
            border-[3px] border-green-500
            flex items-center justify-center
            text-5xl bg-white
          "
        >
  
          🏠
  
        </div>
  
        <h3 className="mt-4 text-lg font-bold text-slate-900">
          Property {propertyNumber}
        </h3>
  
        <p className="text-sm text-slate-600">
          {stageLabel}
        </p>
  
        <div className="mt-3 w-full h-2 rounded-full bg-slate-200 overflow-hidden">
  
          <div
            className="h-full rounded-full bg-green-500"
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