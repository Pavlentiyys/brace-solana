/**
 * The wordmark's glyph: a compact code mark inside a rounded frame. The paired
 * braces keep the name legible at a glance, while the accent chevron carries the
 * product's rule/action idea without looking like a generic wallet icon.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect
        x="2.5"
        y="2.5"
        width="27"
        height="27"
        rx="8"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.28"
      />
      <path
        d="M12 8H10.5A2.5 2.5 0 0 0 8 10.5v3c0 1.4-.8 2.5-2.2 2.5 1.4 0 2.2 1.1 2.2 2.5v3a2.5 2.5 0 0 0 2.5 2.5H12"
        stroke="currentColor"
        strokeWidth="1.7"
        opacity="0.72"
      />
      <path
        d="M20 8h1.5a2.5 2.5 0 0 1 2.5 2.5v3c0 1.4.8 2.5 2.2 2.5-1.4 0-2.2 1.1-2.2 2.5v3a2.5 2.5 0 0 1-2.5 2.5H20"
        stroke="currentColor"
        strokeWidth="1.7"
        opacity="0.72"
      />
      <path d="M13.5 11.5 18.5 16l-5 4.5" stroke="var(--color-accent)" strokeWidth="2.2" />
      <circle cx="24.5" cy="8" r="1.2" fill="var(--color-accent)" />
    </svg>
  );
}

export function Wordmark({
  className,
  size = "default",
}: {
  className?: string;
  size?: "default" | "large";
}) {
  const large = size === "large";

  return (
    <span className={className}>
      <Mark className={`${large ? "h-9 w-9" : "h-6 w-6"} shrink-0`} />
      <span
        className={`${large ? "text-[22px]" : "text-[18px]"} font-brand font-bold tracking-[-0.055em] text-ink`}
      >
        Brace
      </span>
    </span>
  );
}
