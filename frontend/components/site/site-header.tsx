import Link from "next/link";

import { Wordmark } from "@/components/site/mark";
import { WalletButton } from "@/components/site/wallet-button";
import { Container } from "@/components/ui/section";
import { en } from "@/content/en";

/**
 * One header for the whole site.
 *
 * The marketing pages and the chat used to carry different chrome: different
 * height, different links, a wallet button on one side only. Crossing between
 * them felt like crossing between two products, and the wallet was invisible
 * until you were already inside.
 *
 * So the shell is identical everywhere and the wallet is always reachable. The
 * primary destinations live here; chat-specific navigation is not duplicated below
 * it, so the conversation keeps its vertical space.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-md">
      <Container>
        {/*
          Three zones, not two. The links used to sit right-aligned against the
          wallet button, which read them as its label rather than as navigation.
          A centre column separates the two jobs: where you can go, and who you
          are signed in as.

          Below sm the centre column collapses to the left of the wallet, since
          three zones in 375px leaves nothing in the middle worth centring.
        */}
        <div className="flex h-16 items-center justify-between gap-4 md:grid md:h-20 md:grid-cols-[1fr_auto_1fr]">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 rounded-panel transition-opacity duration-300 hover:opacity-80"
          >
            <Wordmark className="flex shrink-0 items-center gap-2" size="large" />
          </Link>

          <nav
            aria-label="Main"
            className="flex min-w-0 items-center gap-5 overflow-x-auto sm:gap-7 md:justify-center"
          >
            <Link
              href="/docs"
              className="whitespace-nowrap rounded-panel text-[13px] text-ink-dim transition-colors duration-300 hover:text-ink"
            >
              {en.nav.docs}
            </Link>
            <Link
              href="/chat"
              className="whitespace-nowrap rounded-panel text-[13px] text-ink-dim transition-colors duration-300 hover:text-ink"
            >
              {en.nav.app}
            </Link>
            <Link
              href="/chat/analytics"
              className="whitespace-nowrap rounded-panel text-[13px] text-ink-dim transition-colors duration-300 hover:text-ink"
            >
              {en.nav.analytics}
            </Link>
          </nav>

          <div className="flex justify-end">
            <WalletButton />
          </div>
        </div>
      </Container>
    </header>
  );
}
