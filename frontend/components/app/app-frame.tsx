"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Chat } from "@/components/chat/chat";
import { en } from "@/content/en";
import { cn } from "@/lib/cn";
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

/** The four mini pages. Each is one tab; the assistant sits beside all of them. */
const TABS = [
  { href: "/app", label: en.app.tabs.position },
  { href: "/app/rule", label: en.app.tabs.rule },
  { href: "/app/reserve", label: en.app.tabs.reserve },
  { href: "/app/history", label: en.app.tabs.history },
] as const;

function Tabs({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="App" className="-mx-5 flex overflow-x-auto border-b border-line px-5 md:mx-0 md:px-0">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px min-h-11 whitespace-nowrap border-b-2 px-3 pt-2 text-[13px] transition-colors duration-300 first:pl-0",
              active
                ? "border-accent text-ink"
                : "border-transparent text-ink-dim hover:text-ink",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status, world } = usePlatform();
  // The tabbed pages get the assistant beside them. Analytics and the faucets
  // are full-width tools of their own.
  const tabbed = TABS.some((tab) => tab.href === pathname);

  return (
    <div className="flex flex-1 flex-col">
      {pathname.startsWith("/app/faucet") ? null : <DemoBanner />}

      <div className="mx-auto w-full max-w-[1200px] flex-1 px-5 py-6 md:px-8 md:py-8">
        {tabbed ? (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10">
            <div className="flex min-w-0 flex-col gap-6">
              <Tabs pathname={pathname} />
              {children}
            </div>
            <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
              <div className="flex h-[70vh] min-h-[460px] flex-col rounded-panel border border-line bg-surface p-4 lg:h-[calc(100vh-8rem)]">
                <Chat compact />
              </div>
            </aside>
          </div>
        ) : (
          children
        )}
      </div>

      {!pathname.startsWith("/app/faucet") && world === "demo" && status === "connected" ? (
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
