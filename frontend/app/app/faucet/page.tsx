import type { Metadata } from "next";

import { FaucetScreen } from "@/components/app/faucet-screen";

export const metadata: Metadata = {
  title: "Devnet faucet",
  robots: { index: false, follow: false },
};

export default function FaucetPage() {
  return <FaucetScreen />;
}
