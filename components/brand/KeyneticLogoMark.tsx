/**
 * Keynetic logo mark — faithful vector from approved brand sheet.
 * Standard: teal mark on transparent (white backgrounds).
 * Reversed: white mark on transparent (teal / dark backgrounds).
 *
 * Geometry is locked to public/brand/keynetic-logo-mark.svg — do not redraw.
 */
export default function KeyneticLogoMark({
  variant = "standard",
  className = "h-12 w-12",
}: {
  variant?: "standard" | "reversed";
  className?: string;
}) {
  const markColor =
    variant === "reversed"
      ? "var(--brand-logo-dark, #ffffff)"
      : "var(--brand-logo-light, #0E7C7B)";
  const nodeColor = "var(--brand-secondary, #FFC62F)";

  return (
    <svg
      viewBox="0 0 138 76"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path
        d="M 75 73.5 L 5 57 L 5 22 C 5 11.5 5 8.5 14 6.5 L 65 4.5 L 126 7.5"
        stroke={markColor}
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="132" cy="7.5" r="5.5" fill={nodeColor} />
    </svg>
  );
}
