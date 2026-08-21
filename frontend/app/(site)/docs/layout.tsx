import Link from "next/link";

import { Container } from "@/components/ui/section";
import { en } from "@/content/en";

export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  return (
    <div className="py-14 md:py-20">
      <Container>
        <Link
          href="/docs"
          className="rounded-panel text-[13px] text-ink-dim transition-colors duration-300 hover:text-ink"
        >
          {en.docs.title}
        </Link>
        <div className="mt-8">{children}</div>
      </Container>
    </div>
  );
}
