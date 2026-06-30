import path from "node:path";
import type { NextConfig } from "next";

const repoRoot = path.resolve(process.cwd(), "../..");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Permissions-Policy",
            value:
              "local-network-access=(self), loopback-network=(self), local-network=(self)",
          },
        ],
      },
    ];
  },
  turbopack: {
    root: repoRoot,
  },
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    "/api/theme-pack/[themeId]": ["../../theme-packs/**/*"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.shopify.com" },
      { protocol: "https", hostname: "vibetv.shop" },
      { protocol: "https", hostname: "raw.githubusercontent.com" },
      { protocol: "https", hostname: "github.com" },
    ],
  },
};

export default nextConfig;
