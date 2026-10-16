import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function config(phase: string): NextConfig {
  return {
    reactStrictMode: true,
    // `next dev` and `next build` write to different folders, so running a build while the dev server is up
    // doesn't delete the files the dev server is serving.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    // Workspace packages ship TypeScript source; Next compiles them.
    transpilePackages: ["@srirealtime/ui", "@srirealtime/i18n", "@srirealtime/tenancy"],
    poweredByHeader: false,
    // The marketing site lives on the bare root host (localhost:3005 in dev, the apex domain in production).
    allowedDevOrigins: ["localhost", "127.0.0.1"],
    images: { unoptimized: true },
  };
}
