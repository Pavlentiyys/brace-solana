"use client";

import { ActionButton } from "@/components/app/ui";
import { en } from "@/content/en";
import { addressExplorerUrl } from "@/lib/platform/config";
import { usePlatform } from "@/lib/platform/provider";
import { shortenAddress } from "@/lib/core/tx/base58";

/**
 * Lifted out of the app frame so one header can serve both halves of the site.
 *
 * It is the only client leaf in the header. The rest of the header stays a
 * server component, so the landing page ships no more JavaScript than the
 * wallet detection this button needs.
 */
export function WalletButton() {
  const { status, address, connect, disconnect, config, wallet } = usePlatform();

  if (status === "connected" && address) {
    // The demo address is not on any cluster, so it gets neither the cluster label
    // nor an explorer link. A link that resolves to somebody else's account would be
    // worse than no link.
    const onChain = wallet.kind === "injected";

    return (
      <div className="flex shrink-0 items-center gap-3">
        {onChain ? (
          <span className="rounded-panel border border-line px-2 py-0.5 text-[11px] text-ink-faint">
            {config.clusterLabel}
          </span>
        ) : null}
        {onChain ? (
          <a
            href={addressExplorerUrl(config, address)}
            rel="noreferrer noopener"
            target="_blank"
            className="num text-[12px] text-ink-dim underline-offset-4 transition-colors duration-300 hover:text-ink hover:underline"
          >
            {shortenAddress(address)}
          </a>
        ) : (
          <span className="num text-[12px] text-ink-dim">{shortenAddress(address)}</span>
        )}
        <button
          type="button"
          onClick={disconnect}
          className="text-[12px] text-ink-faint transition-colors duration-300 hover:text-ink"
        >
          {en.app.connect.disconnect}
        </button>
      </div>
    );
  }

  return (
    <ActionButton onClick={connect} busy={status === "connecting"}>
      {status === "connecting" ? en.app.connect.connecting : en.nav.connect}
    </ActionButton>
  );
}
