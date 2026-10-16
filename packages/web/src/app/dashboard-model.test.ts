import { describe, expect, it } from "vitest";
import { KPI_LIMIT, layoutWidgets, mergeQuickActions, widgetZone } from "./model";
import type { MountedModule, WidgetDef } from "./types";

const C = () => null;
const all = () => true;
const mod = (id: string, basePath: string, widgets: Partial<WidgetDef>[], actions: MountedModule["actions"] = []): MountedModule => ({
  id,
  basePath,
  messages: { en: {}, ta: {} },
  nav: [],
  routes: [],
  widgets: widgets.map((w, i) => ({ id: w.id ?? `w${i}`, component: C, ...w })),
  actions,
});

describe("widget zones", () => {
  it("keeps older declarations working: sm → secondary, md/lg → main", () => {
    expect(widgetZone({ size: "sm" })).toBe("secondary");
    expect(widgetZone({})).toBe("secondary");
    expect(widgetZone({ size: "md" })).toBe("main");
    expect(widgetZone({ size: "lg" })).toBe("main");
    expect(widgetZone({ size: "lg", zone: "kpi" })).toBe("kpi");
  });

  it("groups by zone across modules, sorted by priority with module order breaking ties", () => {
    const app = {
      modules: [
        mod("orders", "/", [
          { id: "orders-today", zone: "kpi", priority: 20 },
          { id: "to-confirm", zone: "attention", priority: 20 },
          { id: "recent-orders", zone: "main", priority: 20 },
        ]),
        mod("billing", "/billing", [
          { id: "sales", zone: "kpi", priority: 10 },
          { id: "to-collect", zone: "kpi", priority: 40 },
          { id: "collected", zone: "kpi", priority: 45 },
          { id: "overdue", zone: "kpi", priority: 50 },
          { id: "overdue-bills", zone: "attention", priority: 10 },
          { id: "trend", zone: "main", priority: 10 },
          { id: "dues", zone: "side" },
          { id: "legacy", size: "sm" },
        ]),
        mod("site", "/", [{ id: "visitors", zone: "kpi", priority: 30 }, { id: "store", zone: "secondary", priority: 10 }]),
      ],
    };
    const z = layoutWidgets(app, all);
    const ids = (k: keyof typeof z) => z[k].map((p) => p.widget.id);
    expect(KPI_LIMIT).toBe(4);
    expect(ids("kpi")).toEqual(["sales", "orders-today", "visitors", "to-collect"]);
    expect(ids("attention")).toEqual(["overdue-bills", "to-confirm"]);
    expect(ids("main")).toEqual(["trend", "recent-orders"]);
    expect(ids("side")).toEqual(["dues"]);
    expect(ids("secondary")).toEqual(["store", "legacy"]);
    expect(z.kpi[1]!.module.id).toBe("orders");
  });

  it("applies visibility and a module filter (a module's own overview)", () => {
    const app = { modules: [mod("a", "/", [{ id: "x", zone: "kpi", feature: "off" }, { id: "y", zone: "kpi" }]), mod("b", "/b", [{ id: "z", zone: "kpi" }])] };
    const visible = (g: { feature?: unknown }) => g.feature !== "off";
    expect(layoutWidgets(app, visible).kpi.map((p) => p.widget.id)).toEqual(["y", "z"]);
    expect(layoutWidgets(app, visible, { modules: ["b"] }).kpi.map((p) => p.widget.id)).toEqual(["z"]);
  });
});

describe("quick actions", () => {
  it("puts the main action first, keeps module order and drops duplicates", () => {
    const app = {
      modules: [
        mod("store", "/", [], [{ id: "new-bill-copy", label: "billing.nav.newBill", href: "billing/invoices/new" }]),
        mod("orders", "/", [], [{ id: "new-order", label: "orders.nav.newOrder", href: "orders/new", primary: true }]),
        mod("billing", "/billing", [], [
          { id: "new-bill", label: "billing.nav.newBill", href: "invoices/new", primary: true },
          { id: "receive", label: "billing.receive", href: "credit-book?filter=due", feature: "off" },
        ]),
        mod("pos", "/pos", [], [{ id: "counter", label: "pos.open", href: "" }, { id: "again", label: "pos.again", href: "" }]),
      ],
    };
    const visible = (g: { feature?: unknown }) => g.feature !== "off";
    const merged = mergeQuickActions(app, visible);
    expect(merged.map((a) => a.id)).toEqual(["new-order", "new-bill-copy", "counter"]);
    expect(merged.map((a) => a.absHref)).toEqual(["/orders/new", "/billing/invoices/new", "/pos"]);
    expect(mergeQuickActions(app, visible, ["billing"]).map((a) => a.id)).toEqual(["new-bill"]);
  });
});
