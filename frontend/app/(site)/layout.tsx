import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site/site-footer";

/**
 * The marketing side: landing page and docs.
 *
 * A route group, so the URLs are unchanged. It exists to keep the footer off the
 * chat, which does not need a column of links under a position panel. The header
 * is shared and lives in the root layout.
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
