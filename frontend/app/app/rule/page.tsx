import type { Metadata } from "next";

import { ConnectGate } from "@/components/app/connect";
import { RuleScreen } from "@/components/app/rule-screen";

export const metadata: Metadata = { title: "Rule" };

export default function RulePage() {
  return (
    <ConnectGate>
      <RuleScreen />
    </ConnectGate>
  );
}
