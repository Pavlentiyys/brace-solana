import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * One button, 6px corners like everything else on the page.
 *
 * Dark ink on the accent rather than white: white on #4b8fff lands at 3.4:1,
 * which clears WCAG AA for large text only, and this label is 14px. Near-black
 * on the same fill is far above the 4.5:1 body threshold.
 *
 * The press is a 1px translate rather than a scale, so the label stays crisp.
 */
export function ButtonLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-panel bg-accent px-5 py-3 text-[14px] font-medium text-canvas",
        "transition-[background-color,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
        "hover:bg-accent-deep active:translate-y-px",
        className,
      )}
    >
      {children}
    </Link>
  );
}
