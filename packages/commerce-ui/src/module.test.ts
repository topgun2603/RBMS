import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchRoute, normalizeBase, type MountedModule } from "@srirealtime/web";
import { cartesian, comboKey, rupeesToPaise, slugify, variantTitle } from "./lib/format";
import { commerceMessages } from "./lib/messages";
import { commerceModule } from "./module";

const mount = (basePath = "/"): MountedModule => {
  const m = commerceModule({ basePath });
  return { ...m, basePath: normalizeBase(m.basePath) };
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });
}

describe("commerceModule", () => {
  it("declares a feature on every nav item, route, widget and action", () => {
    const m = commerceModule();
    for (const s of m.nav) for (const i of s.items) expect(i.feature, i.href).toBeTruthy();
    for (const r of m.routes) expect(r.feature, r.path).toBeTruthy();
    for (const w of m.widgets ?? []) expect(w.feature, w.id).toBeTruthy();
    for (const a of m.actions ?? []) expect(a.feature, a.id).toBeTruthy();
  });

  it("matches products/new before products/:id", () => {
    const app = { modules: [mount("/")] } as Parameters<typeof matchRoute>[0];
    expect(matchRoute(app, "/products/new", (m) => m.routes)?.route.path).toBe("products/new");
    expect(matchRoute(app, "/products/0b6f5f36-0000-4000-8000-000000000000", (m) => m.routes)?.params).toEqual({ id: "0b6f5f36-0000-4000-8000-000000000000" });
    expect(matchRoute(app, "/collections/new", (m) => m.routes)?.route.path).toBe("collections/new");
  });
});

describe("messages", () => {
  const { en, ta } = commerceMessages;

  it("has the same keys in English and Tamil", () => {
    expect(Object.keys(ta).sort()).toEqual(Object.keys(en).sort());
  });

  it("defines every literal commerce.* key used in the source", () => {
    const used = new Set<string>();
    for (const file of sources(join(__dirname))) {
      for (const m of readFileSync(file, "utf8").matchAll(/["'`](commerce\.[a-zA-Z0-9_.-]+)["'`]/g)) used.add(m[1]!);
    }
    const missing = [...used].filter((k) => !(k in en) && !k.endsWith("."));
    expect(missing).toEqual([]);
  });

  it("uses Tamil script for Tamil strings", () => {
    const latinOnly = Object.entries(ta).filter(([, v]) => !/[஀-௿]/.test(v) && !/^[A-Z0-9 ()%/.{}+·#-]+$/i.test(v));
    // Short technical labels (SKU, MRP, GST {rate}%) may stay Latin.
    expect(latinOnly.map(([k]) => k).filter((k) => !/(sku|mrp|gstAmount|hsn|skuFor|mrpFor|sort\.name|newCount)$/i.test(k))).toEqual([]);
  });
});

describe("format helpers", () => {
  it("builds every option combination", () => {
    const combos = cartesian([
      { name: "Size", values: ["S", "M"] },
      { name: "Colour", values: ["Red", "Blue"] },
    ]);
    expect(combos).toHaveLength(4);
    expect(variantTitle(combos[1]!, [{ name: "Size" }, { name: "Colour" }])).toBe("S / Blue");
    expect(comboKey({ Colour: "Red", Size: "S" })).toBe(comboKey({ Size: "S", Colour: "Red" }));
  });

  it("parses rupees and slugs", () => {
    expect(rupeesToPaise("1,249.50")).toBe(124950);
    expect(rupeesToPaise("abc")).toBeNull();
    expect(slugify("Kanchipuram Silk Saree – Red!")).toBe("kanchipuram-silk-saree-red");
    expect(slugify("பட்டுப் புடவை")).toBe("");
  });
});
