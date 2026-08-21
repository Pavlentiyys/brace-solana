import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docs pages are MDX files that live next to the code and get reviewed with
  // it (LANDING.md section 5). A separate docs platform is more machinery than
  // this stage needs.
  pageExtensions: ["ts", "tsx", "md", "mdx"],
};

const withMDX = createMDX({});

export default withMDX(nextConfig);
