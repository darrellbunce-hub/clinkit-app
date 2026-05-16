type Props = {
    title: string;
    value: string;
  };
  
  export default function MetricCard({
    title,
    value,
  }: Props) {
    return (
      <div
        className="
          bg-white
          rounded-2xl
          border
          border-slate-200
          p-6
          shadow-sm
        "
      >
        <p className="text-sm text-slate-500">
          {title}
        </p>
  
        <h3 className="mt-3 text-4xl font-bold text-slate-900">
          {value}
        </h3>
      </div>
    );
  }