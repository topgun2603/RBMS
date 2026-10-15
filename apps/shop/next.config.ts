import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function config(phase: string): NextConfig {
  return {
    reactStrictMode: true,
    // `next dev` and `next build` write to different folders, so running a build while the dev server is up
    // doesn't delete the files the dev server is serving.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    // Workspace packages ship TypeScript source; Next compiles them.
    transpilePackages: [
      "@srirealtime/web",
      "@srirealtime/billing-ui",
      "@srirealtime/commerce-ui",
      "@srirealtime/orders-ui",
      "@srirealtime/site-ui",
      "@srirealtime/workspace-ui",
      "@srirealtime/ui",
      "@srirealtime/i18n",
      "@srirealtime/gst",
    ],
    poweredByHeader: false,
    // Each shop opens the store admin on its own subdomain (anbu.localhost:3002) in dev.
    allowedDevOrigins: ["*.localhost", "localhost", "127.0.0.1"],
  };
}
