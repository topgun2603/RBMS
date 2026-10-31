import { joinPath, matchRoute, type MountedModule } from "@rbms/web";

/**
 * Onboarding step hrefs are hints relative to the app root ("settings/business", "invoices/new",
 * "catalogue/products/new"). Each app mounts modules at its own paths, so a hint is resolved against what is mounted:
 * 1. "settings/<page>" → that settings page when some module provides it, else the Settings home;
 * 2. the hint itself, or the hint under any module's basePath ("/billing/invoices/new");
 * 3. the hint without its first segment ("catalogue/products/new" → "products/new"), same way;
 * 4. known equivalents (a billing-only app adds products under "items");
 * 5. otherwise "/<hint>".
 */
const ALIASES: Record<string, string[]> = {
  "products/new": ["items"],
  "catalogue/products/new": ["products/new", "items"],
  "store/home": ["store", "content", "site"],
};

export interface StepHrefApp {
  modules: Pick<MountedModule, "basePath" | "routes" | "settings">[];
  settingsPath?: string;
}

const clean = (p: string) => p.replace(/^\/+|\/+$/g, "");

function settingsHref(app: StepHrefApp, page: string): string {
  const base = app.settingsPath ?? "/settings";
  const has = app.modules.some((m) => (m.settings ?? []).some((s) => clean(s.path) === page));
  return has || page === "features" ? joinPath(base, page) : base;
}

function routed(app: StepHrefApp, rel: string): string | null {
  const path = rel.split(/[?#]/)[0]!;
  const suffix = rel.slice(path.length);
  const asApp = { modules: app.modules as MountedModule[] };
  if (matchRoute(asApp, joinPath("/", path), (m) => m.routes)) return joinPath("/", path) + suffix;
  // Longest basePath first, like the router.
  const modules = [...app.modules].sort((a, b) => b.basePath.length - a.basePath.length);
  for (const m of modules) {
    const abs = joinPath(m.basePath, path);
    const hit = matchRoute(asApp, abs, (mm) => mm.routes);
    if (hit && hit.module.basePath === m.basePath) return abs + suffix;
  }
  return null;
}

export function resolveStepHref(app: StepHrefApp | null | undefined, hint: string): string {
  const rel = clean(hint);
  if (!app) return joinPath("/", rel);
  if (rel === "settings" || rel.startsWith("settings/")) return settingsHref(app, clean(rel.slice("settings".length)));
  const candidates = [rel];
  const rest = rel.split("/").slice(1).join("/");
  if (rest) candidates.push(rest);
  candidates.push(...(ALIASES[rel] ?? []), ...(rest ? (ALIASES[rest] ?? []) : []));
  for (const c of candidates) {
    const hit = routed(app, c);
    if (hit) return hit;
  }
  return joinPath("/", rel);
}
