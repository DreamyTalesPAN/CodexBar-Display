import path from "node:path";
import type { NextConfig } from "next";

const localStaticExport =
  process.env.VIBETV_CONTROL_CENTER_LOCAL_EXPORT === "1";
const configuredRepoRoot = process.env.VIBETV_REPO_ROOT;
const repoRoot = localStaticExport
  ? process.cwd()
  : configuredRepoRoot
    ? path.resolve(configuredRepoRoot)
    : path.resolve(process.cwd(), "../..");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  ...(localStaticExport
    ? { output: "export" as const }
    : {
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
      }),
  turbopack: {
    root: repoRoot,
  },
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    "/api/theme-pack/[themeId]": ["../../theme-packs/**/*"],
  },
  images: {
    unoptimized: localStaticExport,
    remotePatterns: [
      { protocol: "https", hostname: "cdn.shopify.com" },
      { protocol: "https", hostname: "vibetv.shop" },
      { protocol: "https", hostname: "raw.githubusercontent.com" },
      { protocol: "https", hostname: "github.com" },
    ],
  },
};

export default nextConfig;
