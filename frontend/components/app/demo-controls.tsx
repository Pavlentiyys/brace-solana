"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ActionButton, Card, CardTitle, Note } from "@/components/app/ui";
import { en } from "@/content/en";
import { cn } from "@/lib/cn";
import { demoControls, type DemoFault } from "@/lib/platform/demo-source";
import { SNAPSHOT_KEY, usePlatform } from "@/lib/platform/provider";

/**
 * The switches that make the unhappy paths reachable.
 *
 * Every failure state in PLATFORM.md 6 is a state somebody has to be able to look at
 * before deciding the interface handles it. Left to a happy demo they are code that
 * has never been rendered. Putting the switches on the panel itself, rather than in
 * a hidden route, also keeps them honest: they are visible evidence that the good
 * path is not the only one that was designed.
 *
 * Demo mode only. In chain mode this renders nothing.
 */

const FAULTS: DemoFault[] = [
  "rpc_unavailable",
  "watcher_stalled",
  "price_stale",
  "action_fails",
  "congested",
  "wallet_rejects",
];

const copy = en.app.demoControls;

export function DemoControls() {
  const { config } = usePlatform();
  const client = useQueryClient();
  const [active, setActive] = useState<DemoFault[]>(demoControls.faults());

  if (config.mode !== "demo") return null;

  function refresh() {
    setActive(demoControls.faults());
    client.invalidateQueries({ queryKey: [SNAPSHOT_KEY] });
  }

  function toggle(fault: DemoFault) {
    demoControls.setFault(fault, !active.includes(fault));
    refresh();
  }

  function shift(fraction: number) {
    demoControls.shiftPrice(fraction);
    refresh();
  }

  return (
    <Card as="section" className="border-dashed">
      <CardTitle>{copy.heading}</CardTitle>
      <Note className="mt-2 max-w-[74ch]">{copy.body}</Note>

      <div className="mt-5 flex flex-col gap-5">
        <div>
          <p className="text-[12px] text-ink-dim">{copy.price}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <ActionButton onClick={() => shift(-0.1)}>{copy.down10}</ActionButton>
            <ActionButton onClick={() => shift(-0.25)}>{copy.down25}</ActionButton>
            <ActionButton onClick={() => shift(0.1)}>{copy.up10}</ActionButton>
          </div>
        </div>

        <div>
          <p className="text-[12px] text-ink-dim">{copy.faults}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {FAULTS.map((fault) => {
              const on = active.includes(fault);
              return (
                <button
                  key={fault}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(fault)}
                  className={cn(
                    "min-h-11 rounded-panel border px-3.5 text-[13px] transition-colors duration-300",
                    on
                      ? "border-state-warn text-state-warn"
                      : "border-line text-ink-dim hover:border-line-strong hover:text-ink",
                  )}
                >
                  {copy.fault[fault]}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-[12px] text-ink-dim">{copy.expiry}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <ActionButton
              onClick={() => {
                demoControls.expireIn(3 * 24 * 60 * 60);
                refresh();
              }}
            >
              {copy.expireSoon}
            </ActionButton>
            <ActionButton
              onClick={() => {
                demoControls.expireIn(0);
                refresh();
              }}
            >
              {copy.expireNow}
            </ActionButton>
          </div>
        </div>
      </div>
    </Card>
  );
}
