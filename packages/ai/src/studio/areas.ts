import type { HomeDoc, MenuItem } from "@rbms/cms";
import type { BrandTokensPatch } from "@rbms/branding/tokens";
import { OpError, type AreaId, type StudioState } from "./types";

/**
 * The pieces of a shop's configuration Studio reads and writes. Each area has a typed value, a reader and a writer in
 * the API host (apps/api/src/kit-ai-studio.ts) that go through the existing services. Operations only change these
 * values in memory (`StudioState`); the engine diffs them, shows the change and writes the changed areas.
 */

export const AREA = {
  branding: "branding",
  home: "home",
  menu: (key: "header" | "footer") => `menu:${key}`,
  page: (slug: string) => `page:${slug}`,
  settings: (ns: string) => `settings:${ns}`,
  roles: "roles",
  discounts: "discounts",
  signin: "signin",
  feature: (key: string) => `feature:${key}`,
  /** The catalogue's categories (names only; the shop setup assistant adds starter groups and removes empty ones). */
  categories: "categories",
} as const;

export interface BrandingArea {
  appName: string | null;
  /** The shop's stored overrides (what is saved); platform defaults are merged at read time. */
  tokens: BrandTokensPatch;
}
export interface HomeArea {
  /** The live (published) home; null = the shop never published one (the automatic default shows). */
  doc: HomeDoc | null;
  /** The saved draft differs from the live home: Studio will not overwrite someone's unpublished edits. */
  unpublished: boolean;
}
export interface MenuArea {
  items: MenuItem[];
}
export interface PageArea {
  exists: boolean;
  id: string | null;
  slug: string;
  title: string;
  blocks: unknown[];
  status: "draft" | "published";
}
export interface SettingsArea {
  /** The shop's own saved keys (restoring writes these back, and removes keys that were not set). */
  layer: Record<string, unknown>;
  /** What applies now (defaults under the shop's layer). */
  effective: Record<string, unknown>;
}
export interface RoleRow {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  builtin: boolean;
}
export interface RolesArea {
  roles: RoleRow[];
}
export interface DiscountRow {
  scope: "role" | "user";
  subject: string;
  maxPercent: number | null;
  /** Paise per bill. */
  maxAmount: number | null;
}
export interface DiscountsArea {
  items: DiscountRow[];
}
export interface AudienceSignIn {
  methods: string[];
  default: string;
  requireMfa?: boolean;
}
export interface SignInArea {
  staff: AudienceSignIn;
  customer: AudienceSignIn;
}
export interface FeatureArea {
  key: string;
  label: string;
  /** The owner's own switch; null = never touched. */
  shopEnabled: boolean | null;
  /** Is it on now (plan, app and switch)? */
  enabled: boolean;
  /** Why it is off, when it is: app / plan / dependency / shop. */
  reason: "app" | "plan" | "dependency" | "shop" | null;
  shopToggle: boolean;
}

export interface CategoryRow {
  /** null = not created yet (added by a plan). */
  id: string | null;
  name: string;
  slug: string;
  /** Products in it now: only empty categories may be removed. */
  products: number;
  parentId: string | null;
}
export interface CategoriesArea {
  items: CategoryRow[];
}

/** Sets keys of a settings namespace (both the saved layer and the effective view). Settings merge one level deep: pass whole values. */
export function patchSettings(st: StudioState, ns: string, patch: Record<string, unknown>): void {
  const area = AREA.settings(ns);
  const cur = structuredClone(st.get<SettingsArea>(area));
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    // Setting a key to what already applies, with no saved override, changes nothing.
    if (!(k in cur.layer) && JSON.stringify(cur.effective[k] ?? null) === JSON.stringify(v ?? null)) continue;
    cur.layer[k] = v;
    cur.effective[k] = v;
  }
  st.set(area, cur);
}

export const settingsOf = (st: StudioState, ns: string): Record<string, unknown> => st.get<SettingsArea>(AREA.settings(ns)).effective;

export const bi = (en: string, ta?: string) => ({ en, ta: ta ?? en });

export function fail(code: string, en: string, ta: string): never {
  throw new OpError(code, { en, ta });
}

export type { AreaId };
