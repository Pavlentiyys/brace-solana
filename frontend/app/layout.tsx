import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Sora } from "next/font/google";

import { en } from "@/content/en";
import { site } from "@/content/site";
import { SiteHeader } from "@/components/site/site-header";
import { PlatformProvider } from "@/lib/platform/provider";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name}: a rule that runs when your position nears liquidation`,
    template: `%s | ${site.name}`,
  },
  description: en.hero.subheadline,
  openGraph: {
    type: "website",
    siteName: site.name,
    title: site.name,
    description: en.hero.subheadline,
    url: site.url,
  },
  twitter: {
    card: "summary_large_image",
    title: site.name,
    description: en.hero.subheadline,
  },
};

export const viewport: Viewport = {
  themeColor: "#08090b",
  // Dark only, declared rather than inferred. See the theme lock in
  // globals.css: there is no light palette to fall back to.
  colorScheme: "dark",
};

/**
 * Everything shared by both halves of the site and nothing else.
 *
 * The footer still belongs to the marketing layout: a panel somebody checks on a
 * phone during a fall does not need a column of links under it.
 *
 * `PlatformProvider` moved up here so the header can offer the wallet on every
 * page. It costs nothing on the landing page: the provider only detects an
 * injected extension, and the snapshot query that polls the chain is gated on
 * `address !== null`, so nothing is fetched until somebody connects.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // The landing page anchors scroll smoothly; route transitions should not.
      // Without this Next warns and jumps between routes animate.
      data-scroll-behavior="smooth"
      className={`${jetbrainsMono.variable} ${sora.variable} h-full antialiased`}
    >
      <body className="grain flex h-full min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-panel focus:bg-accent focus:px-4 focus:py-2 focus:text-[14px] focus:text-canvas"
        >
          {en.nav.skipToContent}
        </a>

        <PlatformProvider>
          <SiteHeader />
          {children}
        </PlatformProvider>
      </body>
    </html>
  );
}
