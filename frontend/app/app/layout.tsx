import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppFrame } from "@/components/app/app-frame";
import { PlatformProvider } from "@/lib/platform/provider";

export const metadata: Metadata = {
  title: "Position",
  // Nothing under /app should be indexed. It is an instrument panel for one
  // person's position, and half of it is a demo world besides.
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <PlatformProvider>
      <main id="main" className="flex-1">
        <AppFrame>{children}</AppFrame>
      </main>
    </PlatformProvider>
  );
}
