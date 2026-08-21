import { ConnectGate } from "@/components/app/connect";
import { Panel } from "@/components/app/panel";

/**
 * The panel, or the way in to it.
 *
 * `ConnectGate` covers PLATFORM.md 2.2 (no wallet, connecting, connected) and the
 * panel covers 2.5. They are one route because they are one question: what is
 * happening to my position, and what is stopping me seeing it.
 */
export default function AppHome() {
  return (
    <ConnectGate>
      <Panel />
    </ConnectGate>
  );
}
