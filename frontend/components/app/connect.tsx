"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { FailureNotice } from "@/components/app/failure-notice";
import { ActionButton, Card, Note, PageHeading, StatusDot } from "@/components/app/ui";
import { en } from "@/content/en";
import { percentFromBps } from "@/lib/core/format";
import { positionLtvBps } from "@/lib/core/position";
import { formatTokenAmount } from "@/lib/core/units";
import { shortenAddress } from "@/lib/core/tx/base58";
import { usePlatform, useSnapshot } from "@/lib/platform/provider";
import type { DiscoveredPosition } from "@/lib/platform/types";
import { PHANTOM_INSTALL_URL } from "@/lib/platform/wallet";

/**
 * Screen 2.2, which is four screens wearing one name.
 *
 * No wallet installed, not connected, connected with nothing found, and connected
 * with something found the agent cannot help with. The spec lists them separately
 * because they need different things from the reader, and the fourth one is the
 * one that gets folded into "no positions" and leaves somebody staring at an empty
 * page wondering whether the app is broken.
 */

export function ConnectGate({ children }: { children: ReactNode }) {
  const { status, walletFailure, connect, wallet, config, injectedAvailable, useDemoWallet } =
    usePlatform();

  if (status === "connected") return <>{children}</>;

  const onInjected = wallet.kind === "injected";
  const clusterNote = en.app.connect.clusterNote.replaceAll("{cluster}", config.clusterLabel);

  return (
    <div className="max-w-[62ch]">
      <PageHeading title={en.app.connect.heading} lead={en.app.connect.body} />

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <ActionButton variant="primary" onClick={connect} busy={status === "connecting"}>
          {status === "connecting" ? en.app.connect.connecting : wallet.label}
        </ActionButton>
        <Note>{en.app.connect.readOnlyNote}</Note>
      </div>

      {onInjected ? (
        <Note className="mt-4">{clusterNote}</Note>
      ) : (
        // Not merely "no wallet": the extension may still be injecting, and the demo
        // wallet may have been chosen deliberately. Both read as "no Phantom yet",
        // and the honest thing to offer is the install link either way.
        <div className="mt-6 rounded-panel border border-line bg-raised p-4">
          <p className="text-[13px] text-ink">{en.app.connect.installTitle}</p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">
            {en.app.connect.installBody}
          </p>
          <a
            href={PHANTOM_INSTALL_URL}
            rel="noreferrer noopener"
            target="_blank"
            className="mt-3 inline-block text-[13px] text-accent underline-offset-4 hover:underline"
          >
            {en.app.connect.installCta}
          </a>
          <Note className="mt-3">{en.app.connect.demoFallbackNote}</Note>
        </div>
      )}

      {injectedAvailable && onInjected ? (
        <button
          type="button"
          onClick={useDemoWallet}
          className="mt-4 text-[12px] text-ink-faint underline-offset-4 transition-colors duration-300 hover:text-ink-dim hover:underline"
        >
          {en.app.connect.demoFallback}
        </button>
      ) : null}

      {walletFailure ? <FailureNotice className="mt-6" failure={walletFailure} onRetry={connect} /> : null}
    </div>
  );
}

const openClassName =
  "ml-auto inline-flex min-h-11 items-center rounded-panel border border-line-strong px-4 text-[13px] text-ink transition-colors duration-300 hover:border-accent";

function PositionCard({
  entry,
  onOpen,
}: {
  entry: DiscoveredPosition;
  onOpen?: (obligation: string) => void;
}) {
  const { select } = usePlatform();
  const { position, supported, guard } = entry;
  const ltv = positionLtvBps(position);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <p className="text-[14px] text-ink">{position.market}</p>
          <p className="num mt-1 text-[11px] text-ink-faint">
            {shortenAddress(position.obligation, 6)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot tone={supported ? "ok" : "neutral"} />
          <span className="text-[12px] text-ink-dim">
            {supported ? en.app.discovery.supportedLabel : en.app.discovery.unsupportedLabel}
          </span>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <div>
          <dt className="text-[11px] text-ink-faint">Collateral</dt>
          <dd className="num mt-1 text-[13px] text-ink">{formatTokenAmount(position.collateral)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-faint">Debt</dt>
          <dd className="num mt-1 text-[13px] text-ink">{formatTokenAmount(position.debt)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-faint">LTV</dt>
          <dd className="num mt-1 text-[13px] text-ink">{percentFromBps(ltv)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-faint">Liquidation</dt>
          <dd className="num mt-1 text-[13px] text-ink-dim">
            {percentFromBps(position.liquidationLtvBps)}
          </dd>
        </div>
      </dl>

      {supported ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <span className="text-[12px] text-ink-dim">
            {guard ? en.app.discovery.guarded : en.app.discovery.notGuarded}
          </span>
          {/* "Open" used to be a link to `/chat`, which is where this list is
              already rendered, so the click selected the position and then
              navigated nowhere. The panel is a message now, so opening a
              position means answering with it. The link stays for the callers
              that are not the conversation. */}
          {guard && onOpen ? (
            <button
              type="button"
              onClick={() => {
                select(position.obligation);
                onOpen(position.obligation);
              }}
              className={openClassName}
            >
              {en.app.discovery.open}
            </button>
          ) : (
            <Link
              href={guard ? "/chat" : "/chat/authorize"}
              onClick={() => select(position.obligation)}
              className={openClassName}
            >
              {guard ? en.app.discovery.open : en.app.discovery.authorize}
            </Link>
          )}
        </div>
      ) : (
        <div className="border-t border-line pt-4">
          <p className="text-[12px] uppercase tracking-[0.08em] text-ink-faint">
            {en.app.discovery.unsupportedHeading}
          </p>
          <Note className="mt-2">{entry.unsupportedReason}</Note>
        </div>
      )}
    </Card>
  );
}

/** The list of borrows, with every state it can be in. */
export function PositionList({ onOpen }: { onOpen?: (obligation: string) => void }) {
  const { snapshot, failure, isLoading } = useSnapshot();

  if (failure) return <FailureNotice failure={failure} />;
  if (isLoading || !snapshot) {
    return <Note>{en.app.discovery.searching}</Note>;
  }

  if (snapshot.positions.length === 0) {
    return (
      <Card>
        <p className="text-[14px] text-ink">{en.app.discovery.noneHeading}</p>
        <p className="mt-3 max-w-[62ch] text-[13px] leading-relaxed text-ink-dim">
          {en.app.discovery.noneBody}
        </p>
        <a
          href="https://app.kamino.finance"
          rel="noreferrer noopener"
          target="_blank"
          className="mt-4 inline-block text-[13px] text-accent underline-offset-4 hover:underline"
        >
          {en.app.discovery.noneLink}
        </a>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {snapshot.positions.map((entry) => (
        <PositionCard key={entry.position.obligation} entry={entry} onOpen={onOpen} />
      ))}
    </div>
  );
}
