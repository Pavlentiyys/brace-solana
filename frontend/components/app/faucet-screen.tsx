"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { ActionButton, Card, CardTitle, Note, PageHeading, StatusWord } from "@/components/app/ui";
import { en } from "@/content/en";
import { isValidPublicKey, shortenAddress } from "@/lib/core/tx/base58";
import {
  devnetTransactionUrl,
  FaucetError,
  FAUCET_SOL,
  requestDevnetAirdrop,
  waitForAirdropConfirmation,
} from "@/lib/platform/faucet";
import { usePlatform } from "@/lib/platform/provider";

type Phase = "idle" | "requesting" | "confirming" | "success" | "error";

const copy = en.app.faucet;

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  if (!(error instanceof FaucetError)) return copy.errors.unknown;
  return copy.errors[error.code];
}

export function FaucetScreen() {
  const { config, wallet, status, address } = usePlatform();
  const connectedAddress = wallet.kind === "injected" && status === "connected" ? address : null;
  const [manualAddress, setManualAddress] = useState("");
  const [submittedAddress, setSubmittedAddress] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const recipient = manualAddress.trim() || connectedAddress || "";
  const validAddress = isValidPublicKey(recipient);
  const enabledCluster = config.cluster === "devnet";
  const busy = phase === "requesting" || phase === "confirming";

  useEffect(() => () => abortRef.current?.abort(), []);

  function resetAttempt(nextAddress: string) {
    abortRef.current?.abort();
    setManualAddress(nextAddress);
    setSubmittedAddress(null);
    setSignature(null);
    setPhase("idle");
    setFailure(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabledCluster || !validAddress || busy) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let activeSignature = signature;
      if (!activeSignature || submittedAddress !== recipient || phase !== "error") {
        setPhase("requesting");
        setFailure(null);
        setSignature(null);
        setSubmittedAddress(recipient);
        activeSignature = await requestDevnetAirdrop({
          cluster: config.cluster,
          rpcUrl: config.rpcUrl,
          address: recipient,
          signal: controller.signal,
        });
        setSignature(activeSignature);
      }

      setPhase("confirming");
      setFailure(null);
      await waitForAirdropConfirmation({
        rpcUrl: config.rpcUrl,
        signature: activeSignature,
        signal: controller.signal,
      });
      setPhase("success");
    } catch (error) {
      if (isAbort(error)) return;
      setPhase("error");
      setFailure(errorMessage(error));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  const buttonLabel =
    phase === "requesting"
      ? copy.requesting
      : phase === "confirming"
        ? copy.confirming
        : phase === "error" && signature
          ? copy.checkAgain
          : phase === "error"
            ? copy.retry
            : phase === "success"
              ? copy.requestAgain
              : copy.request.replaceAll("{amount}", String(FAUCET_SOL));

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

        <form className="mt-5" onSubmit={submit}>
          <label htmlFor="faucet-address" className="text-[12px] text-ink-dim">
            {copy.addressLabel}
          </label>
          <input
            id="faucet-address"
            name="address"
            value={recipient}
            onChange={(event) => resetAttempt(event.target.value)}
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={recipient.length > 0 && !validAddress}
            aria-describedby="faucet-address-note"
            placeholder={copy.addressPlaceholder}
            className="num mt-2 min-h-11 w-full rounded-panel border border-line-strong bg-canvas px-3 text-[13px] text-ink outline-none transition-colors duration-300 placeholder:text-ink-faint focus:border-accent disabled:opacity-60"
          />
          <div id="faucet-address-note" className="mt-2">
            {connectedAddress && manualAddress.trim() === "" ? (
              <Note>{copy.connectedAddress}</Note>
            ) : (
              <Note>{copy.addressNote}</Note>
            )}
          </div>

          {manualAddress.trim() && connectedAddress && manualAddress.trim() !== connectedAddress ? (
            <button
              type="button"
              onClick={() => resetAttempt("")}
              disabled={busy}
              className="mt-3 text-[12px] text-accent underline-offset-4 hover:underline disabled:opacity-50"
            >
              {copy.useConnected}
            </button>
          ) : null}

          {!enabledCluster ? (
            <div className="mt-5 rounded-panel border border-line bg-raised p-4">
              <StatusWord tone="warn">{copy.devnetOnlyTitle}</StatusWord>
              <Note className="mt-2">{copy.devnetOnlyBody}</Note>
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <ActionButton
              type="submit"
              variant="primary"
              busy={busy}
              disabled={!enabledCluster || !validAddress}
            >
              {buttonLabel}
            </ActionButton>
            <Note>{copy.valueNote}</Note>
          </div>
        </form>

        <div className="mt-6 border-t border-line pt-5" aria-live="polite">
          {phase === "idle" ? <Note>{copy.idle}</Note> : null}
          {phase === "requesting" ? <StatusWord tone="neutral">{copy.requestingStatus}</StatusWord> : null}
          {phase === "confirming" ? <StatusWord tone="warn">{copy.confirmingStatus}</StatusWord> : null}
          {phase === "success" ? <StatusWord tone="ok">{copy.success}</StatusWord> : null}
          {phase === "error" && failure ? <StatusWord tone="danger">{failure}</StatusWord> : null}

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
              {submittedAddress ? (
                <span className="num text-ink-faint">
                  {copy.to} {shortenAddress(submittedAddress, 6)}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
