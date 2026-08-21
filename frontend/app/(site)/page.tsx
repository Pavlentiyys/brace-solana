import { Capabilities } from "@/components/landing/capabilities";
import { Hero } from "@/components/landing/hero";
import { Limits } from "@/components/landing/limits";
import { Pricing } from "@/components/landing/pricing";
import { SimulatorSection } from "@/components/landing/simulator-section";
import { Start } from "@/components/landing/start";
import { Timeline } from "@/components/landing/timeline";

/**
 * Section order follows the order the questions arrive in (LANDING.md section
 * 1): will you take my money, what actually happens when the price falls, what
 * does it cost, what if it breaks, how do I start.
 *
 * The first answer is in the hero, above the fold, because until that one is
 * settled nothing else is interesting.
 */
export default function Home() {
  return (
    <>
      <Hero />
      <SimulatorSection />
      <Capabilities />
      <Timeline />
      <Limits />
      <Pricing />
      <Start />
    </>
  );
}
