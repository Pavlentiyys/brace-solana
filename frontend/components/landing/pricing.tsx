import { Reveal } from "@/components/ui/reveal";
import { Section, SectionHeading } from "@/components/ui/section";
import { en } from "@/content/en";

/**
 * One figure and two rows. LANDING.md asks for a direct number, and where the
 * model is not decided it asks for that to be said plainly rather than dressed
 * up as a tier.
 */
export function Pricing() {
  return (
    <Section id="price">
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <Reveal>
          <SectionHeading>{en.pricing.heading}</SectionHeading>
          <p className="num mt-8 text-5xl leading-none text-ink md:text-6xl">
            {en.pricing.figure}
          </p>
          <p className="mt-3 text-[13px] text-ink-dim">{en.pricing.figureLabel}</p>
          <p className="mt-6 max-w-[42ch] text-[13px] leading-relaxed text-ink-faint">
            {en.pricing.body}
          </p>
        </Reveal>

        <Reveal delay={0.05}>
          <dl className="flex flex-col">
            {en.pricing.rows.map((row, index) => (
              <div
                key={row.label}
                className={index === 0 ? "pb-6" : "border-t border-line pt-6"}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <dt className="text-[15px] text-ink">{row.label}</dt>
                  <dd className="num text-[15px] text-accent">{row.value}</dd>
                </div>
                <p className="mt-3 max-w-[56ch] text-[13px] leading-relaxed text-ink-dim">
                  {row.detail}
                </p>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </Section>
  );
}
