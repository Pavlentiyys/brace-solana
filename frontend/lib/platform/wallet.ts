/**
 * Connecting a wallet, behind an interface with two implementations.
 *
 * PLATFORM.md 2.2 needs four states and not one boolean: no wallet installed, not
 * connected, connecting, connected. They are different situations with different
 * things to do about them, and collapsing them into "connect" leaves a user with no
 * wallet clicking a button that does nothing.
 *
 * The injected port is deliberately small. A full wallet adapter brings a modal, an
 * autoconnect state machine and a wallet list, and none of that can be exercised
 * until there is a program to sign against. What it does cover is the case that
 * matters for reading: a browser with a Solana wallet already installed.
 */

import { isValidPublicKey } from "@/lib/core/tx/base58";
import { DEMO_OWNER } from "@/lib/platform/demo-source";

export interface WalletPort {
  /** Shown on the connect button. */
  label: string;
  available(): boolean;
  connect(): Promise<string>;
  disconnect(): Promise<void>;
}

export class WalletRejected extends Error {
  constructor() {
    super("The wallet request was rejected.");
    this.name = "WalletRejected";
  }
}

/** Connects instantly to a fixed address. Every screen it feeds says it is a demo. */
export const demoWallet: WalletPort = {
  label: "Connect the demo wallet",
  available: () => true,
  connect: async () => DEMO_OWNER,
  disconnect: async () => {},
};

interface InjectedProvider {
  isPhantom?: boolean;
  connect(): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
}

function injected(): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { solana?: InjectedProvider }).solana;
  return candidate && typeof candidate.connect === "function" ? candidate : null;
}

export const injectedWallet: WalletPort = {
  label: "Connect wallet",
  available: () => injected() !== null,

  async connect() {
    const provider = injected();
    if (!provider) throw new Error("No wallet is installed in this browser.");

    let address: string;
    try {
      const result = await provider.connect();
      address = result.publicKey.toString();
    } catch {
      // Every injected wallet reports a dismissed prompt differently. The one thing
      // they agree on is that it throws, and a dismissed prompt is not an error to
      // show a stack trace for.
      throw new WalletRejected();
    }

    if (!isValidPublicKey(address)) {
      throw new Error(`The wallet returned an address this app cannot read: ${address}`);
    }
    return address;
  },

  async disconnect() {
    await injected()?.disconnect();
  },
};
