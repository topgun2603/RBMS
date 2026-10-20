import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { barcodeParts, paiseToInput, parseKg, rupeesToPaise } from "./lib/format";
import { scalesMessages } from "./lib/messages";
import { SOLD_BY, VALUE_KINDS } from "./lib/types";
import { scalesModule } from "./module";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });

describe("scales messages", () => {
  it("has the same keys in English and Tamil", () => {
    expect(Object.keys(scalesMessages.ta).sort()).toEqual(Object.keys(scalesMessages.en).sort());
  });

  it("covers every key the module uses", () => {
    const src = files(__dirname).map((f) => readFileSync(f, "utf8")).join("\n");
    const used = new Set([...src.matchAll(/["`](scales\.[A-Za-z0-9_.]+)["`]/g)].map((m) => m[1]!));
    used.delete("scales.manage"); // permission key, not a message
    for (const s of SOLD_BY) used.add(`scales.soldBy.${s}`);
    for (const k of VALUE_KINDS) used.add(`scales.valueKind.${k}`).add(`scales.valueKindHint.${k}`);
    for (const c of ["plu_taken", "plu_full"]) used.add(`scales.errors.${c}`);
    expect([...used].filter((k) => !(k in scalesMessages.en))).toEqual([]);
  });
});

describe("scalesModule", () => {
  it("mounts at /weighing, gated by the scales feature and permission", () => {
    const m = scalesModule();
    expect(m.id).toBe("scales");
    expect(m.basePath).toBe("/weighing");
    for (const r of m.routes) expect([r.feature, r.permission]).toEqual(["scales", "scales.manage"]);
    for (const i of m.nav.flatMap((s) => s.items)) expect(i.feature).toBe("scales");
    expect(m.settings?.map((s) => [s.path, s.feature, s.permission])).toEqual([["weighing", "scales", "scales.manage"]]);
    expect(m.widgets).toHaveLength(1);
  });
  it("takes basePath, features and widgets options", () => {
    const m = scalesModule({ basePath: "/scale", features: ["scales"], widgets: false });
    expect(m.basePath).toBe("/scale");
    expect(m.features).toEqual(["scales"]);
    expect(m.widgets).toEqual([]);
  });
});

describe("format helpers", () => {
  it("converts rupees, paise and kg", () => {
    expect(rupeesToPaise("₹1,240.50")).toBe(124_050);
    expect(rupeesToPaise("12.345")).toBeNull();
    expect(paiseToInput(4_000)).toBe("40");
    expect(paiseToInput(4_050)).toBe("40.50");
    expect(paiseToInput(null)).toBe("");
    expect(parseKg("1,25")).toBe(1.25);
    expect(parseKg("0")).toBeNull();
    expect(parseKg("1.2345")).toBeNull();
  });
  it("splits a label into its parts", () => {
    expect(barcodeParts("2100042012509", { prefixes: ["21"], pluDigits: 5, valueDigits: 5 })).toEqual({ prefix: "21", plu: "00042", value: "01250", check: "9" });
  });
});
