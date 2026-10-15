import { configureApi } from "../lib/api";
import { setErrorNamespaces } from "../lib/i18n";
import { webMessages } from "../lib/messages";
import { setTenantStrategy } from "../lib/tenant";
import { SHOP_ROLES } from "../lib/auth";
import { joinPath, normalizeBase } from "./navigation";
import type { MountedModule, WebApp, WebAppOptions } from "./types";

/**
 * Describes an app built from UI modules. Call it once at module level (e.g. `src/web-app.ts`) and render it with
 * `<WebAppRouter app={webApp} />` from a single optional catch-all page (`app/[[...slug]]/page.tsx`).
 */
export function createWebApp(opts: WebAppOptions): WebApp {
  const modules: MountedModule[] = opts.modules.map((m) => ({ ...m, basePath: normalizeBase(m.basePath) }));
  const ids = new Set<string>();
  for (const m of modules) {
    if (ids.has(m.id)) throw new Error(`createWebApp: module "${m.id}" is mounted twice`);
    ids.add(m.id);
  }

  // Public pages (shared bills, statements) must never bounce to the login screen on a 401.
  const publicPrefixes = new Set<string>();
  for (const m of modules)
    for (const r of m.publicRoutes ?? []) {
      const staticHead = r.path.split("/").filter(Boolean).filter((s) => !s.startsWith(":"))[0] ?? "";
      publicPrefixes.add(joinPath(m.basePath, staticHead));
    }

  const app: WebApp = {
    appId: opts.appId,
    name: opts.name ?? opts.appId,
    tenant: opts.tenant,
    modules,
    home: opts.home ?? null,
    roles: opts.roles ?? SHOP_ROLES,
    loginPath: "/login",
    settingsPath: "/settings",
    bundles: [webMessages, ...modules.map((m) => m.messages), ...(opts.messages ? [opts.messages] : [])],
    namespaces: ["web", ...modules.map((m) => m.id)],
  };

  setTenantStrategy(opts.tenant);
  configureApi({ loginPath: app.loginPath, publicPrefixes: [...publicPrefixes] });
  setErrorNamespaces(modules.map((m) => m.id));
  return app;
}
