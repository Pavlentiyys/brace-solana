import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docs pages are MDX files that live next to the code and get reviewed with
  // it (LANDING.md section 5). A separate docs platform is more machinery than
  // this stage needs.
  pageExtensions: ["ts", "tsx", "md", "mdx"],

  // Founder avatars are served by GitHub. `github.com/<user>.png` redirects to
  // the avatars host, so both are listed.
  // The app moved from /chat to /app when the chat stopped being the only way
  // in. Bookmarks and the README's links still land. The exact /chat rule comes
  // first so it does not fall into the wildcard and become /app/.
  async redirects() {
    return [
      { source: "/chat", destination: "/app", permanent: true },
      { source: "/chat/authorize", destination: "/app/rule", permanent: true },
      { source: "/chat/:path*", destination: "/app/:path*", permanent: true },
    ];
  },

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "github.com", pathname: "/*.png" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
};

const withMDX = createMDX({});

export default withMDX(nextConfig);
