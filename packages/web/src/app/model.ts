/**
 * Pure routing / navigation model of a WebApp (no React): path helpers, route matching and the shell's nav built from
 * every module, given a visibility predicate (features + roles). Unit-tested in model.test.ts.
 */
import type { FeatureCheck } from "../lib/features";
import { permissionAllows, roleAllows, type PermissionHolder } from "../lib/permissions";
import type { Gated, IconType, MountedModule, QuickAction, RouteDef, WebApp, WidgetDef, WidgetZone } from "./types";

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

/** `(gated, module) => boolean`: feature + role + permission check (see useVisible). */
export type VisibleFn = (g: Gated, module?: Pick<MountedModule, "features">) => boolean;

/** What the signed-in user brings to a gate check. */
export interface GateContext {
  /** Effective shop roles (a super-admin counts as owner). */
  roles: readonly string[];
  /** Permission holder (see permissionAllows). */
  access: PermissionHolder;
  /** Feature check (server + a module's own restriction), e.g. `featureChecker(data).check`. */
  checkFeature: (req: Gated["feature"], allow?: readonly string[]) => FeatureCheck;
}

/** Outcome of a gate: open, or which page to show instead (role → permission → feature, first failure wins). */
export type GateResult =
  | { ok: true }
  | { ok: false; kind: "role" }
  | { ok: false; kind: "permission" }
  | { ok: false; kind: "feature"; check: Extract<FeatureCheck, { ok: false }> };

export function checkGate(g: Gated, module: Pick<MountedModule, "features"> | undefined, ctx: GateContext): GateResult {
  if (!roleAllows(ctx.roles, g.roles)) return { ok: false, kind: "role" };
  if (!permissionAllows(ctx.access, g.permission, { explicit: g.permissionExplicit })) return { ok: false, kind: "permission" };
  const check = ctx.checkFeature(g.feature, module?.features);
  return check.ok ? { ok: true } : { ok: false, kind: "feature", check };
}

/** VisibleFn over a GateContext: visible when the gate is open. */
export const visibleFor =
  (ctx: GateContext): VisibleFn =>
  (g, module) =>
    checkGate(g, module, ctx).ok;

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

// ---------------------------------------------------------------- dashboard

/** How many KPI tiles the strip shows (the lowest priorities win). */
export const KPI_LIMIT = 4;

export const WIDGET_ZONES: readonly WidgetZone[] = ["setup", "kpi", "attention", "main", "side", "secondary"];

/** A widget's zone: its own, else from its size (sm → secondary, md/lg → main) so older declarations keep working. */
export function widgetZone(w: Pick<WidgetDef, "zone" | "size">): WidgetZone {
  return w.zone ?? (w.size === "md" || w.size === "lg" ? "main" : "secondary");
}

export interface PlacedWidget {
  widget: WidgetDef;
  module: MountedModule;
}

/**
 * Visible widgets of the given modules grouped by zone, each zone sorted by priority (default 100, ties keep module
 * order), the KPI strip cut to `kpiLimit`.
 */
export function layoutWidgets(
  app: Pick<WebApp, "modules">,
  visible: VisibleFn,
  opts: { modules?: readonly string[]; kpiLimit?: number } = {},
): Record<WidgetZone, PlacedWidget[]> {
  const zones = Object.fromEntries(WIDGET_ZONES.map((z) => [z, [] as PlacedWidget[]])) as Record<WidgetZone, PlacedWidget[]>;
  let seq = 0;
  const order = new Map<PlacedWidget, number>();
  for (const m of app.modules) {
    if (opts.modules && !opts.modules.includes(m.id)) continue;
    for (const w of m.widgets ?? []) {
      if (!visible(w, m)) continue;
      const p = { widget: w, module: m };
      order.set(p, seq++);
      zones[widgetZone(w)].push(p);
    }
  }
  for (const z of WIDGET_ZONES)
    zones[z].sort((a, b) => (a.widget.priority ?? 100) - (b.widget.priority ?? 100) || order.get(a)! - order.get(b)!);
  zones.kpi = zones.kpi.slice(0, opts.kpiLimit ?? KPI_LIMIT);
  return zones;
}

export interface MergedAction extends QuickAction {
  module: MountedModule;
  absHref: string;
}

/**
 * Every visible quick action as one list: the app's main action (first visible `primary`) first, then module order;
 * duplicates (same target or same label) dropped, the first one kept.
 */
export function mergeQuickActions(app: Pick<WebApp, "modules">, visible: VisibleFn, modules?: readonly string[]): MergedAction[] {
  const all: MergedAction[] = [];
  for (const m of app.modules) {
    if (modules && !modules.includes(m.id)) continue;
    for (const a of m.actions ?? []) if (visible(a, m)) all.push({ ...a, module: m, absHref: joinPath(m.basePath, a.href) });
  }
  const main = all.findIndex((a) => a.primary);
  if (main > 0) all.unshift(...all.splice(main, 1));
  const hrefs = new Set<string>();
  const labels = new Set<string>();
  return all.filter((a) => {
    const href = a.absHref;
    if (hrefs.has(href) || labels.has(a.label)) return false;
    hrefs.add(href);
    labels.add(a.label);
    return true;
  });
}
