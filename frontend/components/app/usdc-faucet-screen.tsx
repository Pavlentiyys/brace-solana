"use client";

import { useState } from "react";

import { ActionButton, Card, CardTitle, Note, PageHeading, StatusWord } from "@/components/app/ui";
import { en } from "@/content/en";
import { shortenAddress } from "@/lib/core/tx/base58";
import { devnetTransactionUrl } from "@/lib/platform/faucet";
import { usePlatform } from "@/lib/platform/provider";

type Phase = "idle" | "requesting" | "success" | "error";

export function UsdcFaucetScreen() {
  const { config, address, status, wallet } = usePlatform();
  const [phase, setPhase] = useState<Phase>("idle");
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connected = status === "connected" && wallet.kind === "injected" && address !== null;
  const busy = phase === "requesting";
  const copy = en.app.usdcFaucet;

  async function requestTokens() {
    if (!connected || !address || busy) return;
    setPhase("requesting");
    setSignature(null);
    setError(null);

    try {
      const response = await fetch("/api/faucet/usdc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const body = (await response.json()) as { error?: unknown; signature?: unknown };
      if (!response.ok || typeof body.signature !== "string") {
        throw new Error(typeof body.error === "string" ? body.error : copy.errors.unknown);
      }
      setSignature(body.signature);
      setPhase("success");
    } catch (caught) {
      setPhase("error");
      setError(caught instanceof Error ? caught.message : copy.errors.unknown);
    }
  }

  return (
    <div className="max-w-[760px]">
      <PageHeading
        title={copy.heading}
        lead={copy.lead}
        right={
          <span className="rounded-panel border border-line px-2 py-1 text-[11px] uppercase tracking-[0.08em] text-ink-faint">
            {config.clusterLabel}
          </span>
        }
      />

      <Card className="mt-8">
        <CardTitle>{copy.cardTitle}</CardTitle>
        <Note className="mt-3">{copy.amountNote}</Note>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <ActionButton
            variant="primary"
            onClick={requestTokens}
            busy={busy}
            disabled={!connected || config.cluster !== "devnet"}
          >
            {busy ? copy.requesting : copy.request}
          </ActionButton>
          {!connected ? <Note>{copy.needsWallet}</Note> : <Note>{copy.connected}</Note>}
        </div>

        <div className="mt-6 border-t border-line pt-5" aria-live="polite">
          {phase === "idle" ? <Note>{copy.idle}</Note> : null}
          {phase === "requesting" ? <StatusWord tone="neutral">{copy.requestingStatus}</StatusWord> : null}
          {phase === "success" ? <StatusWord tone="ok">{copy.success}</StatusWord> : null}
          {phase === "error" && error ? <StatusWord tone="danger">{error}</StatusWord> : null}
          {signature ? (
            <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px]">
              <span className="text-ink-faint">{copy.signature}</span>
              <a
                href={devnetTransactionUrl(signature)}
                target="_blank"
                rel="noreferrer noopener"
                className="num text-accent underline-offset-4 hover:underline"
              >
                {shortenAddress(signature, 8)}
              </a>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
