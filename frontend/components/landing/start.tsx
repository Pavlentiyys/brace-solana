import { Reveal } from "@/components/ui/reveal";
import { Section, SectionHeading } from "@/components/ui/section";
import { en } from "@/content/en";

/**
 * A stepped vertical stack, offset so the three steps read as a descent rather
 * than as three equal cards.
 *
 * "What you need" is a column of its own because the answer is "nothing" for
 * the first two steps, and that is the whole argument for the chat-first
 * split (PLATFORM.md section 1).
 */
export function Start() {
  return (
    <Section id="start">
      <Reveal>
        <SectionHeading>{en.start.heading}</SectionHeading>
      </Reveal>

      <ol className="mt-12 flex flex-col">
        {en.start.steps.map((step, index) => (
          <Reveal key={step.title} delay={index * 0.05}>
            <li
              className="border-t border-line py-8 md:py-10"
              style={{ paddingLeft: `calc(var(--spacing) * ${index * 6})` }}
            >
              <div className="grid gap-4 md:grid-cols-[3rem_minmax(0,1fr)_10rem] md:items-baseline md:gap-8">
                <span className="num text-[13px] text-ink-faint">
                  {String(index + 1).padStart(2, "0")}
                </span>

                <div>
                  <h3 className="text-[17px] leading-snug text-ink">{step.title}</h3>
                  <p className="mt-3 max-w-[58ch] text-[14px] leading-relaxed text-ink-dim">
                    {step.body}
                  </p>
                </div>

                <div className="flex flex-col gap-1.5 md:text-right">
                  <span className="text-[11px] text-ink-faint">You need</span>
                  <span className="text-[13px] text-ink">{step.requires}</span>
                </div>
              </div>
            </li>
          </Reveal>
        ))}
      </ol>
    </Section>
  );
}
