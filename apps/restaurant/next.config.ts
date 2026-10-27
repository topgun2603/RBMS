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
    transpilePackages: ["@srirealtime/growth-ui", "@srirealtime/inbox-ui", "@srirealtime/pos-ui", "@srirealtime/payroll-ui", "@srirealtime/web", "@srirealtime/billing-ui", "@srirealtime/commerce-ui", "@srirealtime/orders-ui", "@srirealtime/restaurant-ui", "@srirealtime/workspace-ui", "@srirealtime/ui", "@srirealtime/i18n", "@srirealtime/gst", "@srirealtime/receipt-print", "@srirealtime/tenancy", "@srirealtime/site-ui", "@srirealtime/branding", "@srirealtime/verticals"],
    poweredByHeader: false,
    // Conservative security headers (no framing rule: the storefront preview and the shop apps embed each other).
    async headers() {
      return [
        {
          source: "/:path*",
          headers: [
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
            { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          ],
        },
      ];
    },
    // Each shop opens the app on its own subdomain (arusuvai.localhost:3007) in dev.
    allowedDevOrigins: ["*.localhost", "localhost", "127.0.0.1"],
  };
}
