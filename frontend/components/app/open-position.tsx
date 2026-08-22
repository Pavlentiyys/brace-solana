"use client";

import { Connection, PublicKey } from "@solana/web3.js";
import { useState } from "react";

import { ActionButton, Card, CardTitle, Note, Row, Rows } from "@/components/app/ui";
import { en } from "@/content/en";
import { explorerUrl } from "@/lib/platform/config";
import { DEVNET_MARKET, marketAvailableOn, planOpenPosition, planRefresh } from "@/lib/platform/devnet-market";
import { usePlatform } from "@/lib/platform/provider";
import { WalletCannotSign, WalletRejected } from "@/lib/platform/wallet";

/**
 * Opens a real Kamino borrow, signed by the user's own wallet.
 *
 * It has to be their signature: KLend requires the obligation owner to sign
 * `init_obligation`, the deposit and the borrow, so nobody can open a position on
 * somebody else's behalf. What can be done for them is the collateral — the mint
 * authority for this market's tokens is ours, so `tools/devnet/src/fund.ts` hands it
 * out without needing anything from the recipient.
 *
 * Two transactions rather than one. The borrow is validated against an obligation
 * that already holds the collateral, and a single transaction would refresh against
 * the state from before the deposit landed.
 */

const COLLATERAL_TOKENS = 2;
const BORROW_TOKENS = 100;

type Stage = "idle" | "depositing" | "borrowing" | "refreshing" | "done";

export function OpenPosition() {
  const { config, address, wallet, status } = usePlatform();
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [signatures, setSignatures] = useState<string[]>([]);

  if (!marketAvailableOn(config.cluster)) {
    return (
      <Card>
        <CardTitle>{en.app.openPosition.heading}</CardTitle>
        <Note className="mt-3">
          {en.app.openPosition.wrongCluster.replace("{cluster}", DEVNET_MARKET.cluster)}
        </Note>
      </Card>
    );
  }

  const connected = status === "connected" && address !== null;
  const canSign = wallet.kind === "injected";

  async function run() {
    if (!address) return;
    setError(null);
    setSignatures([]);

    const connection = new Connection(config.rpcUrl, "confirmed");
    const owner = new PublicKey(address);

    try {
      const plan = await planOpenPosition({
        connection,
        owner,
        collateralTokens: COLLATERAL_TOKENS,
        borrowTokens: BORROW_TOKENS,
      });

      const sent: string[] = [];
      const stages: Stage[] = ["depositing", "borrowing"];

      for (const [index, transaction] of plan.transactions.entries()) {
        setStage(stages[index]);
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = owner;

        const signature = await wallet.signAndSend(transaction);
        await connection.confirmTransaction(signature, "confirmed");
        sent.push(signature);
        setSignatures([...sent]);
      }

      // KLend marks the obligation stale after a borrow and only recomputes the
      // aggregates inside `refresh_obligation`, so without this the panel would
      // honestly report a debt value of zero.
      setStage("refreshing");
      const refresh = await planRefresh({ connection, owner });
      if (refresh) {
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        refresh.recentBlockhash = blockhash;
        refresh.feePayer = owner;
        const signature = await wallet.signAndSend(refresh);
        await connection.confirmTransaction(signature, "confirmed");
        sent.push(signature);
        setSignatures([...sent]);
      }

      setStage("done");
    } catch (caught) {
      setStage("idle");
      if (caught instanceof WalletRejected) setError(en.app.openPosition.rejected);
      else if (caught instanceof WalletCannotSign) setError(en.app.openPosition.demoWallet);
      else setError((caught as Error).message);
    }
  }

  const busy = stage !== "idle" && stage !== "done";

  return (
    <Card>
      <CardTitle>{en.app.openPosition.heading}</CardTitle>
      <p className="mt-3 max-w-[68ch] text-[13px] leading-relaxed text-ink-dim">
        {en.app.openPosition.body}
      </p>

      <Rows>
        <Row label="Collateral" value={`${COLLATERAL_TOKENS} ${DEVNET_MARKET.collateral.label}`} />
        <Row label="Borrow" value={`${BORROW_TOKENS} ${DEVNET_MARKET.debt.label}`} />
        <Row label="Market" value={`Kamino on ${config.clusterLabel}`} />
      </Rows>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <ActionButton variant="primary" onClick={run} busy={busy} disabled={!connected || !canSign}>
          {stage === "idle" || stage === "done"
            ? en.app.openPosition.action
            : en.app.openPosition.stages[stage]}
        </ActionButton>
        {!connected ? (
          <Note>{en.app.openPosition.needsWallet}</Note>
        ) : !canSign ? (
          <Note>{en.app.openPosition.demoWallet}</Note>
        ) : (
          <Note>{en.app.openPosition.signatures}</Note>
        )}
      </div>

      {signatures.length > 0 ? (
        <div className="mt-4 flex flex-col gap-1">
          {signatures.map((signature) => {
            const url = explorerUrl({ ...config, mode: "chain" }, signature);
            return (
              <a
                key={signature}
                href={url ?? "#"}
                rel="noreferrer noopener"
                target="_blank"
                className="num text-[12px] text-accent underline-offset-4 hover:underline"
              >
                {signature.slice(0, 24)}…
              </a>
            );
          })}
        </div>
      ) : null}

      {stage === "done" ? <Note className="mt-4">{en.app.openPosition.done}</Note> : null}
      {error !== null ? (
        <p className="mt-4 text-[13px] leading-relaxed text-state-danger">{error}</p>
      ) : null}
    </Card>
  );
}
