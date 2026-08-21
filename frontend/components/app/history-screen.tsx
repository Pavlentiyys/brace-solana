"use client";

import { FailureNotice } from "@/components/app/failure-notice";
import { Card, Note, PageHeading, StatusDot } from "@/components/app/ui";
import { en } from "@/content/en";
import { calendarDateTime } from "@/lib/core/format";
import { describeGuardError } from "@/lib/core/program";
import { describeReceipt, needsAttention, sortByNewest, type Receipt } from "@/lib/core/receipts";
import { explorerUrl } from "@/lib/platform/config";
import { usePlatform, useSnapshot } from "@/lib/platform/provider";

/**
 * Screen 2.6.
 *
 * A list, newest first, with the failed attempts in it rather than filtered out of
 * it. Section 3.8 calls a failed action the worst case in the product and the one
 * designs forget; a history that only records successes is how it gets forgotten.
 *
 * Wording is fixed by section 2.6 and lives in `describeReceipt` so that the bot's
 * report and this row are the same sentence.
 */

const copy = en.app.history;

function ReceiptRow({ receipt }: { receipt: Receipt }) {
  const { config } = usePlatform();
  const link = explorerUrl(config, receipt.signature);
  const failed = needsAttention(receipt);

  return (
    <li className="flex flex-col gap-2 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="flex items-baseline gap-2 text-[14px] text-ink">
          <span className="translate-y-[-2px]">
            <StatusDot tone={failed ? "danger" : "neutral"} />
          </span>
          {describeReceipt(receipt)}
        </p>
        <p className="num text-[12px] text-ink-faint">{calendarDateTime(receipt.at)}</p>
      </div>

      {failed ? (
        <div className="pl-4">
          <p className="text-[12px] text-state-danger">{copy.failedLead}</p>
          {receipt.failure ? (
            <p className="mt-1 max-w-[70ch] text-[12px] leading-relaxed text-ink-dim">
              {receipt.failure}
            </p>
          ) : null}
          {receipt.errorCode !== undefined ? (
            <p className="num mt-1 text-[11px] text-ink-faint">
              {`${copy.onChainError} ${describeGuardError(receipt.errorCode).name} (${receipt.errorCode})`}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="pl-4">
        {link ? (
          <a
            href={link}
            rel="noreferrer noopener"
            target="_blank"
            className="num text-[12px] text-accent underline-offset-4 hover:underline"
          >
            {copy.viewTransaction}
          </a>
        ) : (
          <span className="text-[11px] text-ink-faint">{copy.noTransaction}</span>
        )}
      </div>
    </li>
  );
}

export function HistoryScreen() {
  const { snapshot, failure, isLoading } = useSnapshot();

  if (failure && !snapshot) return <FailureNotice failure={failure} />;
  if (isLoading || !snapshot) return <Note>Reading the history</Note>;

  const receipts = sortByNewest(snapshot.receipts);

  return (
    <div className="flex max-w-[860px] flex-col gap-8">
      <PageHeading title={copy.heading} lead={copy.lead} />

      {receipts.length === 0 ? (
        <Card>
          <p className="text-[14px] text-ink-dim">{copy.empty}</p>
        </Card>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {receipts.map((receipt) => (
            <ReceiptRow key={receipt.id} receipt={receipt} />
          ))}
        </ul>
      )}
    </div>
  );
}
