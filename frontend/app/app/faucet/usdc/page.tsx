import type { Metadata } from "next";

import { UsdcFaucetScreen } from "@/components/app/usdc-faucet-screen";

export const metadata: Metadata = {
  title: "Devnet bUSDC faucet",
  robots: { index: false, follow: false },
};

export default function UsdcFaucetPage() {
  return <UsdcFaucetScreen />;
}
