/**
 * The wordmark's glyph: two brace arms with a falling line between them that
 * flattens out instead of continuing down. That is the whole product in one
 * shape, so it does not need a tagline next to it.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <path
        d="M8 3.5H4.5v17H8M16 3.5h3.5v17H16"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.55"
      />
      <path d="M7.5 8.5 12 14h4.5" stroke="var(--color-accent)" strokeWidth="1.75" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <Mark className="h-5 w-5 shrink-0" />
      <span className="text-[15px] font-medium tracking-tight text-ink">Brace</span>
    </span>
  );
}
