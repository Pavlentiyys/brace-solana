import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  demoWallet,
  injectedWallet,
  isPhantomInstalled,
  watchInjectedWallet,
  WalletRejected,
} from "./wallet";

/**
 * The injected path cannot be clicked through in CI — it needs a browser with an
 * extension — so it is exercised here against a stubbed provider instead. These are
 * the cases that decide whether a real user gets connected or gets a button that
 * does nothing, and none of them is reachable from the demo wallet.
 */

const ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

interface Handlers {
  [event: string]: ((payload: unknown) => void)[];
}

function stubProvider(overrides: Record<string, unknown> = {}) {
  const handlers: Handlers = {};
  return {
    handlers,
    provider: {
      isPhantom: true,
      connect: async () => ({ publicKey: { toString: () => ADDRESS } }),
      disconnect: async () => {},
      on(event: string, handler: (payload: unknown) => void) {
        (handlers[event] ??= []).push(handler);
      },
      off(event: string, handler: (payload: unknown) => void) {
        handlers[event] = (handlers[event] ?? []).filter((entry) => entry !== handler);
      },
      ...overrides,
    },
  };
}

function setWindow(value: unknown) {
  (globalThis as { window?: unknown }).window = value;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

test("no wallet is reported when nothing is injected", () => {
  setWindow({});
  assert.equal(injectedWallet.available(), false);
  assert.equal(isPhantomInstalled(), false);
});

test("server rendering does not touch window", () => {
  // `window` is absent entirely here, which is the state during prerender.
  assert.equal(injectedWallet.available(), false);
  assert.equal(injectedWallet.label, "Connect wallet");
});

test("Phantom's own namespace wins over the legacy window.solana slot", async () => {
  const namespaced = stubProvider();
  const legacy = stubProvider({
    isPhantom: false,
    connect: async () => ({ publicKey: { toString: () => OTHER } }),
  });
  setWindow({ phantom: { solana: namespaced.provider }, solana: legacy.provider });

  assert.equal(isPhantomInstalled(), true);
  assert.equal(injectedWallet.label, "Connect Phantom");
  assert.equal(await injectedWallet.connect(), ADDRESS);
});

test("a non-Phantom wallet in the legacy slot is still usable, with generic copy", async () => {
  const legacy = stubProvider({ isPhantom: false });
  setWindow({ solana: legacy.provider });

  assert.equal(injectedWallet.available(), true);
  assert.equal(isPhantomInstalled(), false);
  assert.equal(injectedWallet.label, "Connect wallet");
  assert.equal(await injectedWallet.connect(), ADDRESS);
});

test("a dismissed prompt is WalletRejected, not a stack trace", async () => {
  const { provider } = stubProvider({
    connect: async () => {
      throw new Error("User rejected the request.");
    },
  });
  setWindow({ phantom: { solana: provider } });

  await assert.rejects(() => injectedWallet.connect(), WalletRejected);
});

test("an address the app cannot read is refused rather than stored", async () => {
  const { provider } = stubProvider({
    connect: async () => ({ publicKey: { toString: () => "not-a-pubkey" } }),
  });
  setWindow({ phantom: { solana: provider } });

  await assert.rejects(() => injectedWallet.connect(), /cannot read/);
});

test("eager connect returns null on a first visit instead of prompting", async () => {
  const { provider } = stubProvider({
    connect: async (options?: { onlyIfTrusted?: boolean }) => {
      if (options?.onlyIfTrusted) throw new Error("not trusted");
      return { publicKey: { toString: () => ADDRESS } };
    },
  });
  setWindow({ phantom: { solana: provider } });

  assert.equal(await injectedWallet.eagerConnect(), null);
});

test("eager connect reconnects silently once the site is trusted", async () => {
  const { provider } = stubProvider();
  setWindow({ phantom: { solana: provider } });

  assert.equal(await injectedWallet.eagerConnect(), ADDRESS);
});

test("switching account in the extension is reported", () => {
  const { provider, handlers } = stubProvider();
  setWindow({ phantom: { solana: provider } });

  const seen: (string | null)[] = [];
  const unwatch = watchInjectedWallet((address) => seen.push(address));

  handlers.accountChanged[0]({ toString: () => OTHER });
  handlers.disconnect[0](null);

  assert.deepEqual(seen, [OTHER, null]);

  unwatch();
  assert.equal(handlers.accountChanged.length, 0);
  assert.equal(handlers.disconnect.length, 0);
});

test("disconnecting from the extension reads as null, not as a stale address", () => {
  const { provider, handlers } = stubProvider();
  setWindow({ phantom: { solana: provider } });

  const seen: (string | null)[] = [];
  watchInjectedWallet((address) => seen.push(address));

  // Phantom passes null on `accountChanged` when the account was disconnected
  // rather than switched, and the app must not keep showing the old one.
  handlers.accountChanged[0](null);
  assert.deepEqual(seen, [null]);
});

test("the demo wallet stays available and distinguishable", async () => {
  setWindow({});
  assert.equal(demoWallet.available(), true);
  assert.equal(demoWallet.kind, "demo");
  assert.equal(injectedWallet.kind, "injected");
  assert.equal(await demoWallet.eagerConnect(), null);
});
