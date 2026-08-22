import { Check, Prohibit } from "@phosphor-icons/react/ssr";

import { Reveal } from "@/components/ui/reveal";
import { Section, SectionHeading } from "@/components/ui/section";
import { en } from "@/content/en";

/**
 * Two columns divided by a hairline rather than two cards. The point of the
 * section is that the two lists are the same kind of fact about the same
 * program, and boxing them separately would suggest otherwise.
 *
 * The "cannot" column is longer than the "can" column on purpose.
 */
export function Capabilities() {
  return (
    <Section id="capabilities">
      <Reveal>
        <SectionHeading>{en.capabilities.heading}</SectionHeading>
      </Reveal>

      <Reveal delay={0.05}>
        <div className="mt-10 grid gap-10 md:grid-cols-2 md:gap-0">
          <div className="md:pr-10">
            <h3 className="text-[13px] text-ink">{en.capabilities.canHeading}</h3>

            <ul className="mt-5 flex flex-col gap-3.5">
              {en.capabilities.can.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <Check
                    size={16}
                    weight="regular"
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-accent"
                  />
                  <span className="text-[15px] leading-snug text-ink">{item}</span>
                </li>
              ))}
            </ul>

            <ul className="mt-6 flex flex-col gap-2 border-t border-line pt-5 text-[13px] leading-relaxed text-ink-dim">
              {en.capabilities.canConstraints.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="md:border-l md:border-line md:pl-10">
            <h3 className="text-[13px] text-ink">{en.capabilities.cannotHeading}</h3>

            <ul className="mt-5 flex flex-col gap-3.5">
              {en.capabilities.cannot.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <Prohibit
                    size={16}
                    weight="regular"
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-ink-faint"
                  />
                  <span className="text-[15px] leading-snug text-ink">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Reveal>

    </Section>
  );
}
