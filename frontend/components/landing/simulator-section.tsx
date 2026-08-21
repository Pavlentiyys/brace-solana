import { Simulator } from "@/components/simulator/simulator";
import { Reveal } from "@/components/ui/reveal";
import { Section, SectionHeading, SectionLead } from "@/components/ui/section";
import { en } from "@/content/en";

export function SimulatorSection() {
  return (
    <Section id="simulator">
      <Reveal>
        <SectionHeading>{en.simulator.heading}</SectionHeading>
        <SectionLead>{en.simulator.body}</SectionLead>
        <p className="mt-3 max-w-[58ch] text-[12px] leading-relaxed text-ink-faint">
          {en.simulator.exampleDataNote}
        </p>
      </Reveal>

      <Simulator />
    </Section>
  );
}
