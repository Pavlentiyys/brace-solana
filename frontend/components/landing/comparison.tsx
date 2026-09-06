import { Reveal } from "@/components/ui/reveal";
import { Section, SectionHeading, SectionLead } from "@/components/ui/section";
import { en } from "@/content/en";
import { cn } from "@/lib/cn";

/**
 * A matrix, which is a layout family nothing else on this page uses.
 *
 * It earns its place because the difference between this product and the two
 * native mechanisms is mechanical, not rhetorical: their orders unwind the
 * position and pay whoever executes them, this one repays from money the owner
 * already set aside. Three rows of cells say that faster than a paragraph, and
 * a paragraph would invite an argument the cells simply end.
 *
 * The last column is the only one carrying ink; the two protocol columns are
 * dimmed. That is not a value judgement, it is the reading order.
 */
export function Comparison() {
  const { columns, rows } = en.comparison;

  return (
    <Section id="comparison">
      <Reveal>
        <SectionHeading>{en.comparison.heading}</SectionHeading>
        <SectionLead>{en.comparison.lead}</SectionLead>
      </Reveal>

      <Reveal delay={0.05}>
        {/*
          Stacked below sm, table from sm up.

          Four columns cannot fit in 375px, and letting the table scroll put the
          Brace column off screen: the one column the section exists for was the
          one a phone could not see. Stacking keeps all three values visible per
          row. `display: none` hides the unused variant from assistive tech too,
          so only one of the two is ever read.
        */}
        <dl className="mt-10 flex flex-col sm:hidden">
          {rows.map((row) => (
            <div key={row.label} className="border-t border-line py-5">
              <dt className="text-[13px] text-ink-dim">{row.label}</dt>
              <dd className="mt-3 flex flex-col gap-2">
                {row.values.map((value, index) => (
                  <span key={columns[index]} className="flex items-baseline justify-between gap-4">
                    <span
                      className={cn(
                        "text-[12px]",
                        index === row.values.length - 1 ? "text-ink-dim" : "text-ink-faint",
                      )}
                    >
                      {columns[index]}
                    </span>
                    <span
                      className={cn(
                        "text-[13px]",
                        index === row.values.length - 1 ? "text-ink" : "text-ink-faint",
                      )}
                    >
                      {value}
                    </span>
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-10 hidden sm:block">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                <th scope="col" className="w-[34%] py-3 pr-4 text-[12px] font-normal text-ink-faint">
                  <span className="sr-only">Property</span>
                </th>
                {columns.map((column, index) => (
                  <th
                    key={column}
                    scope="col"
                    className={cn(
                      "border-b border-line py-3 pr-4 font-normal",
                      index === columns.length - 1
                        ? "text-[14px] text-ink"
                        : "text-[13px] text-ink-faint",
                    )}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th
                    scope="row"
                    className="border-t border-line py-4 pr-4 text-[13px] font-normal text-ink-dim"
                  >
                    {row.label}
                  </th>
                  {row.values.map((value, index) => (
                    <td
                      key={column(columns, index)}
                      // The last column carries the weight. It is the only
                      // answer on this page that differs from both protocols,
                      // and setting it at the same size as theirs hid that.
                      className={cn(
                        "border-t border-line py-4 pr-4",
                        index === row.values.length - 1
                          ? "text-[16px] text-ink"
                          : "text-[13px] text-ink-faint",
                      )}
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-[12px] text-ink-faint">{en.comparison.note}</p>
      </Reveal>
    </Section>
  );
}

/** Stable cell key without leaning on the array index alone. */
function column(columns: readonly string[], index: number) {
  return columns[index] ?? String(index);
}
