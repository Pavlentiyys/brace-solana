import Link from "next/link";
import type { ReactNode } from "react";

import { Wordmark } from "@/components/site/mark";
import { Container } from "@/components/ui/section";
import { en } from "@/content/en";
import { site } from "@/content/site";

/**
 * A link whose destination may not exist yet. LANDING.md section 6 asks for
 * honest statuses, so an unknown destination renders as dimmed text with a
 * reason rather than as a link that goes nowhere.
 *
 * The note survives once the link appears. It used to render only in place of a
 * missing link, which meant deploying the program to devnet silently deleted the
 * words "not on mainnet" from the page and left a bare link a reader would take
 * for production.
 */
function FooterItem({ label, href, note }: { label: string; href: string | null; note?: string }) {
  const suffix = note ? <span className="text-[12px] text-ink-faint"> ({note})</span> : null;

  if (!href) {
    return (
      <li className="text-ink-faint">
        {label} <span className="text-[12px]">({note ?? en.footer.notYet})</span>
      </li>
    );
  }

  const external = href.startsWith("http");

  return (
    <li>
      <Link
        href={href}
        className="rounded-panel text-ink-dim transition-colors duration-300 hover:text-ink"
        {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      >
        {label}
      </Link>
      {suffix}
    </li>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-[13px] text-ink">{title}</h3>
      <ul className="mt-4 flex flex-col gap-2.5 text-[13px]">{children}</ul>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line py-14">
      <Container>
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Wordmark className="flex items-center gap-2" />
            <p className="mt-5 max-w-[46ch] text-[13px] leading-relaxed text-ink-faint">
              {en.footer.disclaimer}
            </p>
          </div>

          <FooterColumn title={en.footer.docs}>
            <FooterItem label={en.footer.app} href="/app" />
            <FooterItem label={en.docs.title} href="/docs" />
            <FooterItem label={en.footer.exit} href="/docs/exit" />
          </FooterColumn>

          <FooterColumn title="Project">
            <FooterItem
              label={en.footer.program}
              href={site.program.explorerUrl}
              note={site.program.status}
            />
            <FooterItem label={en.footer.audit} href={site.audit.reportUrl} note={site.audit.status} />
            <FooterItem label={en.footer.github} href={site.links.github} />
            <FooterItem label={en.footer.status} href={site.links.status} />
            <FooterItem label={en.footer.contact} href={site.links.contact} />
          </FooterColumn>
        </div>

        <div className="mt-12 border-t border-line pt-6 text-[12px] text-ink-faint">
          <p>
            Built on Solana. Works with{" "}
            <Link
              href={site.protocol.url}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-panel text-ink-dim transition-colors duration-300 hover:text-ink"
            >
              {site.protocol.name}
            </Link>
            .
          </p>
        </div>
      </Container>
    </footer>
  );
}
