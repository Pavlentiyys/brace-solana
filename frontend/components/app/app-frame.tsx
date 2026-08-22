"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Wordmark } from "@/components/site/mark";
import { ActionButton, Note } from "@/components/app/ui";
import { en } from "@/content/en";
import { cn } from "@/lib/cn";
import { shortenAddress } from "@/lib/core/tx/base58";
import { addressExplorerUrl } from "@/lib/platform/config";
import { demoControls } from "@/lib/platform/demo-source";
import { usePlatform } from "@/lib/platform/provider";

/**
 * The app's own chrome: where you are, which address you are, and whether any of
 * this is real.
 *
 * The demo banner is not dismissible. It is the difference between a panel that
 * describes somebody's money and a panel that describes a simulation, and a reader
 * who scrolled past it once is exactly the reader who needs it on the next screen.
 */

const LINKS = [
  { href: "/app", label: en.app.nav.panel },
  { href: "/app/history", label: en.app.nav.history },
] as const;

function DemoBanner() {
  const { config, wallet, status, world } = usePlatform();
  if (world !== "demo") return null;

  // Three reasons to be in the demo world, and they are not interchangeable. The
  // first is a choice the reader made and can undo; the other two are facts about
  // the deployment.
  const body =
    wallet.kind === "demo" && status === "connected"
      ? en.app.demoBanner.demoWallet
      : config.demoReason === "program_not_deployed"
        ? en.app.demoBanner.programNotDeployed
        : en.app.demoBanner.notConfigured;

  const walletIsReal = wallet.kind === "injected" && status === "connected";

  return (
    <div className="border-b border-line bg-raised">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3 md:px-8">
        <span className="text-[12px] uppercase tracking-[0.08em] text-state-warn">
          {en.app.demoBanner.title}
        </span>
        <p className="max-w-[80ch] flex-1 text-[12px] leading-relaxed text-ink-dim">
          {body}
          {walletIsReal
            ? ` ${en.app.demoBanner.realWallet.replaceAll("{cluster}", config.clusterLabel)}`
            : null}
        </p>
      </div>
    </div>
  );
}

function WalletButton() {
  const { status, address, connect, disconnect, config, wallet } = usePlatform();

  if (status === "connected" && address) {
    // The demo address is not on any cluster, so it gets neither the cluster label
    // nor an explorer link. A link that resolves to somebody else's account would be
    // worse than no link.
    const onChain = wallet.kind === "injected";

    return (
      <div className="flex shrink-0 items-center gap-3">
        {onChain ? (
          <span className="rounded-panel border border-line px-2 py-0.5 text-[11px] uppercase tracking-[0.08em] text-ink-faint">
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
      {status === "connecting" ? en.app.connect.connecting : "Connect"}
    </ActionButton>
  );
}

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status, world } = usePlatform();

  return (
    <div className="flex min-h-full flex-col">
      {pathname === "/app/faucet" ? null : <DemoBanner />}

      <div className="border-b border-line">
        <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-4 px-5 py-3 md:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-5">
            <Link
              href="/"
              className="hidden shrink-0 rounded-panel transition-opacity duration-300 hover:opacity-80 sm:block"
            >
              <Wordmark className="flex items-center gap-2" />
            </Link>
            <nav aria-label="App" className="min-w-0 flex-1 overflow-x-auto">
              <ul className="flex w-max items-center gap-4 text-[13px] sm:gap-6">
                {LINKS.map((link) => {
                  const active = pathname === link.href;
                  return (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "rounded-panel transition-colors duration-300",
                          active ? "text-ink" : "text-ink-dim hover:text-ink",
                        )}
                      >
                        {link.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>

          <WalletButton />
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1200px] flex-1 px-5 py-8 md:px-8 md:py-12">
        {children}
      </div>

      {pathname !== "/app/faucet" && world === "demo" && status === "connected" ? (
        <div className="border-t border-line">
          <div className="mx-auto w-full max-w-[1200px] px-5 py-4 md:px-8">
            <button
              type="button"
              onClick={() => {
                demoControls.reset();
                window.location.reload();
              }}
              className="text-[12px] text-ink-faint underline-offset-4 transition-colors duration-300 hover:text-ink hover:underline"
            >
              {en.app.demoBanner.reset}
            </button>
            <Note className="mt-2 max-w-[70ch]">
              The demo world lives in this tab and starts over when you reload.
            </Note>
          </div>
        </div>
      ) : null}
    </div>
  );
}
