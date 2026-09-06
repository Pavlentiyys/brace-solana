import Link from "next/link";
import type { ReactNode } from "react";

import { Wordmark } from "@/components/site/mark";
import { Container } from "@/components/ui/section";
import { en } from "@/content/en";
import { site } from "@/content/site";

function FooterItem({ label, href }: { label: string; href: string | null }) {
  if (!href) {
    return <li className="text-ink-faint">{label}</li>;
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
            <FooterItem label={en.footer.app} href="/chat" />
            <FooterItem label={en.docs.title} href="/docs" />
            <FooterItem label={en.footer.exit} href="/docs/exit" />
          </FooterColumn>

          <FooterColumn title="Project">
            <FooterItem label={en.footer.program} href={site.program.explorerUrl} />
            <FooterItem label={en.footer.github} href={site.links.github} />
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
