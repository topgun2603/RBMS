import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchRoute, normalizeBase, type MountedModule } from "@rbms/web";
import { BLOCK_TYPES, HOME_SECTION_TYPES, MENU_ITEM_TYPES, USP_ICONS } from "./lib/content";
import { DEVICE_KEYS, RANGE_PRESETS } from "./lib/analytics";
import { siteMessages } from "./lib/messages";
import { AUTO_APPROVE, FUNNEL_STEPS, REVIEW_STATUSES } from "./lib/types";
import { SITE_FEATURES, siteModule } from "./module";

const mount = (basePath = "/"): MountedModule => {
  const m = siteModule({ basePath });
  return { ...m, basePath: normalizeBase(m.basePath) };
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });
}

describe("siteModule", () => {
  it("declares a feature on every nav item, route, widget and settings page", () => {
    const m = siteModule();
    expect(m.id).toBe("site");
    for (const s of m.nav) for (const i of s.items) expect(i.feature, i.href).toBeTruthy();
    for (const r of m.routes) expect(r.feature, r.path).toBeTruthy();
    for (const w of m.widgets ?? []) expect(w.feature, w.id).toBeTruthy();
    for (const p of m.settings ?? []) expect(p.feature, p.path).toBeTruthy();
  });

  it("gates each area with the right feature", () => {
    const m = siteModule();
    const nav = Object.fromEntries(m.nav[0]!.items.map((i) => [i.href, i.feature]));
    expect(nav).toEqual({ "home-page": "cms", pages: "cms", blog: "cms.blog", menus: "cms", reviews: "reviews", analytics: "analytics" });
    const settings = Object.fromEntries((m.settings ?? []).map((p) => [p.path, p.feature]));
    expect(settings).toEqual({ store: SITE_FEATURES.storefront, branding: SITE_FEATURES.storefront, appearance: SITE_FEATURES.storefront, domain: SITE_FEATURES.customDomain });
    expect((m.settings ?? []).find((p) => p.path === "appearance")?.roles).toEqual(["owner", "admin"]);
    expect((m.settings ?? []).find((p) => p.path === "branding")?.roles).toEqual(["owner", "admin"]);
    expect((m.settings ?? []).find((p) => p.path === "domain")?.roles).toEqual(["owner", "admin"]);
    expect(Object.fromEntries((m.widgets ?? []).map((w) => [w.id, w.feature]))).toEqual({ "site-store": "cms", "site-visitors": "analytics", "site-reviews": "reviews" });
    expect(Object.fromEntries((m.widgets ?? []).map((w) => [w.id, w.zone]))).toEqual({ "site-store": "secondary", "site-visitors": "kpi", "site-reviews": "attention" });
  });

  it("matches new before :id and honours a base path", () => {
    const app = { modules: [mount("/")] } as Parameters<typeof matchRoute>[0];
    const id = "0b6f5f36-0000-4000-8000-000000000000";
    expect(matchRoute(app, "/pages/new", (m) => m.routes)?.route.path).toBe("pages/new");
    expect(matchRoute(app, `/pages/${id}`, (m) => m.routes)?.params).toEqual({ id });
    expect(matchRoute(app, "/blog/new", (m) => m.routes)?.route.path).toBe("blog/new");
    expect(matchRoute(app, `/blog/${id}`, (m) => m.routes)?.route.path).toBe("blog/:id");
    const nested = { modules: [mount("/site")] } as Parameters<typeof matchRoute>[0];
    expect(matchRoute(nested, "/site/home-page", (m) => m.routes)?.route.path).toBe("home-page");
  });

  it("never imports next/* or another UI module", () => {
    for (const file of sources(__dirname)) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/from ["']next\//);
      expect(src, file).not.toMatch(/from ["']@rbms\/(billing-ui|commerce-ui|orders-ui|storefront-ui|workspace-ui|cms|reviews|analytics|tenancy)["']/);
    }
  });
});

describe("messages", () => {
  const { en, ta } = siteMessages;

  it("has the same keys in English and Tamil", () => {
    expect(Object.keys(ta).sort()).toEqual(Object.keys(en).sort());
  });

  it("defines every literal site.* key used in the source", () => {
    const used = new Set<string>();
    for (const file of sources(__dirname)) {
      for (const m of readFileSync(file, "utf8").matchAll(/["'`](site\.[a-zA-Z0-9_.-]+)["'`]/g)) used.add(m[1]!);
    }
    const missing = [...used].filter((k) => !(k in en) && !k.endsWith("."));
    expect(missing).toEqual([]);
  });

  it("defines every key built from a type list", () => {
    const want = [
      ...HOME_SECTION_TYPES.flatMap((s) => [`site.home.type.${s}`, `site.home.typeHint.${s}`]),
      ...USP_ICONS.map((i) => `site.home.uspIcon.${i}`),
      ...BLOCK_TYPES.map((b) => `site.blocks.type.${b}`),
      ...MENU_ITEM_TYPES.flatMap((m) => [`site.menus.types.${m}`, `site.menus.target.${m}`]),
      ...MENU_ITEM_TYPES.filter((m) => m !== "url").flatMap((m) => [`site.pickers.pick.${m}`, `site.pickers.none.${m}`]),
      ...REVIEW_STATUSES.flatMap((s) => [`site.reviews.status.${s}`, `site.reviews.empty.${s}`, `site.reviews.emptyHint.${s}`]),
      ...AUTO_APPROVE.flatMap((a) => [`site.reviews.auto.${a}`, `site.reviews.autoHint.${a}`]),
      ...RANGE_PRESETS.map((r) => `site.analytics.preset.${r}`),
      ...FUNNEL_STEPS.map((s) => `site.analytics.step.${s}`),
      ...DEVICE_KEYS.map((d) => `site.analytics.device.${d}`),
      ...["direct", "google", "facebook", "instagram", "whatsapp", "youtube"].map((s) => `site.analytics.source.${s}`),
      ...["shipping", "returns", "privacy", "terms"].flatMap((p) => [`site.store.policy.${p}`, `site.store.policyTemplate.${p}`]),
      ...["invalid", "reserved", "taken"].map((s) => `site.slug.${s}`),
      ...["required", "minItems", "tooMany", "tooBig", "tooLong", "invalid", "url"].map((c) => `site.validation.${c}`),
    ];
    expect(want.filter((k) => !(k in en))).toEqual([]);
  });

  it("uses Tamil script for Tamil strings", () => {
    const latinOnly = Object.entries(ta).filter(([, v]) => !/[஀-௿]/.test(v) && !/^[A-Z0-9 ()%/.{}+·#-]+$/i.test(v));
    // Brand names and bare numbers stay Latin.
    const allowed = /(source\.(google|facebook|instagram|whatsapp|youtube)|charts\.(up|down))$/;
    expect(latinOnly.map(([k]) => k).filter((k) => !allowed.test(k))).toEqual([]);
  });

  it("uses no Hindi terms in Tamil or English", () => {
    const hindi = /\b(khata|khaata|udhaar|udhar|bahi|dukaan|dukan|grahak|kharid|bikri|maal)\b/i;
    for (const [k, v] of [...Object.entries(en), ...Object.entries(ta)]) expect(v, k).not.toMatch(hindi);
    expect(Object.values(ta).join(" ")).not.toMatch(/[ऀ-ॿ]/); // no Devanagari
  });

  it("keeps the same {placeholders} in both languages", () => {
    const vars = (s: string) =>
      [...s.matchAll(/\{([a-zA-Z]\w*)(?=[},])/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i).sort();
    const diff = Object.keys(en).filter((k) => JSON.stringify(vars(en[k]!)) !== JSON.stringify(vars(ta[k]!)));
    expect(diff).toEqual([]);
  });
});
