import type { Metadata } from "next";

import { ConnectGate } from "@/components/app/connect";
import { RepayNow } from "@/components/app/repay-now";
import { ReserveScreen } from "@/components/app/reserve-screen";

export const metadata: Metadata = { title: "Reserve" };

export default function ReservePage() {
  return (
    <ConnectGate>
      <div className="flex flex-col gap-6">
        <ReserveScreen />
        <RepayNow />
      </div>
    </ConnectGate>
  );
}
