import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JOBCARDS_FEATURES, JOBCARDS_PERMISSIONS } from "./lib/access";
import { jobcardsMessages } from "./lib/messages";
import { draftFromFields, draftToFields, emptyDraft, EYES, FIELD_ERRORS, GARMENT_TYPES, LENS_TYPES, MEASURE_KEYS, RX_FIELDS } from "./lib/templates";
import { JOB_FLOW, JOB_STATUSES, JOB_TEMPLATES, LINE_KINDS } from "./lib/types";
import { jobcardsModule } from "./module";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });

describe("jobcards messages", () => {
  const en = Object.keys(jobcardsMessages.en).sort();
  const ta = Object.keys(jobcardsMessages.ta).sort();

  it("has the same keys in English and Tamil", () => {
    expect(ta).toEqual(en);
  });

  it("covers every key the module uses", () => {
    const src = files(__dirname).map((f) => readFileSync(f, "utf8")).join("\n");
    // Feature and permission keys share the "jobcards." prefix but aren't messages.
    const keys = new Set<string>([...Object.values(JOBCARDS_FEATURES), ...Object.values(JOBCARDS_PERMISSIONS)]);
    const used = new Set([...src.matchAll(/["`](jobcards\.[A-Za-z0-9_.]+)["`]/g)].map((m) => m[1]!).filter((k) => !keys.has(k)));
    for (const s of JOB_STATUSES) used.add(`jobcards.status.${s}`);
    for (const s of JOB_FLOW.slice(1)) used.add(`jobcards.move.${s}`);
    for (const s of JOB_TEMPLATES) used.add(`jobcards.template.${s}`).add(`jobcards.templateHint.${s}`);
    for (const g of GARMENT_TYPES) used.add(`jobcards.garment.${g}`);
    for (const k of MEASURE_KEYS) used.add(`jobcards.measure.${k}`);
    for (const l of LENS_TYPES) used.add(`jobcards.lens.${l}`);
    for (const f of RX_FIELDS) used.add(`jobcards.rx.${f}`);
    for (const e of EYES) used.add(`jobcards.rx.${e}`).add(`jobcards.rx.${e}Short`);
    for (const e of FIELD_ERRORS) used.add(`jobcards.fields.error.${e}`);
    for (const k of LINE_KINDS) used.add(`jobcards.lines.kinds.${k}`);
    expect([...used].filter((k) => !(k in jobcardsMessages.en))).toEqual([]);
  });
});

describe("jobcardsModule", () => {
  it("gates every route, nav item, action and widget by a jobcards feature and permission", () => {
    const m = jobcardsModule();
    expect(m.id).toBe("jobcards");
    expect(m.basePath).toBe("/jobs");
    for (const r of m.routes) {
      expect(String(r.feature)).toMatch(/^jobcards/);
      expect(r.permission).toBeTruthy();
    }
    for (const i of m.nav.flatMap((s) => s.items)) expect(String(i.feature)).toMatch(/^jobcards/);
    for (const a of m.actions ?? []) expect(a.permission).toBe("jobcards.manage");
    for (const w of m.widgets ?? []) expect(w.zone).toBe("attention");
    expect(jobcardsModule({ widgets: false, basePath: "/service" })).toMatchObject({ basePath: "/service", widgets: [] });
  });
});

describe("template forms", () => {
  it("turns a device draft into fields and requires the problem", () => {
    const d = emptyDraft();
    expect(draftToFields("device", d).error).toBe("issue");
    d.device = { ...d.device, brand: "Redmi", issue: "No display", accessories: "charger, , back cover" };
    expect(draftToFields("device", d).fields).toMatchObject({ brand: "Redmi", model: null, issue: "No display", accessories: ["charger", "back cover"] });
  });

  it("keeps only filled measurements and rejects text", () => {
    const d = emptyDraft();
    d.garment.measurements = [
      { key: "bust", value: "36" },
      { key: "waist", value: "" },
    ];
    expect(draftToFields("garment", d).fields).toMatchObject({ garmentType: "blouse", measurements: { bust: 36 } });
    d.garment.measurements = [{ key: "bust", value: "abc" }];
    expect(draftToFields("garment", d).error).toBe("measurement");
  });

  it("checks the Rx grid: quarter steps, axis with a cylinder, PD range", () => {
    const d = emptyDraft();
    d.eyewear.right = { sph: "-1.25", cyl: "-0.50", axis: "90", add: "" };
    d.eyewear.left = { sph: "+0.75", cyl: "", axis: "", add: "1.5" };
    d.eyewear.pd = "62";
    expect(draftToFields("eyewear", d).fields).toMatchObject({ right: { sph: -1.25, cyl: -0.5, axis: 90, add: null }, left: { sph: 0.75, add: 1.5 }, pd: 62 });
    d.eyewear.left.sph = "-1.3";
    expect(draftToFields("eyewear", d).error).toBe("rx");
    d.eyewear.left.sph = "";
    d.eyewear.right.axis = "";
    expect(draftToFields("eyewear", d).error).toBe("axis");
  });

  it("reads saved fields back into a draft", () => {
    const d = draftFromFields("garment", { garmentType: "pant", measurements: { waist: 32, rise: 11 }, fabricReceived: true });
    expect(d.garment.garmentType).toBe("pant");
    expect(d.garment.measurements.find((m) => m.key === "waist")?.value).toBe("32");
    expect(d.garment.measurements.at(-1)).toEqual({ key: "rise", value: "11" });
  });
});
