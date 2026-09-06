import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "How to take everything and leave",
  description:
    "Revoke authorization, withdraw the reserve, disconnect the wallet, and use the deployed program if the web app is unavailable.",
};

export default function ExitDocsLayout({ children }: { children: ReactNode }) {
  return children;
}
