import { en } from "@/content/en";
import { elapsed, percentFromBps } from "@/lib/core/format";
import type { SimulationResult } from "@/lib/core/ltv/simulate";

/**
 * The chart's values as a table.
 *
 * This exists twice over. The dataviz skill requires a table view so identity
 * is never carried by colour alone, and LANDING.md section 5 requires the page
 * to work without JavaScript. A `<details>` element satisfies both without a
 * line of script: it opens and closes natively.
 */
export function DataTable({
  result,
  stepMinutes,
}: {
  result: SimulationResult;
  stepMinutes: number;
}) {
  const actionsByIndex = new Map(result.withAgent.actions.map((a) => [a.index, a]));

  return (
    <details className="group mt-6 rounded-panel border border-line">
      <summary className="cursor-pointer list-none px-5 py-3.5 text-[13px] text-ink-dim transition-colors duration-300 hover:text-ink">
        <span className="group-open:hidden">Show the numbers as a table</span>
        <span className="hidden group-open:inline">Hide the table</span>
      </summary>

      <div className="max-h-[340px] overflow-auto border-t border-line">
        <table className="w-full min-w-[460px] text-left text-[12px]">
          <thead className="sticky top-0 bg-surface text-ink-faint">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-normal">
                Time
              </th>
              <th scope="col" className="px-4 py-2.5 font-normal">
                Price
              </th>
              <th scope="col" className="px-4 py-2.5 font-normal">
                LTV with the agent
              </th>
              <th scope="col" className="px-4 py-2.5 font-normal">
                LTV with no agent
              </th>
              <th scope="col" className="px-4 py-2.5 font-normal">
                Agent
              </th>
            </tr>
          </thead>
          <tbody>
            {result.prices.map((price, i) => {
              const action = actionsByIndex.get(i);
              const withAgent = result.withAgent.ltvBps[i];
              const withoutAgent = result.withoutAgent.ltvBps[i];

              return (
                <tr key={i} className="border-t border-line">
                  <td className="num px-4 py-2 text-ink-faint">{elapsed(i, stepMinutes)}</td>
                  <td className="num px-4 py-2 text-ink-dim">${price.toFixed(2)}</td>
                  <td className="num px-4 py-2 text-ink">
                    {withAgent === null ? "liquidated" : percentFromBps(withAgent)}
                  </td>
                  <td className="num px-4 py-2 text-ink-dim">
                    {withoutAgent === null ? "liquidated" : percentFromBps(withoutAgent)}
                  </td>
                  <td className="px-4 py-2 text-ink-dim">
                    {action ? (
                      <>
                        {action.kind === "add_collateral" ? "Added collateral" : "Repaid debt"}, $
                        {action.spent.toFixed(2)}
                        {action.kind === "add_collateral" ? (
                          <span className="num ml-2 text-[11px] text-ink-faint">
                            {en.simulator.v2}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      ""
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
