/**
 * Decorative background extracted from the supplied hero reference.
 *
 * It stays server-rendered, carries no interaction, and uses the landing
 * palette instead of introducing a second light/dark theme. The parent hero
 * clips the large lower ellipse so only its top arc is visible.
 */
export function HeroBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,var(--color-canvas),var(--color-canvas)_50%,var(--color-surface)_88%,var(--color-canvas))]" />

      <div className="absolute inset-x-0 top-0 h-[44rem] bg-[linear-gradient(to_right,rgb(255_255_255/0.055)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.055)_1px,transparent_1px)] bg-[size:6rem_5rem] opacity-80 [mask-image:radial-gradient(ellipse_80%_55%_at_50%_0%,#000_65%,transparent_110%)]" />

      <div className="absolute left-1/2 top-[calc(100%-5.5rem)] h-[30rem] w-[68rem] max-w-[140vw] -translate-x-1/2 rounded-[100%] border border-accent/40 bg-[radial-gradient(closest-side,var(--color-canvas)_81%,rgb(75_143_255/0.22)_92%,rgb(232_234_237/0.42)_100%)] opacity-80 sm:top-[calc(100%-7rem)] sm:h-[34rem] sm:w-[80rem] xl:top-[calc(100%-9rem)] xl:h-[42rem] xl:w-[140%]" />
    </div>
  );
}
