import Link from "next/link";
import type { MDXComponents } from "mdx/types";

/**
 * Docs typography. The prose measure is capped at 68 characters because these
 * pages are read, not scanned, and a full-width line of body copy is not.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h1: ({ children }) => (
      <h1 className="max-w-[24ch] text-3xl leading-tight tracking-tight text-ink md:text-4xl">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-14 max-w-[32ch] border-t border-line pt-8 text-xl leading-snug tracking-tight text-ink">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-9 max-w-[40ch] text-[15px] leading-snug text-ink">{children}</h3>
    ),
    p: ({ children }) => (
      <p className="mt-5 max-w-[68ch] text-[15px] leading-relaxed text-ink-dim">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="mt-5 flex max-w-[68ch] list-disc flex-col gap-2.5 pl-5 text-[15px] leading-relaxed text-ink-dim marker:text-ink-faint">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="mt-5 flex max-w-[68ch] list-decimal flex-col gap-2.5 pl-5 text-[15px] leading-relaxed text-ink-dim marker:text-ink-faint">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="pl-1">{children}</li>,
    strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
    a: ({ href, children }) => (
      <Link
        href={href ?? "#"}
        className="rounded-panel text-accent underline-offset-4 transition-opacity duration-300 hover:opacity-80 hover:underline"
        {...(href?.startsWith("http") ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      >
        {children}
      </Link>
    ),
    code: ({ children }) => (
      <code className="num rounded-panel border border-line bg-surface px-1.5 py-0.5 text-[13px] text-ink">
        {children}
      </code>
    ),
    pre: ({ children }) => (
      <pre className="num mt-5 max-w-full overflow-x-auto rounded-panel border border-line bg-surface p-4 text-[13px] leading-relaxed text-ink">
        {children}
      </pre>
    ),
    hr: () => <hr className="mt-12 border-line" />,
    ...components,
  };
}
