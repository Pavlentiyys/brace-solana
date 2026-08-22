/**
 * Connecting a wallet, behind an interface with two implementations.
 *
 * PLATFORM.md 2.2 needs four states and not one boolean: no wallet installed, not
 * connected, connecting, connected. They are different situations with different
 * things to do about them, and collapsing them into "connect" leaves a user with no
 * wallet clicking a button that does nothing.
 *
 * Which port is in use is independent of which data source is in use. A real Phantom
 * address and a demo world are a coherent pair — the address is who you are, the
 * world is what the app can currently show you — and welding the two together is why
 * connecting used to hand back a hardcoded address.
 *
 * The injected port is deliberately small. A full wallet adapter brings a modal, an
 * autoconnect state machine and a wallet list, and none of that can be exercised
 * until there is a program to sign against.
 */

import { isValidPublicKey } from "@/lib/core/tx/base58";
import { DEMO_OWNER } from "@/lib/platform/demo-source";

export interface WalletPort {
  /** Identifies the implementation, for copy that has to differ between them. */
  readonly kind: "demo" | "injected";
  /** Shown on the connect button. */
  readonly label: string;
  available(): boolean;
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  /**
   * Reconnects without a prompt, but only if this site was already approved.
   * Returns null when it was not, which is the normal first visit.
   */
  eagerConnect(): Promise<string | null>;
  /**
   * Signs and submits, returning the signature.
   *
   * The demo wallet refuses rather than pretending: a fabricated signature that
   * links to nothing is worse than an honest "this wallet cannot sign".
   */
  signAndSend(transaction: SolanaTransaction): Promise<string>;
}

/**
 * The shape Phantom needs, kept structural so this module does not import
 * `@solana/web3.js`. The write path builds the real thing.
 */
export interface SolanaTransaction {
  serialize(config?: { requireAllSignatures?: boolean }): Uint8Array;
}

export class WalletCannotSign extends Error {
  constructor() {
    super("The demo wallet cannot sign. Connect Phantom to send a transaction.");
    this.name = "WalletCannotSign";
  }
}

export class WalletRejected extends Error {
  constructor() {
    super("The wallet request was rejected.");
    this.name = "WalletRejected";
  }
}

export const PHANTOM_INSTALL_URL = "https://phantom.app/download";

/** Connects instantly to a fixed address. Every screen it feeds says it is a demo. */
export const demoWallet: WalletPort = {
  kind: "demo",
  label: "Continue with the demo wallet",
  available: () => true,
  connect: async () => DEMO_OWNER,
  disconnect: async () => {},
  eagerConnect: async () => null,
  signAndSend: async () => {
    throw new WalletCannotSign();
  },
};

interface InjectedProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  signAndSendTransaction?(transaction: unknown): Promise<{ signature: string }>;
  on?(event: string, handler: (payload: unknown) => void): void;
  off?(event: string, handler: (payload: unknown) => void): void;
  removeListener?(event: string, handler: (payload: unknown) => void): void;
}

interface WalletWindow {
  phantom?: { solana?: InjectedProvider };
  solana?: InjectedProvider;
}

/**
 * The provider, preferring Phantom's own namespace.
 *
 * `window.phantom.solana` is what Phantom documents. `window.solana` is the legacy
 * slot and several other wallets also claim it, so it is only used as a fallback and
 * only when it can actually connect.
 */
function injected(): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  const candidate = window as unknown as WalletWindow;

  const namespaced = candidate.phantom?.solana;
  if (namespaced?.isPhantom) return namespaced;

  const legacy = candidate.solana;
  if (legacy?.isPhantom) return legacy;
  return legacy && typeof legacy.connect === "function" ? legacy : null;
}

export function isPhantomInstalled(): boolean {
  return injected()?.isPhantom === true;
}

function readAddress(publicKey: { toString(): string } | null | undefined): string {
  const address = publicKey?.toString() ?? "";
  if (!isValidPublicKey(address)) {
    throw new Error(`The wallet returned an address this app cannot read: ${address}`);
  }
  return address;
}

export const injectedWallet: WalletPort = {
  kind: "injected",

  // A getter rather than a constant: the provider is injected after this module is
  // evaluated, so a value captured at import time would always say "wallet".
  get label() {
    return isPhantomInstalled() ? "Connect Phantom" : "Connect wallet";
  },

  available: () => injected() !== null,

  async connect() {
    const provider = injected();
    if (!provider) throw new Error("No wallet is installed in this browser.");

    let result: { publicKey: { toString(): string } };
    try {
      result = await provider.connect();
    } catch {
      // Every injected wallet reports a dismissed prompt differently. The one thing
      // they agree on is that it throws, and a dismissed prompt is not an error to
      // show a stack trace for.
      throw new WalletRejected();
    }
    return readAddress(result.publicKey);
  },

  async disconnect() {
    await injected()?.disconnect();
  },

  async signAndSend(transaction: SolanaTransaction) {
    const provider = injected();
    if (!provider?.signAndSendTransaction) {
      throw new Error("This wallet cannot sign and send transactions.");
    }
    try {
      const { signature } = await provider.signAndSendTransaction(transaction);
      return signature;
    } catch (error) {
      // Phantom throws code 4001 for a dismissed prompt, same as a rejected connect.
      const code = (error as { code?: number }).code;
      if (code === 4001) throw new WalletRejected();
      throw error;
    }
  },

  async eagerConnect() {
    const provider = injected();
    if (!provider) return null;
    try {
      const result = await provider.connect({ onlyIfTrusted: true });
      return readAddress(result.publicKey);
    } catch {
      // `onlyIfTrusted` throws when the site was never approved. That is the normal
      // first visit, not a failure worth surfacing.
      return null;
    }
  },
};

/**
 * Watches the wallet for changes made outside the app.
 *
 * Switching accounts in Phantom while the panel is open otherwise leaves the screen
 * showing a position that belongs to an address the user is no longer using — which
 * is the worst kind of wrong, because everything on it looks plausible.
 *
 * Returns an unsubscribe function.
 */
export function watchInjectedWallet(
  onChange: (address: string | null) => void,
): () => void {
  const provider = injected();
  if (!provider?.on) return () => {};

  const handleAccountChanged = (payload: unknown) => {
    const publicKey = payload as { toString(): string } | null;
    // Phantom passes the new public key, or null when the account was disconnected
    // rather than switched.
    onChange(publicKey ? publicKey.toString() : null);
  };
  const handleDisconnect = () => onChange(null);

  provider.on("accountChanged", handleAccountChanged);
  provider.on("disconnect", handleDisconnect);

  return () => {
    const off = provider.off ?? provider.removeListener;
    off?.call(provider, "accountChanged", handleAccountChanged);
    off?.call(provider, "disconnect", handleDisconnect);
  };
}

/**
 * Polls briefly for an injected provider.
 *
 * Extensions inject on their own schedule and often after React has already
 * hydrated, so a single check on mount reports "no wallet installed" to people who
 * have one. Returns an unsubscribe function.
 */
export function detectInjectedWallet(
  onDetected: () => void,
  { timeoutMs = 3_000, intervalMs = 150 } = {},
): () => void {
  if (typeof window === "undefined") return () => {};
  if (injected()) {
    onDetected();
    return () => {};
  }

  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    if (injected()) {
      onDetected();
      window.clearInterval(timer);
    } else if (Date.now() - startedAt > timeoutMs) {
      window.clearInterval(timer);
    }
  }, intervalMs);

  return () => window.clearInterval(timer);
}
