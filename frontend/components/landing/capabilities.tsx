import { Reveal } from "@/components/ui/reveal";
import { Section, SectionHeading } from "@/components/ui/section";
import { en } from "@/content/en";

/**
 * Weighted toward "cannot", because that column is the product.
 *
 * The two lists used to be equal: same column width, same type size, a small
 * icon in front of every line. That gave the same emphasis to two things the
 * agent may do and five things it structurally may not, when the second list is
 * the only reason to trust the first.
 *
 * The icons are gone. A check mark in front of a line under a heading that
 * already says "Can" repeats the heading in a glyph, and a row of small marks
 * down the left edge is the pattern every feature list reaches for.
 */
export function Capabilities() {
  return (
    <Section id="capabilities">
      <Reveal>
        <SectionHeading>{en.capabilities.heading}</SectionHeading>
      </Reveal>

      <Reveal delay={0.05}>
        <div className="mt-12 grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div>
            <h3 className="text-[12px] text-ink-faint">{en.capabilities.canHeading}</h3>

            <ul className="mt-4 flex flex-col gap-3">
              {en.capabilities.can.map((item) => (
                <li key={item.label} className="text-[15px] leading-snug text-ink-dim">
                  {item.label}
                  {"v2" in item ? (
                    <span className="num ml-2 align-middle text-[10px] text-ink-faint">
                      {en.simulator.v2}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>

            <ul className="mt-6 flex flex-col gap-1.5 border-t border-line pt-5 text-[13px] text-ink-faint">
              {en.capabilities.canConstraints.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          {/* The larger type and the ink colour are the whole argument: these
              are not promises the operator makes, they are shapes the program
              cannot express. */}
          <div>
            <h3 className="text-[12px] text-ink-faint">{en.capabilities.cannotHeading}</h3>

            <ul className="mt-4 flex flex-col">
              {en.capabilities.cannot.map((item) => (
                <li
                  key={item}
                  className="border-t border-line py-3.5 text-[17px] leading-snug text-ink first:border-t-0 first:pt-0 md:text-[19px]"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
