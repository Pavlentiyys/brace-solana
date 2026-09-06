import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppFrame } from "@/components/app/app-frame";

export const metadata: Metadata = {
  title: "Position",
  // Nothing under /chat should be indexed. It is an instrument panel for one
  // person's position, and half of it is a demo world besides.
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="flex min-h-0 flex-1 flex-col">
      <AppFrame>{children}</AppFrame>
    </main>
  );
}
