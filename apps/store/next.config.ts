import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function config(phase: string): NextConfig {
  return {
    reactStrictMode: true,
    // `next dev` and `next build` write to different folders, so running a build while the dev server is up
    // doesn't delete the files the dev server is serving.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    // Workspace packages ship TypeScript source; Next compiles them.
    transpilePackages: ["@srirealtime/storefront-ui", "@srirealtime/ui", "@srirealtime/i18n", "@srirealtime/cms", "@srirealtime/gst"],
    poweredByHeader: false,
    // Each shop's store opens on its own subdomain (anbu.localhost:3003) in dev; custom domains in production.
    allowedDevOrigins: ["*.localhost", "localhost", "127.0.0.1"],
    // Product images are plain <img> (shop uploads + any https host); next/image isn't used.
    images: { unoptimized: true },
  };
}
