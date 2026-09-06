"use client";

import { ActionButton, Note, StatusDot } from "@/components/app/ui";
import { en } from "@/content/en";
import { describeGuardError } from "@/lib/core/program";
import { formatAmount, QUOTE_DECIMALS, QUOTE_SYMBOL } from "@/lib/core/units";
import { cn } from "@/lib/cn";
import type { Failure } from "@/lib/platform/types";

/**
 * One component for every failure in PLATFORM.md 6.
 *
 * Each case answers three questions in this order: what happened, what it means for
 * the position, and what to do next. The middle one is the one interfaces skip, and
 * it is the one the user actually needs. "Cannot reach the network" without "nothing
 * has happened to your position" is a sentence that makes somebody panic sell.
 *
 * The failure type is a closed union, so a new failure kind fails the build here
 * rather than falling through to a blank box.
 */

const copy = en.app.failure;

function describe(failure: Failure): { title: string; body: string; detail?: string } {
  switch (failure.kind) {
    case "insufficient_funds":
      return {
        ...copy.insufficient_funds,
        detail: `Needs ${formatAmount(failure.needed, QUOTE_DECIMALS)} ${QUOTE_SYMBOL}, has ${formatAmount(failure.available, QUOTE_DECIMALS)} ${QUOTE_SYMBOL}.`,
      };
    case "insufficient_sol":
      return { ...copy.insufficient_sol, detail: failure.detail };
    case "rpc_unavailable":
      return { ...copy.rpc_unavailable, detail: failure.detail };
    case "rpc_rate_limited":
      return { ...copy.rpc_rate_limited, detail: failure.detail };
    case "rpc_invalid_response":
      return { ...copy.rpc_invalid_response, detail: `${failure.method}${failure.detail ? `: ${failure.detail}` : ""}` };
    case "rpc_request_failed":
      return {
        ...copy.rpc_request_failed,
        detail: `${failure.method}${failure.code === undefined ? "" : ` (${failure.code})`}${failure.detail ? `: ${failure.detail}` : ""}`,
      };
    case "account_not_found":
      return { ...copy.account_not_found, detail: failure.account };
    case "invalid_account_data":
      return { ...copy.invalid_account_data, detail: failure.account ?? failure.detail };
    case "confirmation_timeout":
      return { ...copy.confirmation_timeout, detail: failure.signature };
    case "transaction_simulation_failed":
      return { ...copy.transaction_simulation_failed, detail: failure.detail };
    case "transaction_send_failed":
      return { ...copy.transaction_send_failed, detail: failure.detail };
    case "transaction_failed":
      return { ...copy.transaction_failed, detail: failure.detail };
    case "invalid_amount":
      return { ...copy.invalid_amount, detail: failure.detail };
    case "position_not_found":
      return { ...copy.position_not_found, detail: failure.detail };
    case "reserve_not_found":
      return { ...copy.reserve_not_found, detail: failure.detail };
    case "guard_not_found":
      return { ...copy.guard_not_found, detail: failure.detail };
    case "guard_current":
      return { ...copy.guard_current, detail: failure.detail };
    case "program_error": {
      const error = describeGuardError(failure.code);
      return {
        title: "The program refused the transaction",
        body: error.cause,
        detail: `${error.name} (${failure.code})`,
      };
    }
    case "invalid_policy":
      return { ...copy.invalid_policy, detail: failure.messages.join(" ") };
    case "unknown":
      return { ...copy.unknown, detail: failure.detail };
    default:
      return copy[failure.kind];
  }
}

/**
 * Everything except a dismissed wallet prompt is worth an alarm colour.
 *
 * `guard_exists` is not an alarm either: nothing was sent and the authorization
 * the user was worried about is the one already protecting them.
 */
function toneOf(failure: Failure): "warn" | "danger" {
  return failure.kind === "wallet_rejected" ||
    failure.kind === "wallet_locked" ||
    failure.kind === "wallet_busy" ||
    failure.kind === "wallet_disconnected" ||
    failure.kind === "program_not_deployed" ||
    failure.kind === "guard_exists" ||
    failure.kind === "confirmation_timeout"
    ? "warn"
    : "danger";
}

export function FailureNotice({
  failure,
  onRetry,
  className,
}: {
  failure: Failure;
  onRetry?: () => void;
  className?: string;
}) {
  const { title, body, detail } = describe(failure);
  const tone = toneOf(failure);

  return (
    <div
      role="status"
      className={cn("rounded-panel border border-line-strong bg-raised p-4", className)}
    >
      <div className="flex items-center gap-2">
        <StatusDot tone={tone} />
        <p className={cn("text-[13px]", tone === "danger" ? "text-state-danger" : "text-state-warn")}>
          {title}
        </p>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">{body}</p>
      {detail ? <Note className="mt-2">{detail}</Note> : null}
      {onRetry ? (
        <ActionButton className="mt-4" onClick={onRetry}>
          {copy.retry}
        </ActionButton>
      ) : null}
    </div>
  );
}
