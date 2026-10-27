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
    transpilePackages: ["@srirealtime/growth-ui", "@srirealtime/marketplace-ui", "@srirealtime/inbox-ui", "@srirealtime/pos-ui", "@srirealtime/payroll-ui", "@srirealtime/web", "@srirealtime/billing-ui", "@srirealtime/commerce-ui", "@srirealtime/orders-ui", "@srirealtime/site-ui", "@srirealtime/workspace-ui", "@srirealtime/ui", "@srirealtime/i18n", "@srirealtime/gst", "@srirealtime/receipt-print",
      // Only its browser-safe `@srirealtime/tenancy/slug` (shop address rules) is imported by the web kit.
      "@srirealtime/tenancy", "@srirealtime/branding", "@srirealtime/verticals", "@srirealtime/serials-ui", "@srirealtime/scales-ui", "@srirealtime/jewellery-ui"],
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
    // Each shop opens the store admin on its own subdomain (anbu.localhost:3002) in dev.
    allowedDevOrigins: ["*.localhost", "localhost", "127.0.0.1"],
  };
}
