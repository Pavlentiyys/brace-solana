import type { Metadata } from "next";

import { AuthorizeScreen } from "@/components/app/authorize-screen";
import { ConnectGate } from "@/components/app/connect";

export const metadata: Metadata = { title: "Authorization" };

export default function AuthorizePage() {
  return (
    <ConnectGate>
      <AuthorizeScreen />
    </ConnectGate>
  );
}
