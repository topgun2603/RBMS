import { AppError, tooMany, type SrModule } from "@srirealtime/core";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";

/**
 * Read-only demo sign-in ("Live demo" on the marketing site, docs/demo-access.md).
 *
 * - `POST /v1/auth/demo { shop }` signs a visitor in as a dedicated per-shop demo user (never the owner), for the shops
 *   listed in `DEMO_SHOPS` only (empty = the feature is off). The user is marked with the platform role `demo`, is a
 *   `staff` member of that one shop with the built-in `role:demo` (view permissions only), and its session lasts 2 hours.
 * - `demoGuard` is a context hook (after auth) that, for demo users only, refuses every write, a few sensitive reads
 *   and any other shop. Server-side, so no client can get around it.
 */

/** Platform role on the dedicated demo users; the one marker the guard and the apps look at (`/v1/auth/me` → user.platformRoles). */
export const DEMO_PLATFORM_ROLE = "demo";
/** Tenant role key (`role:demo`), a built-in role template in @srirealtime/staff. */
export const DEMO_ROLE = "role:demo";
export const DEMO_SESSION_MS = 2 * 60 * 60_000;
export const DEMO_DEFAULT_LIMITS = { perWindow: 12, windowMs: 10 * 60_000 };

export const parseDemoShops = (v: string | undefined | null): Set<string> =>
  new Set(
    (v ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

/** Non-GET requests a demo session may still make (harmless: no data is written). */
export const DEMO_WRITE_ALLOWLIST: ReadonlySet<string> = new Set(["POST /v1/auth/logout"]);

/** Reads a demo session may not make at all: bulk exports, team and key management, consent exports, audit log, messaging setup. */
export const DEMO_BLOCKED_PREFIXES: readonly string[] = [
  "/v1/importexport",
  "/v1/developer",
  "/v1/consent",
  "/v1/staff",
  "/v1/audit",
  "/v1/whatsapp",
  "/v1/notify",
  "/v1/subscriptions",
  "/v1/payments",
  "/v1/kyc",
  "/v1/tenancy/members",
  "/v1/tenancy/domains",
  "/v1/auth/handoff",
  "/v1/auth/store/handoff",
  "/v1/auth/settings",
  "/v1/auth/users",
];

const pathOf = (req: FastifyRequest) => {
  const p = req.url.split("?")[0]!.toLowerCase();
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
};

export const demoReadOnly = () => new AppError(403, "demo_read_only", "This is a read-only demo. Create your own shop to make changes.");

export interface DemoGuardDeps {
  /** When the session was created (null = unknown session). Called once per session, then cached. */
  sessionCreatedAt(sessionId: string): Promise<Date | null>;
  /** Revoke an expired demo session (best effort). */
  revoke?(sessionId: string, userId: string): Promise<void>;
  now?: () => number;
  ttlMs?: number;
}

export function demoGuard(deps: DemoGuardDeps) {
  const created = new Map<string, number>();
  const now = deps.now ?? Date.now;
  const ttl = deps.ttlMs ?? DEMO_SESSION_MS;
  return (app: FastifyInstance) => {
    app.addHook("onRequest", async (req) => {
      const user = req.ctx.user;
      if (!user || !user.platformRoles.includes(DEMO_PLATFORM_ROLE)) return;

      // 1. Expiry: a handoff mints a normal web session, so the demo's short life is enforced here.
      let at = created.get(user.sessionId);
      if (at === undefined) {
        const d = await deps.sessionCreatedAt(user.sessionId);
        at = d ? d.getTime() : 0;
        if (created.size > 5000) created.clear();
        created.set(user.sessionId, at);
      }
      if (now() - at > ttl) {
        created.delete(user.sessionId);
        await deps.revoke?.(user.sessionId, user.id).catch(() => undefined);
        req.ctx.user = null;
        throw new AppError(401, "demo_expired", "The demo session has ended. Open the demo again from the website.");
      }

      // 2. One shop only: the demo user is a member of exactly one; any other shop resolves to no roles.
      if (req.ctx.tenant && user.tenantRoles.length === 0) {
        throw new AppError(403, "demo_wrong_shop", "This demo session works only in its own shop.");
      }
      if (req.ctx.tenant && !user.tenantRoles.includes(DEMO_ROLE)) throw new AppError(403, "demo_wrong_shop", "This demo session works only in its own shop.");

      // 3. Sensitive reads and shop switching.
      const path = pathOf(req);
      if (DEMO_BLOCKED_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))) {
        throw new AppError(403, "demo_not_available", "This is not available in the demo.");
      }

      // 4. Read-only.
      const method = req.method.toUpperCase();
      if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
      if (DEMO_WRITE_ALLOWLIST.has(`${method} ${path}`)) return;
      throw demoReadOnly();
    });
  };
}

/** What the sign-in route needs; apps/api wires these to tenancy, auth and the database. */
export interface DemoAuthDeps {
  shops: ReadonlySet<string>;
  tenants: { getBySlug(slug: string): Promise<{ id: string; slug: string; status: string } | null> };
  users: {
    ensureDemoUser(slug: string): Promise<{ id: string }>;
  };
  memberships: { rolesFor(tenantId: string, userId: string): Promise<string[]>; addMember(tenantId: string, userId: string, roles: string[]): Promise<unknown> };
  sessions: { createDemoSession(userId: string, meta: { ip?: string | null; userAgent?: string | null }, expiresAt: Date): Promise<{ token: string }> };
  handoffs: {
    create(userId: string, meta: { ip?: string | null }, tenantId: string): Promise<{ code: string; expiresAt: Date; expiresInSeconds: number }>;
    appUrl(userId: string, tenantId: string): Promise<string>;
  };
  /** Per-IP limiter: `hit` false = too many. */
  limiter: { hit(key: string): boolean };
  loginUrl(appUrl: string, code: string): string;
  now?: () => number;
  log?: { info(o: unknown, m?: string): void };
}

const demoBody = z.object({ shop: z.string().trim().toLowerCase().min(1).max(63) });

/** A pseudo-module mounted at `/v1/auth/demo` (POST). */
export function demoAuthModule(deps: DemoAuthDeps): SrModule {
  const now = deps.now ?? Date.now;
  return {
    id: "auth/demo",
    routes: (app: FastifyInstance) => {
      app.post("/", { config: { audit: false } }, async (req) => {
        const { shop } = demoBody.parse(req.body ?? {});
        if (!deps.limiter.hit(req.ctx.ip ?? "unknown")) throw tooMany("Too many demo sign-ins. Please wait a few minutes and try again");
        const notAvailable = () => new AppError(404, "demo_not_available", "This shop has no live demo.");
        if (!deps.shops.has(shop)) throw notAvailable();
        const tenant = await deps.tenants.getBySlug(shop);
        if (!tenant || tenant.status !== "active") throw notAvailable();

        const user = await deps.users.ensureDemoUser(tenant.slug);
        const roles = await deps.memberships.rolesFor(tenant.id, user.id);
        if (roles.length !== 2 || roles[0] !== "staff" || roles[1] !== DEMO_ROLE) await deps.memberships.addMember(tenant.id, user.id, ["staff", DEMO_ROLE]);

        const expiresAt = new Date(now() + DEMO_SESSION_MS);
        const meta = { ip: req.ctx.ip, userAgent: req.ctx.userAgent };
        const session = await deps.sessions.createDemoSession(user.id, meta, expiresAt);
        const h = await deps.handoffs.create(user.id, { ip: req.ctx.ip }, tenant.id);
        const appUrl = await deps.handoffs.appUrl(user.id, tenant.id);
        deps.log?.info({ shop: tenant.slug }, "demo sign-in");
        return {
          token: session.token,
          expiresAt,
          shop: tenant.slug,
          readOnly: true,
          code: h.code,
          handoffExpiresAt: h.expiresAt,
          appUrl,
          url: deps.loginUrl(appUrl, h.code),
        };
      });
    },
  };
}
