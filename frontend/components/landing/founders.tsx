import Image from "next/image";

import { Reveal } from "@/components/ui/reveal";
import { Section, SectionHeading, SectionLead } from "@/components/ui/section";
import { en } from "@/content/en";

/**
 * Who is behind the thing, at the end of a page whose whole argument is
 * "check this yourself". It sits after the three steps and before the footer,
 * because it answers a question the reader only asks once they are considering
 * it, and it is the last one they ask.
 *
 * The two locks in globals.css apply here as they do everywhere. The cards use
 * `accent`, not a second brand colour, and the 6px radius, not a rounded card
 * on a page of square ones. The avatar dot is decoration and means nothing, so
 * it is accent rather than `state-ok`, which is reserved for readings that are
 * actually measured.
 */
function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-4 w-4">
      <path d="M12 .5C5.73.5.98 5.24.98 11.5c0 4.85 3.14 8.96 7.5 10.42.55.1.75-.24.75-.53v-1.86c-3.05.66-3.7-1.47-3.7-1.47-.5-1.27-1.22-1.61-1.22-1.61-1-.68.07-.67.07-.67 1.1.08 1.68 1.13 1.68 1.13.98 1.68 2.57 1.19 3.2.91.1-.71.38-1.19.7-1.46-2.44-.28-5-1.22-5-5.44 0-1.2.43-2.18 1.13-2.95-.11-.28-.49-1.4.11-2.91 0 0 .92-.3 3.02 1.13a10.4 10.4 0 0 1 5.5 0c2.1-1.43 3.02-1.13 3.02-1.13.6 1.51.22 2.63.11 2.91.7.77 1.13 1.75 1.13 2.95 0 4.23-2.57 5.16-5.02 5.43.39.34.74 1.01.74 2.04v3.03c0 .29.2.64.76.53 4.35-1.46 7.49-5.57 7.49-10.42C23.02 5.24 18.27.5 12 .5Z" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-4 w-4">
      <path d="m21.94 4.6-3.02 14.25c-.23 1.01-.83 1.26-1.68.78l-4.64-3.42-2.24 2.16c-.25.25-.46.46-.94.46l.33-4.73 8.6-7.77c.37-.33-.08-.52-.58-.19L7.14 12.6l-4.58-1.43c-1-.31-1.01-1 .21-1.48l17.9-6.9c.83-.3 1.55.19 1.27 1.81Z" />
    </svg>
  );
}

function SocialLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-panel border border-line text-ink-faint transition-colors duration-300 hover:border-line-strong hover:text-ink"
    >
      {children}
    </a>
  );
}

export function Founders() {
  return (
    <Section id="founders">
      <Reveal>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <SectionHeading className="max-w-none">{en.founders.heading}</SectionHeading>
          <span className="flex items-center gap-2 rounded-panel border border-line bg-surface px-2.5 py-1 text-[11px] text-ink-dim">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            {en.founders.badge}
          </span>
        </div>
        <SectionLead>{en.founders.lead}</SectionLead>
      </Reveal>

      <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2">
        {en.founders.members.map((member, index) => (
          <Reveal key={member.handle} delay={index * 0.05}>
            <article className="h-full rounded-panel border border-line bg-surface p-6 transition-all duration-300 hover:border-line-strong hover:shadow-[0_0_30px_rgba(75,143,255,0.10)]">
              <div className="flex items-start gap-4">
                <div className="relative shrink-0">
                  <Image
                    src={member.avatar}
                    alt=""
                    width={52}
                    height={52}
                    className="rounded-panel border border-line"
                  />
                  <span
                    className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-surface"
                    aria-hidden="true"
                  />
                </div>

                <div className="min-w-0">
                  <h3 className="text-[15px] leading-tight text-ink">{member.name}</h3>
                  <p className="num mt-1 text-[12px] text-ink-faint">{member.handle}</p>
                  <p className="mt-2 text-[13px] leading-snug text-accent">{member.role}</p>
                </div>
              </div>

              <p className="mt-5 text-[13px] leading-relaxed text-ink-dim">{member.bio}</p>

              <ul className="mt-5 flex flex-wrap gap-2">
                {member.stack.map((item) => (
                  <li
                    key={item}
                    className="rounded-panel border border-line px-2 py-1 font-mono text-[11px] text-ink-faint"
                  >
                    {item}
                  </li>
                ))}
              </ul>

              <div className="mt-6 flex items-center gap-2 border-t border-line pt-5">
                <SocialLink
                  href={member.github}
                  label={`${en.founders.githubLabel} ${member.name}`}
                >
                  <GithubIcon />
                </SocialLink>
                <SocialLink
                  href={member.telegram}
                  label={`${en.founders.telegramLabel} ${member.name}`}
                >
                  <TelegramIcon />
                </SocialLink>
              </div>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
