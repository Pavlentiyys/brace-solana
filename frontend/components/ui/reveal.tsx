"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/**
 * The only motion primitive on the landing page.
 *
 * Justification, since Section 5 of the design skill asks for one: the page is
 * long and the sections argue in sequence (what it does, then what it cannot
 * do, then where it fails). Revealing on entry sets the reading order. It is
 * not decoration and it does not loop.
 *
 * Under `prefers-reduced-motion` the content renders in place with no
 * transition at all, rather than a shortened one.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
