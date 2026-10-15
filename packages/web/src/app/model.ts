/**
 * Pure routing / navigation model of a WebApp (no React): path helpers, route matching and the shell's nav built from
 * every module, given a visibility predicate (features + roles). Unit-tested in model.test.ts.
 */
import type { Gated, IconType, MountedModule, RouteDef, WebApp } from "./types";

/** "/" + "invoices/1" → "/invoices/1"; "/billing" + "" → "/billing"; "/billing" + "?x=1" → "/billing?x=1". */
export function joinPath(base: string, rel: string): string {
  const r = rel.replace(/^\/+/, "");
  const b = base === "/" ? "" : base.replace(/\/+$/, "");
  if (r === "" || r.startsWith("?") || r.startsWith("#")) return `${b || "/"}${r}`;
  return `${b}/${r}`;
}

/** "/billing/" → "/billing"; "" → "/". */
export function normalizeBase(base: string | undefined): string {
  const b = `/${(base ?? "/").trim().replace(/^\/+|\/+$/g, "")}`;
  return b === "/" ? "/" : b;
}

/** Path below `base`, or null when `path` isn't inside it. "/billing/invoices" in "/billing" → "invoices". */
export function relativeTo(base: string, path: string): string | null {
  if (base === "/") return path.replace(/^\/+|\/+$/g, "");
  if (path === base || path === `${base}/`) return "";
  if (path.startsWith(`${base}/`)) return path.slice(base.length + 1).replace(/\/+$/, "");
  return null;
}

/** Matches "invoices/:id" against "invoices/42" → { id: "42" }. */
export function matchPattern(pattern: string, rel: string): Record<string, string> | null {
  const p = pattern.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  const r = rel.split("/").filter(Boolean);
  if (p.length !== r.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    const val = r[i]!;
    if (seg.startsWith(":")) {
      try {
        params[seg.slice(1)] = decodeURIComponent(val);
      } catch {
        params[seg.slice(1)] = val;
      }
    } else if (seg !== val) return null;
  }
  return params;
}

export interface RouteMatch {
  module: MountedModule;
  route: RouteDef;
  params: Record<string, string>;
}

/** Longest basePath first, so "/billing/…" goes to billing even when another module sits at "/". */
export function matchRoute(app: Pick<WebApp, "modules">, path: string, pick: (m: MountedModule) => RouteDef[] | undefined): RouteMatch | null {
  const modules = [...app.modules].sort((a, b) => b.basePath.length - a.basePath.length);
  for (const module of modules) {
    const rel = relativeTo(module.basePath, path);
    if (rel === null) continue;
    for (const route of pick(module) ?? []) {
      const params = matchPattern(route.path, rel);
      if (params) return { module, route, params };
    }
  }
  return null;
}

/** `(gated, module) => boolean`: feature + role check (see useVisible). */
export type VisibleFn = (g: Gated, module?: Pick<MountedModule, "features">) => boolean;

export interface NavModelItem {
  href: string;
  /** Message keys. */
  label: string;
  tabLabel: string;
  icon?: IconType;
  exact: boolean;
  tab: boolean;
}

export interface NavModelSection {
  id: string;
  /** Message key. */
  title: string;
  items: NavModelItem[];
}

export interface NavModel {
  sections: NavModelSection[];
  primary: { href: string; label: string; icon?: IconType } | null;
}

/** Sidebar sections of every module (visible items only), then the Settings section; plus the app's primary action. */
export function buildNavModel(
  app: Pick<WebApp, "modules">,
  visible: VisibleFn,
  settings: { href: string; label: string; icon?: IconType }[],
  settingsTitle = "web.nav.settings",
): NavModel {
  const sections: NavModelSection[] = [];
  for (const m of app.modules) {
    for (const s of m.nav) {
      if (!visible(s, m)) continue;
      const items = s.items
        .filter((i) => visible(i, m))
        .map<NavModelItem>((i) => ({
          href: joinPath(m.basePath, i.href),
          label: i.label,
          tabLabel: i.tabLabel ?? i.label,
          icon: i.icon,
          exact: i.exact ?? i.href.replace(/^\/+/, "") === "",
          tab: i.mobile === "tab",
        }));
      if (items.length) sections.push({ id: `${m.id}:${s.id}`, title: s.title, items });
    }
  }
  if (settings.length) {
    sections.push({
      id: "settings",
      title: settingsTitle,
      items: settings.map((p) => ({ href: p.href, label: p.label, tabLabel: p.label, icon: p.icon, exact: true, tab: false })),
    });
  }
  let primary: NavModel["primary"] = null;
  outer: for (const m of app.modules)
    for (const a of m.actions ?? [])
      if (a.primary && visible(a, m)) {
        primary = { href: joinPath(m.basePath, a.href), label: a.label, icon: a.icon };
        break outer;
      }
  return { sections, primary };
}
