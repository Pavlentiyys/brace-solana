import { Capabilities } from "@/components/landing/capabilities";
import { Comparison } from "@/components/landing/comparison";
import { Hero } from "@/components/landing/hero";
import { Limits } from "@/components/landing/limits";
import { SimulatorSection } from "@/components/landing/simulator-section";

/**
 * Section order follows the order the questions arrive in: will you take my money,
 * what actually happens when the price falls, and what if it breaks.
 *
 * The first answer is in the hero, above the fold, because until that one is
 * settled nothing else is interesting.
 *
 * Getting started lives in the documentation, where it can be read as a guide
 * rather than interrupting the landing page's explanation of the product.
 */
export default function Home() {
  return (
    <>
      <Hero />
      <SimulatorSection />
      <Comparison />
      <Capabilities />
      <Limits />
    </>
  );
}
