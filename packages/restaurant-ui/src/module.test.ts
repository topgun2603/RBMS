import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tableQrUrl } from "./lib/config";
import { restaurantMessages } from "./lib/messages";
import { minutesUntil, ONLINE_STATUSES, PROVIDERS } from "./lib/online";
import { KOT_STATUSES, ORDER_TYPES, PLATFORMS } from "./lib/types";
import { restaurantModule } from "./module";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });

describe("restaurant messages", () => {
  it("has the same keys in English and Tamil", () => {
    expect(Object.keys(restaurantMessages.ta).sort()).toEqual(Object.keys(restaurantMessages.en).sort());
  });

  it("covers every key the module uses", () => {
    const src = files(__dirname).map((f) => readFileSync(f, "utf8")).join("\n");
    const used = new Set([...src.matchAll(/["`](restaurant\.[A-Za-z0-9_.]+)["`]/g)].map((m) => m[1]!));
    for (const s of ORDER_TYPES) used.add(`restaurant.type.${s}`).add(`restaurant.open.${s}Title`);
    for (const s of KOT_STATUSES) used.add(`restaurant.kot.${s}`);
    for (const s of ["new", "preparing", "ready"]) used.add(`restaurant.kitchen.col.${s}`);
    for (const s of ["preparing", "ready", "served"]) used.add(`restaurant.kitchen.to.${s}`);
    for (const s of ["open", "billed", "cancelled"]) used.add(`restaurant.order.status.${s}`);
    for (const s of ONLINE_STATUSES) used.add(`restaurant.online.status.${s}`);
    for (const p of PLATFORMS) used.add(`restaurant.online.platform.${p}`);
    for (const p of PROVIDERS) used.add(`restaurant.online.provider.${p}`).add(`restaurant.online.provider.${p}Body`);
    for (const s of ["delivery", "pickup"]) used.add(`restaurant.online.type.${s}`);
    for (const s of ["prepaid", "cod"]) used.add(`restaurant.online.pay.${s}`);
    for (const s of ["eco_9_5", "restaurant"]) used.add(`restaurant.online.setup.tax.${s}`);
    expect([...used].filter((k) => !(k in restaurantMessages.en))).toEqual([]);
  });
});

describe("restaurantModule", () => {
  it("gates routes by dining features and makes the kitchen immersive", () => {
    const m = restaurantModule({ storeUrl: "http://{slug}.localhost:3003/" });
    expect(m.basePath).toBe("/dine");
    for (const r of m.routes) expect(String(r.feature)).toMatch(/^dining/);
    expect(m.routes.find((r) => r.path === "kitchen")?.immersive).toBe(true);
    expect(tableQrUrl("annapoorna", "abc123xyz")).toBe("http://annapoorna.localhost:3003/table/abc123xyz");
    expect(tableQrUrl(null, "abc123xyz")).toBeNull();
  });
});

describe("online platforms", () => {
  it("adds the online-orders page, nav, quick action and settings page behind dining.aggregators", () => {
    const m = restaurantModule();
    const online = m.routes.find((r) => r.path === "online");
    expect(online?.feature).toBe("dining.aggregators");
    expect(online?.permission).toEqual(["dining.serve", "dining.bill", "dining.kitchen"]);
    expect(m.nav?.[0]?.items.find((i) => i.href === "online")?.feature).toBe("dining.aggregators");
    expect(m.actions?.some((a) => a.href === "online")).toBe(true);
    const setup = m.settings?.find((s) => s.path === "online-platforms");
    expect(setup).toMatchObject({ feature: "dining.aggregators", permission: "dining.manage", label: "restaurant.nav.platforms" });
    // "online" sits before ":id" routes.
    expect(m.routes.findIndex((r) => r.path === "online")).toBeLessThan(m.routes.findIndex((r) => r.path === "orders/:id"));
  });

  it("counts down to pickup", () => {
    const now = Date.parse("2026-10-21T08:00:00Z");
    expect(minutesUntil("2026-10-21T08:12:00Z", now)).toBe(12);
    expect(minutesUntil("2026-10-21T07:57:00Z", now)).toBe(-3);
  });

  it("has Tamil for every online-platform message", () => {
    const keys = Object.keys(restaurantMessages.en).filter((k) => k.startsWith("restaurant.online."));
    expect(keys.length).toBeGreaterThan(80);
    for (const k of keys) expect(restaurantMessages.ta[k as keyof typeof restaurantMessages.ta], k).toBeTruthy();
  });
});
