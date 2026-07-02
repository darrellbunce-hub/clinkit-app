export default function CommandCentreSectionHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-slate-900">
        {title}
      </h2>

      {description ? (
        <p className="mt-1.5 text-sm text-slate-600">
          {description}
        </p>
      ) : null}
    </div>
  );
}
