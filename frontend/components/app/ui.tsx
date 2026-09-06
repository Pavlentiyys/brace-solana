import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The panel's furniture.
 *
 * Same three locks as the landing page (`globals.css`): one accent, one 6px radius,
 * dark only. The app section adds one rule of its own. Status colours are allowed on
 * a WORD inside a readout and nowhere else, so a revoke button is a plain bordered
 * button rather than a red one. Colouring the exit red tells the user that leaving
 * is the dangerous option, which is the opposite of what this product is arguing.
 */

export function Card({
  children,
  className,
  as: Element = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section";
}) {
  return (
    <Element className={cn("rounded-panel border border-line bg-surface p-4 md:p-5", className)}>
      {children}
    </Element>
  );
}

export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-[12px] uppercase tracking-[0.08em] text-ink-faint">{children}</h2>
      {right}
    </div>
  );
}

/** A label and a value on one line, the value monospaced and right aligned. */
export function Row({
  label,
  value,
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-[13px] text-ink-dim">{label}</dt>
      {" "}
      <dd className="flex items-baseline gap-2 text-right">
        {hint ? <span className="text-[11px] text-ink-faint">{hint}{" "}</span> : null}
        <span className="num text-[13px] text-ink">{value}</span>
      </dd>
    </div>
  );
}

export function Rows({ children }: { children: ReactNode }) {
  return <dl className="mt-3 divide-y divide-line">{children}</dl>;
}

type ButtonVariant = "primary" | "quiet";

export function ActionButton({
  children,
  onClick,
  disabled,
  busy,
  variant = "quiet",
  type = "button",
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: ButtonVariant;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-panel px-4 text-[14px] font-medium",
        "transition-[background-color,border-color,color,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
        "active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0",
        variant === "primary"
          ? "bg-accent text-canvas hover:bg-accent-deep"
          : "border border-line-strong text-ink hover:border-accent hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * A short status word, tinted.
 *
 * The tint is never the only signal: the word itself says which state it is, which
 * is the rule `globals.css` sets out for `state-ok` and `state-danger` colliding
 * under deuteranopia.
 */
export function StatusWord({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "danger" | "neutral";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "text-[13px]",
        tone === "ok" && "text-state-ok",
        tone === "warn" && "text-state-warn",
        tone === "danger" && "text-state-danger",
        tone === "neutral" && "text-ink-dim",
      )}
    >
      {children}
    </span>
  );
}

/** A dot that carries the same meaning as the word beside it, never alone. */
export function StatusDot({ tone }: { tone: "ok" | "warn" | "danger" | "neutral" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        tone === "ok" && "bg-state-ok",
        tone === "warn" && "bg-state-warn",
        tone === "danger" && "bg-state-danger",
        tone === "neutral" && "bg-ink-faint",
      )}
    />
  );
}

export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-[12px] leading-relaxed text-ink-faint", className)}>{children}</p>
  );
}

export function PageHeading({
  title,
  lead,
  right,
}: {
  title: string;
  lead?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl leading-tight tracking-tight text-ink md:text-3xl">{title}</h1>
        {lead ? (
          <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-ink-dim">{lead}</p>
        ) : null}
      </div>
      {right}
    </div>
  );
}
