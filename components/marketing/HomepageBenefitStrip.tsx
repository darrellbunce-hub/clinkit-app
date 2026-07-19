const benefits = [
  {
    label: "Free for homeowners",
    text: "No cost for homeowners following their move.",
  },
  {
    label: "Live shared updates",
    text: "Updates as connected participants share progress.",
  },
  {
    label: "Secure access",
    text: "Permission-controlled access to your move.",
  },
  {
    label: "Visibility that grows",
    text: "See connected parts of the chain — visibility improves as more participants connect.",
  },
];

export function HomepageBenefitStrip() {
  return (
    <section
      aria-label="Key benefits at a glance"
      className="border-y border-brand-primary/15 bg-gradient-to-r from-brand-primary/[0.06] via-surface-muted to-brand-primary/[0.06]"
    >
      <div className="max-w-6xl mx-auto px-6 py-8 md:py-10">
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-0 lg:divide-x lg:divide-surface-section-border/70">
          {benefits.map((benefit) => (
            <li
              key={benefit.label}
              className="min-w-0 px-0 lg:px-8 first:lg:pl-0 last:lg:pr-0 text-center lg:text-left"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-primary break-words">
                {benefit.label}
              </p>

              <p className="mt-2 text-sm md:text-base text-slate-600 leading-relaxed break-words text-balance">
                {benefit.text}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
