type WorkflowReadOnlyBannerProps = {
  message: string;
};

export default function WorkflowReadOnlyBanner({
  message,
}: WorkflowReadOnlyBannerProps) {
  return (
    <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm font-medium text-amber-800">
        Viewing another participant&apos;s workflow
      </p>

      <p className="mt-1 text-xs leading-relaxed text-amber-700">
        {message}
      </p>
    </div>
  );
}
