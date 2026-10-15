import { describe, expect, it } from "vitest";
import { buildNavModel, joinPath, matchPattern, matchRoute, normalizeBase, relativeTo } from "./model";
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
});
