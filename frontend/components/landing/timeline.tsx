import { Reveal } from "@/components/ui/reveal";
import { Section, SectionHeading } from "@/components/ui/section";
import { en } from "@/content/en";

/**
 * A stepped rail: horizontal on desktop, vertical on narrow screens.
 *
 * The timings are labelled as targets in the copy. The watcher is not running
 * in production, so quoting measured averages here would be inventing
 * engineering precision the project has not earned yet.
 */
export function Timeline() {
  return (
    <Section id="timeline">
      <Reveal>
        <SectionHeading>{en.timeline.heading}</SectionHeading>
        <p className="mt-5 max-w-[58ch] text-[13px] leading-relaxed text-ink-faint">
          {en.timeline.note}
        </p>
      </Reveal>

      <Reveal delay={0.05}>
        <ol className="mt-12 grid gap-px overflow-hidden rounded-panel border border-line bg-line md:grid-cols-5">
          {en.timeline.steps.map((step, index) => (
            <li key={step.label} className="flex flex-col gap-3 bg-canvas p-5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="num text-[11px] text-ink-faint">{index + 1}</span>
                <span className="num text-[12px] text-accent">{step.timing}</span>
              </div>
              <h3 className="text-[14px] leading-snug text-ink">{step.label}</h3>
              <p className="text-[12.5px] leading-relaxed text-ink-dim">{step.detail}</p>
            </li>
          ))}
        </ol>
      </Reveal>
    </Section>
  );
}
