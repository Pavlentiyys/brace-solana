import type { Metadata } from "next";

import { ConnectGate } from "@/components/app/connect";
import { HistoryScreen } from "@/components/app/history-screen";

export const metadata: Metadata = { title: "History" };

export default function HistoryPage() {
  return (
    <ConnectGate>
      <HistoryScreen />
    </ConnectGate>
  );
}
