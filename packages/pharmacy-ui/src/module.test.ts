import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pharmacyMessages } from "./lib/messages";
import { BATCH_STATUSES, MEDICINE_SCHEDULES, MOVEMENT_REASONS } from "./lib/types";
import { pharmacyModule } from "./module";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });

describe("pharmacy messages", () => {
  const en = Object.keys(pharmacyMessages.en).sort();
  const ta = Object.keys(pharmacyMessages.ta).sort();

  it("has the same keys in English and Tamil", () => {
    expect(ta).toEqual(en);
  });

  it("covers every key the module uses", () => {
    const src = files(__dirname).map((f) => readFileSync(f, "utf8")).join("\n");
    const used = new Set([...src.matchAll(/["`](pharmacy\.[A-Za-z0-9_.]+)["`]/g)].map((m) => m[1]!));
    for (const s of MEDICINE_SCHEDULES) used.add(`pharmacy.schedule.${s}`).add(`pharmacy.scheduleHint.${s}`);
    for (const s of BATCH_STATUSES) used.add(`pharmacy.batches.status.${s}`);
    for (const r of MOVEMENT_REASONS) used.add(`pharmacy.movements.reasons.${r}`);
    for (const k of ["count", "expired", "damaged", "return_to_supplier"]) used.add(`pharmacy.adjust.kinds.${k}`);
    expect([...used].filter((k) => !(k in pharmacyMessages.en))).toEqual([]);
  });
});

describe("pharmacyModule", () => {
  it("gates every route and nav item by a medicines feature", () => {
    const m = pharmacyModule();
    expect(m.basePath).toBe("/pharmacy");
    for (const r of m.routes) expect(String(r.feature)).toMatch(/^medicines/);
    for (const i of m.nav.flatMap((s) => s.items)) expect(String(i.feature)).toMatch(/^medicines/);
  });
});
