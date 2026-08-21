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
 * Four short links fit on one line at 375px, so there is no hamburger and no
 * client component behind this.
 */
export function SiteHeader() {
  const links = [
    { href: "/#simulator", label: en.nav.simulator },
    { href: "/#limits", label: en.nav.limits },
    { href: "/#price", label: en.nav.price },
    { href: "/docs", label: en.nav.docs },
  ];

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

          <nav aria-label="Main">
            <ul className="flex items-center gap-4 text-[13px] text-ink-dim sm:gap-6">
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="rounded-panel transition-colors duration-300 hover:text-ink"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </Container>
    </header>
  );
}
