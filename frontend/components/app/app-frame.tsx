"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Note } from "@/components/app/ui";
import { en } from "@/content/en";
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

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status, world } = usePlatform();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {pathname === "/chat/faucet" ? null : <DemoBanner />}

      {/* `min-h-0` is what lets the conversation own its own scroll: without it
          this flex child refuses to shrink below its content and the whole page
          scrolls instead, which is what put the composer on top of the
          messages. */}
      <div className="mx-auto flex w-full min-h-0 max-w-[1200px] flex-1 flex-col px-5 py-6 md:px-8 md:py-8">
        {children}
      </div>

      {pathname !== "/chat/faucet" && world === "demo" && status === "connected" ? (
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
