import type { NextConfig } from "next";
import { resolve } from "node:path";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";

export default function config(phase: string): NextConfig {
  return {
    reactStrictMode: true,
    // `next dev` and `next build` write to different folders, so running a build while the dev server is up
    // doesn't delete the files the dev server is serving.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    // The Docker image build (docker/next.Dockerfile, NEXT_OUTPUT=standalone) also writes a self-contained server to
    // .next/standalone. Off otherwise: `next dev`, `next start` (CI e2e) and Windows builds (standalone copies pnpm
    // symlinks, which fail there without Developer Mode) behave exactly as before.
    ...(phase === PHASE_PRODUCTION_BUILD && process.env.NEXT_OUTPUT === "standalone"
      ? { output: "standalone" as const, outputFileTracingRoot: resolve(process.cwd(), "../..") }
      : {}),
    // Workspace packages ship TypeScript source; Next compiles them.
    transpilePackages: ["@srirealtime/growth-ui", "@srirealtime/inbox-ui", "@srirealtime/pos-ui", "@srirealtime/web", "@srirealtime/billing-ui", "@srirealtime/pharmacy-ui", "@srirealtime/workspace-ui", "@srirealtime/ui", "@srirealtime/i18n", "@srirealtime/gst", "@srirealtime/tenancy", "@srirealtime/orders-ui", "@srirealtime/site-ui", "@srirealtime/commerce-ui", "@srirealtime/branding", "@srirealtime/verticals"],
    poweredByHeader: false,
    // Each shop opens the app on its own subdomain (medplus.localhost:3006) in dev.
    allowedDevOrigins: ["*.localhost", "localhost", "127.0.0.1"],
  };
}
