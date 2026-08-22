import { Simulator } from "@/components/simulator/simulator";
import { Reveal } from "@/components/ui/reveal";
import { Section, SectionHeading } from "@/components/ui/section";
import { en } from "@/content/en";

export function SimulatorSection() {
  return (
    <Section id="simulator" className="py-14 md:py-20">
      <Reveal>
        <SectionHeading className="max-w-none">{en.simulator.heading}</SectionHeading>
      </Reveal>

      <Simulator />
    </Section>
  );
}
