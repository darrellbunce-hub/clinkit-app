export default function NetworkBackground() {
  return (
    <>
      <div
        className="
            absolute inset-0
            bg-gradient-to-br
            from-brand-hero-from
            via-brand-hero-via
            to-brand-hero-to
          "
      />

      <div className="absolute top-[-200px] right-[-100px] w-[500px] h-[500px] bg-brand-glow-primary rounded-full blur-3xl" />

      <div className="absolute bottom-[-200px] left-[-100px] w-[400px] h-[400px] bg-brand-glow-secondary rounded-full blur-3xl" />

      <svg
        className="absolute inset-0 w-full h-full opacity-20"
        xmlns="http://www.w3.org/2000/svg"
      >
        <line
          x1="10%"
          y1="20%"
          x2="25%"
          y2="35%"
          stroke="var(--brand-accent-line)"
        />
        <line
          x1="25%"
          y1="35%"
          x2="40%"
          y2="15%"
          stroke="var(--brand-accent-line)"
        />
        <line
          x1="40%"
          y1="15%"
          x2="60%"
          y2="40%"
          stroke="var(--brand-accent-line)"
        />
        <line
          x1="60%"
          y1="40%"
          x2="80%"
          y2="25%"
          stroke="var(--brand-accent-line)"
        />

        <circle
          cx="10%"
          cy="20%"
          r="4"
          fill="var(--brand-accent-node)"
        />
        <circle
          cx="25%"
          cy="35%"
          r="4"
          fill="var(--brand-accent-node)"
        />
        <circle
          cx="40%"
          cy="15%"
          r="4"
          fill="var(--brand-accent-node)"
        />
        <circle
          cx="60%"
          cy="40%"
          r="4"
          fill="var(--brand-accent-node)"
        />
        <circle
          cx="80%"
          cy="25%"
          r="4"
          fill="var(--brand-accent-node)"
        />
      </svg>
    </>
  );
}
