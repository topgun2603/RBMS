import { parseClient } from "@srirealtime/auth";
import { AppError, defineModule, documented, type SrModule } from "@srirealtime/core";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

/**
 * The srikit mobile apps (docs/market-plan.md, M0): `GET /v1/mobile/config` tells an app the minimum and latest
 * versions, and every request from an app older than the minimum gets 426 `app_update_required`, so a breaking API
 * change can force an update. Apps identify themselves with `x-client: srikit-<app>/<version> (<platform>)`.
 */

export interface MobileVersions {
  /** App name ("business", "shops") → lowest version allowed to call the API. */
  min: Record<string, string>;
  /** App name → newest version in the stores (apps offer an update when they are older). */
  latest: Record<string, string>;
}

/** "business=1.2.0,shops=1.0.0" → { business: "1.2.0", shops: "1.0.0" }. Bad pairs are ignored. */
export function parseVersionList(value: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (value ?? "").split(",")) {
    const m = /^\s*([a-z]+)\s*=\s*(\d+\.\d+\.\d+)\s*$/.exec(pair);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

/** Compares "1.2.3" style versions (pre-release / build suffixes ignored). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[+-]/)[0]!.split(".").map(Number);
  const pb = b.split(/[+-]/)[0]!.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** "srikit-business/1.0.0 (android)" → { app: "business", version: "1.0.0", platform: "android" }. */
export function clientInfo(header: string | string[] | undefined): { app: string; version: string; platform: string | null } | null {
  const c = parseClient(header);
  const m = c && /^srikit-([a-z]+)\/(\S+)(?: \((android|ios)\))?$/.exec(c);
  return m ? { app: m[1]!, version: m[2]!, platform: m[3] ?? null } : null;
}

const CONFIG_PATH = "/v1/mobile/config";

const configResponse = z.object({
  apps: z.record(z.object({ minVersion: z.string().nullable(), latestVersion: z.string().nullable() })),
  client: z.object({ app: z.string(), version: z.string(), platform: z.string().nullable() }).nullable(),
  updateRequired: z.boolean(),
  updateAvailable: z.boolean(),
});

export function createMobile(versions: MobileVersions): { module: SrModule; updateGuard: (req: FastifyRequest) => Promise<void> } {
  const updateRequired = (client: ReturnType<typeof clientInfo>) => {
    const min = client && versions.min[client.app];
    return !!min && compareVersions(client.version, min) < 0;
  };

  const module = defineModule({
    id: "mobile",
    routes: (app) => {
      // Public: apps call it on start-up, before sign-in, so it never needs a shop or a session.
      app.get("/config", documented({ response: configResponse }), async (req) => {
        const client = clientInfo(req.headers["x-client"]);
        const apps = Object.fromEntries(
          [...new Set([...Object.keys(versions.min), ...Object.keys(versions.latest)])].map((name) => [
            name,
            { minVersion: versions.min[name] ?? null, latestVersion: versions.latest[name] ?? null },
          ]),
        );
        const latest = client ? versions.latest[client.app] : undefined;
        return {
          apps,
          client,
          updateRequired: updateRequired(client),
          updateAvailable: !!client && !!latest && compareVersions(client.version, latest) < 0,
        };
      });
    },
  });

  return {
    module,
    /** Global preHandler: refuses requests from app versions below the minimum (except the config call). */
    async updateGuard(req) {
      if (req.url.split("?")[0] === CONFIG_PATH) return;
      const client = clientInfo(req.headers["x-client"]);
      if (updateRequired(client)) {
        throw new AppError(426, "app_update_required", "Please update the app to keep using it", { minVersion: versions.min[client!.app] });
      }
    },
  };
}
