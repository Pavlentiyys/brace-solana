import Link from "next/link";

import { Wordmark } from "@/components/site/mark";
import { Container } from "@/components/ui/section";
import { en } from "@/content/en";

/**
 * One line at every width, 64px tall, and no call to action.
 *
 * There is no header button on purpose. The page has exactly one call to
 * action and it lives in the hero. A second one here would be the same intent
 * under a different label, which is the fastest way to make a trust-first page
 * read like a funnel.
 *
 * So the app is a destination link styled exactly like the docs link, not a
 * button. It is here because the docs pages otherwise have no way into the app
 * except the footer. In-page anchors were removed so the header never competes
 * with the page's own scroll order.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-md">
      <Container>
        <div className="flex h-16 items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-panel transition-opacity duration-300 hover:opacity-80"
          >
            <Wordmark className="flex items-center gap-2" />
          </Link>

          <nav aria-label="Main" className="flex items-center gap-6">
            <Link
              href="/docs"
              className="rounded-panel text-[13px] text-ink-dim transition-colors duration-300 hover:text-ink"
            >
              {en.nav.docs}
            </Link>
            <Link
              href="/app"
              className="rounded-panel text-[13px] text-ink-dim transition-colors duration-300 hover:text-ink"
            >
              {en.nav.app}
            </Link>
          </nav>
        </div>
      </Container>
    </header>
  );
}
