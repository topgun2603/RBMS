import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@srirealtime/ui", "@srirealtime/i18n"],
  poweredByHeader: false,
};

export default nextConfig;
