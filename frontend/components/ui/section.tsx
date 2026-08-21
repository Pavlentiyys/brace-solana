import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * One container width and one vertical rhythm for the whole page. Sections
 * differ in layout, never in gutter or measure.
 */
export function Container({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("mx-auto w-full max-w-[1200px] px-5 md:px-8", className)}>{children}</div>;
}

export function Section({
  id,
  children,
  className,
  divided = true,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  /** A hairline instead of a card. Grouping by line, not by box. */
  divided?: boolean;
}) {
  return (
    <section
      id={id}
      className={cn("py-20 md:py-28", divided && "border-t border-line", className)}
    >
      <Container>{children}</Container>
    </section>
  );
}

export function SectionHeading({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "max-w-[20ch] text-3xl leading-[1.1] tracking-tight text-ink md:text-4xl",
        className,
      )}
    >
      {children}
    </h2>
  );
}

export function SectionLead({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("mt-5 max-w-[58ch] text-[15px] leading-relaxed text-ink-dim", className)}>
      {children}
    </p>
  );
}
