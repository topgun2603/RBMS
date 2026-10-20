import { describe, expect, it } from "vitest";
import { featureChecker, normalizeFeatures } from "../lib/features";
import { buildNavModel, checkGate, joinPath, matchPattern, matchRoute, normalizeBase, relativeTo, visibleFor, type GateContext } from "./model";
import type { MountedModule } from "./types";

const C = () => null;

describe("paths", () => {
  it("joins module-relative paths at any basePath", () => {
    expect(joinPath("/", "")).toBe("/");
    expect(joinPath("/", "invoices/1")).toBe("/invoices/1");
    expect(joinPath("/billing", "")).toBe("/billing");
    expect(joinPath("/billing", "invoices?status=overdue")).toBe("/billing/invoices?status=overdue");
    expect(joinPath("/billing", "?tab=gst")).toBe("/billing?tab=gst");
    expect(joinPath("/", "?tab=gst")).toBe("/?tab=gst");
    expect(joinPath("/billing", "/stock")).toBe("/billing/stock");
  });

  it("normalises base paths", () => {
    expect(normalizeBase(undefined)).toBe("/");
    expect(normalizeBase("")).toBe("/");
    expect(normalizeBase("billing/")).toBe("/billing");
    expect(normalizeBase("/billing")).toBe("/billing");
  });

  it("finds the path below a base", () => {
    expect(relativeTo("/", "/invoices/1")).toBe("invoices/1");
    expect(relativeTo("/", "/")).toBe("");
    expect(relativeTo("/billing", "/billing")).toBe("");
    expect(relativeTo("/billing", "/billing/invoices")).toBe("invoices");
    expect(relativeTo("/billing", "/billingx")).toBeNull();
    expect(relativeTo("/billing", "/orders")).toBeNull();
  });

  it("matches patterns with params", () => {
    expect(matchPattern("invoices/:id", "invoices/42")).toEqual({ id: "42" });
    expect(matchPattern("invoices/:id", "invoices")).toBeNull();
    expect(matchPattern("", "")).toEqual({});
    expect(matchPattern("i/:token", "i/a%20b")).toEqual({ token: "a b" });
  });
});

describe("matchRoute", () => {
  const store: MountedModule = {
    id: "store",
    basePath: "/",
    messages: { en: {}, ta: {} },
    nav: [],
    routes: [{ path: "orders", component: C }],
  };
  const billing: MountedModule = {
    id: "billing",
    basePath: "/billing",
    messages: { en: {}, ta: {} },
    nav: [],
    routes: [
      { path: "", component: C },
      { path: "invoices/new", component: C },
      { path: "invoices/:id", component: C },
    ],
  };
  const app = { modules: [store, billing] };

  it("prefers the longest basePath and keeps declaration order", () => {
    expect(matchRoute(app, "/billing", (m) => m.routes)?.module.id).toBe("billing");
    expect(matchRoute(app, "/billing/invoices/new", (m) => m.routes)?.route.path).toBe("invoices/new");
    expect(matchRoute(app, "/billing/invoices/7", (m) => m.routes)?.params).toEqual({ id: "7" });
    expect(matchRoute(app, "/orders", (m) => m.routes)?.module.id).toBe("store");
    expect(matchRoute(app, "/nope", (m) => m.routes)).toBeNull();
  });
});

describe("buildNavModel", () => {
  const mod: MountedModule = {
    id: "billing",
    basePath: "/billing",
    messages: { en: {}, ta: {} },
    nav: [
      {
        id: "billing",
        title: "billing.nav.billing",
        items: [
          { href: "", label: "overview" },
          { href: "invoices", label: "bills", feature: "invoices", mobile: "tab" },
          { href: "credit-book", label: "credit", feature: "invoices.credit-book", mobile: "tab" },
          { href: "owner-only", label: "owner", roles: ["owner"] },
        ],
      },
    ],
    routes: [],
    actions: [{ id: "new", label: "new", href: "invoices/new", feature: "invoices", primary: true }],
  };
  const on = new Set(["invoices"]);
  const visible = (g: { feature?: string | readonly string[]; roles?: readonly string[] }) =>
    !g.roles && (g.feature === undefined || on.has(g.feature as string));

  it("keeps visible items with absolute hrefs, then settings, and finds the primary action", () => {
    const nav = buildNavModel({ modules: [mod] }, visible, [{ href: "/settings", label: "profile" }]);
    expect(nav.sections.map((s) => s.id)).toEqual(["billing:billing", "settings"]);
    expect(nav.sections[0]!.items.map((i) => i.href)).toEqual(["/billing", "/billing/invoices"]);
    expect(nav.sections[0]!.items[0]!.exact).toBe(true);
    expect(nav.primary?.href).toBe("/billing/invoices/new");
  });

  it("settings pages collapse into one Settings link, active on every settings page", () => {
    const nav = buildNavModel({ modules: [mod], settingsPath: "/settings" }, visible, [
      { href: "/settings", label: "profile" },
      { href: "/settings/payments", label: "payments" },
    ]);
    const settings = nav.sections.find((s) => s.id === "settings")!;
    expect(settings.title).toBeUndefined();
    expect(settings.items).toHaveLength(1);
    expect(settings.items[0]).toMatchObject({ href: "/settings", label: "web.nav.settings", exact: false });
    expect(buildNavModel({ modules: [mod] }, visible, []).sections.some((s) => s.id === "settings")).toBe(false);
  });
});

describe("permission gating (checkGate / visibleFor)", () => {
  const features = featureChecker(
    normalizeFeatures({
      appId: "EC",
      planId: "pro",
      features: [
        { key: "orders", module: "orders", label: "Orders", description: "", dependsOn: [], shopToggle: false, enabled: true, reason: null, available: true, shopEnabled: null },
        { key: "cms", module: "cms", label: "CMS", description: "", dependsOn: [], shopToggle: true, enabled: false, reason: "shop", available: true, shopEnabled: false },
      ],
    }),
  );
  const mod: MountedModule = {
    id: "store",
    basePath: "/",
    messages: { en: {}, ta: {} },
    nav: [
      {
        id: "sell",
        title: "sell",
        items: [
          { href: "orders", label: "orders", feature: "orders" },
          { href: "coupons", label: "coupons", feature: "orders", permission: "coupons.manage" },
          { href: "pages", label: "pages", feature: "cms", permission: "cms.manage" },
          { href: "analytics", label: "analytics", permission: ["reports.view", "analytics.view"] },
        ],
      },
      { id: "team", title: "team", permission: "staff.manage", items: [{ href: "team", label: "team" }] },
    ],
    routes: [
      { path: "orders", component: C, feature: "orders" },
      { path: "coupons", component: C, feature: "orders", permission: "coupons.manage" },
      { path: "pages", component: C, feature: "cms", permission: "cms.manage" },
      { path: "owners", component: C, roles: ["owner"], permission: "staff.manage" },
    ],
    widgets: [
      { id: "sales", size: "md", component: C, permission: "reports.view" },
      { id: "orders", size: "sm", component: C, feature: "orders" },
    ],
    actions: [
      { id: "new-coupon", label: "new", href: "coupons/new", permission: "coupons.manage", primary: true },
      { id: "new-order", label: "new order", href: "orders/new", feature: "orders", primary: true },
    ],
    settings: [
      { path: "", label: "profile", component: C },
      { path: "delivery", label: "delivery", component: C, permission: "settings.manage" },
      { path: "pages", label: "pages", component: C, feature: "cms", permission: "cms.manage" },
    ],
  };
  const ctx = (permissions: string[] | null, fullAccess = false, roles: string[] = ["staff"]): GateContext => ({
    roles,
    access: { fullAccess, permissions },
    checkFeature: features.check,
  });
  const route = (path: string) => matchRoute({ modules: [mod] }, path, (m) => m.routes)!;
  const gate = (path: string, c: GateContext) => {
    const m = route(path);
    return checkGate(m.route, m.module, c);
  };

  it("filters nav items, sections and the primary action by permission on top of features", () => {
    const visible = visibleFor(ctx(["orders.*", "analytics.view"]));
    const nav = buildNavModel({ modules: [mod] }, visible, []);
    expect(nav.sections.map((s) => s.id)).toEqual(["store:sell"]);
    expect(nav.sections[0]!.items.map((i) => i.href)).toEqual(["/orders", "/analytics"]);
    expect(nav.primary?.href).toBe("/orders/new");

    const withCoupons = buildNavModel({ modules: [mod] }, visibleFor(ctx(["coupons.*", "staff.manage"])), []);
    expect(withCoupons.sections.map((s) => s.id)).toEqual(["store:sell", "store:team"]);
    expect(withCoupons.sections[0]!.items.map((i) => i.href)).toEqual(["/orders", "/coupons"]);
    expect(withCoupons.primary?.href).toBe("/coupons/new");
  });

  it("never shows a feature that is off, even with `*`", () => {
    const nav = buildNavModel({ modules: [mod] }, visibleFor(ctx(["*"])), []);
    expect(nav.sections[0]!.items.map((i) => i.href)).toEqual(["/orders", "/coupons", "/analytics"]);
  });

  it("owners / admins / super-admins see every permission-gated item", () => {
    const nav = buildNavModel({ modules: [mod] }, visibleFor(ctx([], true, ["owner"])), []);
    expect(nav.sections.map((s) => s.id)).toEqual(["store:sell", "store:team"]);
    expect(nav.sections[0]!.items).toHaveLength(3);
  });

  it("filters widgets, actions and settings pages", () => {
    const v = visibleFor(ctx(["orders.view"]));
    expect(mod.widgets!.filter((w) => v(w, mod)).map((w) => w.id)).toEqual(["orders"]);
    expect(mod.actions!.filter((a) => v(a, mod)).map((a) => a.id)).toEqual(["new-order"]);
    expect(mod.settings!.filter((p) => v(p, mod)).map((p) => p.path)).toEqual([""]);
    const mgr = visibleFor(ctx(["settings.manage", "reports.view"]));
    expect(mod.widgets!.filter((w) => mgr(w, mod)).map((w) => w.id)).toEqual(["sales", "orders"]);
    expect(mod.settings!.filter((p) => mgr(p, mod)).map((p) => p.path)).toEqual(["", "delivery"]);
  });

  it("resolves a route the user lacks to the no-access gate", () => {
    expect(gate("/orders", ctx([]))).toEqual({ ok: true });
    expect(gate("/coupons", ctx(["orders.view"]))).toEqual({ ok: false, kind: "permission" });
    expect(gate("/coupons", ctx(["coupons.manage"]))).toEqual({ ok: true });
    expect(gate("/coupons", ctx(null))).toEqual({ ok: true }); // no permission list from the API: fail open
  });

  it("checks role first, then permission, then features", () => {
    expect(gate("/owners", ctx(["staff.manage"]))).toEqual({ ok: false, kind: "role" });
    expect(gate("/owners", ctx([], true, ["owner"]))).toEqual({ ok: true });
    expect(gate("/pages", ctx([]))).toEqual({ ok: false, kind: "permission" });
    expect(gate("/pages", ctx(["cms.manage"]))).toMatchObject({ ok: false, kind: "feature", check: { reason: "shop", cause: "cms" } });
  });

  it("applies the module's own feature restriction too", () => {
    const restricted = { features: ["invoices.*"] };
    expect(checkGate({ feature: "orders" }, restricted, ctx(["*"]))).toMatchObject({ ok: false, kind: "feature", check: { reason: "app" } });
  });
});
