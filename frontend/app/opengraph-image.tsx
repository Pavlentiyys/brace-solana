import { ImageResponse } from "next/og";

import { en } from "@/content/en";
import { site } from "@/content/site";

export const alt = `${site.name}: ${en.hero.subheadline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The share card carries the same sentence the hero leads with, because the
 * question it answers is the one people arrive with. A logo on a gradient
 * would waste the only 1200 by 630 we get.
 *
 * Inline styles rather than Tailwind: this renders through Satori, which does
 * not run the stylesheet.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#08090b",
          padding: "72px",
          color: "#e8eaed",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
            <path d="M8 3.5H4.5v17H8M16 3.5h3.5v17H16" stroke="#8a9099" strokeWidth="1.5" />
            <path d="M7.5 8.5 12 14h4.5" stroke="#4b8fff" strokeWidth="1.75" />
          </svg>
          <span style={{ fontSize: 30, letterSpacing: "-0.01em" }}>{site.name}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
          <div style={{ fontSize: 56, lineHeight: 1.15, letterSpacing: "-0.02em", maxWidth: 960 }}>
            {en.hero.headline}
          </div>
          <div style={{ fontSize: 27, lineHeight: 1.4, color: "#8a9099", maxWidth: 880 }}>
            {en.hero.subheadline}
          </div>
        </div>

        <div style={{ display: "flex", height: "3px", width: "180px", backgroundColor: "#4b8fff" }} />
      </div>
    ),
    size,
  );
}
