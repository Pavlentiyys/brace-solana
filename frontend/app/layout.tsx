import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { en } from "@/content/en";
import { site } from "@/content/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="grain flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-panel focus:bg-accent focus:px-4 focus:py-2 focus:text-[14px] focus:text-canvas"
        >
          {en.nav.skipToContent}
        </a>

        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
