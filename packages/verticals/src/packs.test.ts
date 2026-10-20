import { THEME_PRESETS } from "@srirealtime/branding";
import { describe, expect, it } from "vitest";
import { BUSINESS_TYPES, copyFor, packFor, packOrDefault, PACKS } from "./index";

describe("business packs", () => {
  it("ships 15 solutions, each with a real theme preset and full copy in both languages", () => {
    expect(BUSINESS_TYPES).toHaveLength(15);
    const presets = new Set(THEME_PRESETS.map((p) => p.id));
    for (const t of BUSINESS_TYPES) {
      const p = PACKS[t];
      expect(p.id).toBe(t);
      expect(presets.has(p.preset), `${t} preset ${p.preset}`).toBe(true);
      for (const lang of ["en", "ta"] as const) for (const [k, v] of Object.entries(p.copy[lang])) expect(v.trim(), `${t}.${lang}.${k}`).not.toBe("");
      expect(p.categories.length).toBeGreaterThan(2);
      expect(p.usps.length).toBeGreaterThan(0);
    }
  });

  it("only clothing and tailoring get the size guide; no clothing words leak into other packs", () => {
    expect(BUSINESS_TYPES.filter((t) => PACKS[t].sizeGuide)).toEqual(["fashion", "tailoring"]);
    for (const t of BUSINESS_TYPES.filter((t) => t !== "fashion")) expect(JSON.stringify(PACKS[t].copy.en), t).not.toMatch(/kurti|saree/i);
  });

  it("resolves aliases and falls back per app", () => {
    expect(packFor("Textiles")?.id).toBe("fashion");
    expect(packFor("medical")?.id).toBe("pharmacy");
    expect(packFor("cloud kitchen")?.id).toBe("cloud_kitchen");
    expect(packFor("other")).toBeNull();
    expect(packOrDefault(null, "RS").id).toBe("restaurant");
    expect(packOrDefault("", "PH").id).toBe("pharmacy");
    expect(copyFor(PACKS.grocery, "ta").search).toContain("அரிசி");
  });
});
