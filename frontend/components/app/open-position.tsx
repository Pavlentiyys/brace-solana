"use client";

import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { useState } from "react";

import { ActionButton, Card, CardTitle, Note, Row, Rows } from "@/components/app/ui";
import { en } from "@/content/en";
import { explorerUrl } from "@/lib/platform/config";
import {
  DEVNET_MARKET,
  marketAvailableOn,
  planCloseRepay,
  planCloseWithdraw,
  planOpenPosition,
  planRefresh,
} from "@/lib/platform/devnet-market";
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

function openPositionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/borrow.?limit|left:\s*0|elevation.?group/i.test(message)) {
    return (
      "The Brace devnet market is not ready for an ordinary borrow: its " +
      "borrow_limit_outside_elevation_group is still zero. Run `npm run ready` " +
      "in tools/devnet with the market-owner keypair, then try again."
    );
  }
  return message;
}

type Stage = "idle" | "depositing" | "borrowing" | "refreshing" | "done";
type CloseStage = "idle" | "repaying" | "withdrawing" | "done";

export function OpenPosition() {
  const { config, address, wallet, status } = usePlatform();
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [signatures, setSignatures] = useState<string[]>([]);
  const [closeStage, setCloseStage] = useState<CloseStage>("idle");
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeSignatures, setCloseSignatures] = useState<string[]>([]);

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

        // Simulate before Phantom opens. Without this, a failed borrow can be
        // reduced to an opaque custom error and the useful KLend log is lost.
        // The legacy `Transaction` overload takes no config and never verifies
        // signatures, so there is nothing to switch off here.
        const simulation = await connection.simulateTransaction(transaction);
        if (simulation.value.err) {
          const logs = simulation.value.logs ?? [];
          const detail = logs.slice(-6).join(" ");
          if (/borrow.?limit|left:\s*0|elevation.?group/i.test(detail)) {
            throw new Error(
              "The Brace devnet market is not ready for an ordinary borrow: its " +
                "borrow_limit_outside_elevation_group is still zero. Run `npm run ready` " +
                "in tools/devnet with the market-owner keypair, then try again.",
            );
          }
          throw new Error(`The ${stages[index]} transaction failed simulation.${detail ? ` ${detail}` : ""}`);
        }

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
      else setError(openPositionError(caught));
    }
  }

  async function signCloseStep(
    connection: Connection,
    owner: PublicKey,
    transaction: Transaction,
  ) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = owner;

    // A close operation is irreversible from the position's point of view. Show
    // the user a simulation failure before Phantom opens a signing prompt.
    const simulation = await connection.simulateTransaction(transaction);
    if (simulation.value.err) {
      const logs = simulation.value.logs ?? [];
      if (
        logs.some((log) => log.includes("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")) &&
        logs.some((log) => log.includes("0x1") || log.toLowerCase().includes("insufficient funds"))
      ) {
        throw new Error(
          `Not enough ${DEVNET_MARKET.debt.label} to cover accrued interest. ` +
            `Top up the test balance on devnet, then try closing again.`,
        );
      }
      const detail = logs.slice(-3).join(" ");
      throw new Error(`Close simulation failed.${detail ? ` ${detail}` : ""}`);
    }

    const signature = await wallet.signAndSend(transaction);
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    return signature;
  }

  async function close() {
    if (!address) return;
    setCloseError(null);
    setCloseSignatures([]);

    const connection = new Connection(config.rpcUrl, "confirmed");
    const owner = new PublicKey(address);
    const sent: string[] = [];

    try {
      const repay = await planCloseRepay({ connection, owner });
      if (repay) {
        setCloseStage("repaying");
        sent.push(await signCloseStep(connection, owner, repay.transaction));
        setCloseSignatures([...sent]);
      }

      // Re-read after repayment. The borrow entry disappears only after Kamino has
      // processed that transaction, and the withdraw amount must come from the
      // current obligation rather than a stale browser snapshot.
      const withdraw = await planCloseWithdraw({ connection, owner });
      if (withdraw) {
        setCloseStage("withdrawing");
        sent.push(await signCloseStep(connection, owner, withdraw.transaction));
        setCloseSignatures([...sent]);
      }

      setCloseStage("done");
    } catch (caught) {
      setCloseStage("idle");
      if (caught instanceof WalletRejected) setCloseError(en.app.openPosition.closeRejected);
      else if (caught instanceof WalletCannotSign) setCloseError(en.app.openPosition.demoWallet);
      else setCloseError((caught as Error).message);
    }
  }

  const busy = stage !== "idle" && stage !== "done";
  const closeBusy = closeStage !== "idle" && closeStage !== "done";

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

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <ActionButton variant="primary" onClick={run} busy={busy} disabled={!connected || !canSign}>
          {stage === "idle" || stage === "done"
            ? en.app.openPosition.action
            : en.app.openPosition.stages[stage]}
        </ActionButton>
        <ActionButton
          onClick={close}
          busy={closeBusy}
          disabled={!connected || !canSign || busy}
        >
          {closeStage === "idle" || closeStage === "done"
            ? en.app.openPosition.closeAction
            : en.app.openPosition.closeStages[closeStage]}
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

      {closeSignatures.length > 0 ? (
        <div className="mt-4 flex flex-col gap-1">
          {closeSignatures.map((signature) => {
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
      <Note className="mt-4">{en.app.openPosition.closeNote}</Note>
      {closeStage === "done" ? <Note className="mt-2">{en.app.openPosition.closeDone}</Note> : null}
      {error !== null ? (
        <p className="mt-4 text-[13px] leading-relaxed text-state-danger">{error}</p>
      ) : null}
      {closeError !== null ? (
        <p className="mt-4 text-[13px] leading-relaxed text-state-danger">{closeError}</p>
      ) : null}
    </Card>
  );
}
