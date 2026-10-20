import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tableQrUrl } from "./lib/config";
import { restaurantMessages } from "./lib/messages";
import { KOT_STATUSES, ORDER_TYPES } from "./lib/types";
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
