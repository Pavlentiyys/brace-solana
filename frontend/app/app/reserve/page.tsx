import type { Metadata } from "next";

import { ConnectGate } from "@/components/app/connect";
import { ReserveScreen } from "@/components/app/reserve-screen";

export const metadata: Metadata = { title: "Reserve" };

export default function ReservePage() {
  return (
    <ConnectGate>
      <ReserveScreen />
    </ConnectGate>
  );
}
