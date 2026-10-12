import type { Metadata } from "next";

import { ConnectGate } from "@/components/app/connect";
import { Panel } from "@/components/app/panel";

export const metadata: Metadata = { title: "Position" };

export default function PositionPage() {
  return (
    <ConnectGate>
      <Panel />
    </ConnectGate>
  );
}
