import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENQUIRIES_FEATURES, ENQUIRIES_PERMISSIONS } from "./lib/access";
import { ago, aboutLine, phoneLabel, telUrl, whatsappUrl } from "./lib/format";
import { enquiriesMessages } from "./lib/messages";
import { ENQUIRY_STATUSES } from "./lib/types";
import { enquiriesModule } from "./module";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });

describe("enquiries messages", () => {
  it("has the same keys in English and Tamil", () => {
    expect(Object.keys(enquiriesMessages.ta).sort()).toEqual(Object.keys(enquiriesMessages.en).sort());
  });

  it("covers every key the module uses", () => {
    const src = files(__dirname).map((f) => readFileSync(f, "utf8")).join("\n");
    const used = new Set([...src.matchAll(/["`](enquiries\.[A-Za-z0-9_.]+)["`]/g)].map((m) => m[1]!));
    for (const s of ENQUIRY_STATUSES) used.add(`enquiries.status.${s}`);
    for (const k of ["justNow", "minutes", "hours", "days"]) used.add(`enquiries.ago.${k}`);
    for (const k of [...Object.values(ENQUIRIES_FEATURES), ...Object.values(ENQUIRIES_PERMISSIONS)]) used.delete(k);
    expect([...used].filter((k) => !(k in enquiriesMessages.en))).toEqual([]);
  });

  it("words a school's converted enquiries as admitted", () => {
    expect(enquiriesMessages.en["enquiries.status.admitted"]).toBe("Admitted");
    expect(enquiriesMessages.en["enquiries.detail.studentSchool"]).toBe("Student");
  });
});

describe("enquiriesModule", () => {
  it("gates the routes, nav and widget by the enquiries feature and permission", () => {
    const m = enquiriesModule();
    expect(m.id).toBe("enquiries");
    expect(m.basePath).toBe("/enquiries");
    for (const r of m.routes) {
      expect(r.feature).toBe("enquiries");
      expect(r.permission).toBe("enquiries.manage");
    }
    for (const i of m.nav.flatMap((s) => s.items)) {
      expect(i.feature).toBe("enquiries");
      expect(i.permission).toBe("enquiries.manage");
    }
    expect(m.routes.map((r) => r.path)).toEqual(["", ":id"]);
    expect(m.widgets?.map((w) => w.zone)).toEqual(["kpi"]);
    expect(m.widgets?.[0]?.feature).toBe("enquiries");
    expect(enquiriesModule({ basePath: "/leads", widgets: false }).widgets).toEqual([]);
  });
});

describe("format helpers", () => {
  it("builds call and WhatsApp links", () => {
    expect(telUrl("+919876543210")).toBe("tel:+919876543210");
    expect(whatsappUrl("+919876543210")).toBe("https://wa.me/919876543210");
    expect(phoneLabel("+919876543210")).toBe("98765 43210");
    expect(phoneLabel("+14155550123")).toBe("+14155550123");
  });

  it("describes what an enquiry is about", () => {
    expect(aboutLine({ topic: "Admission 2027-28", option: "Class 1", studentName: "Kavin" })).toBe("Admission 2027-28 · Class 1 · Kavin");
    expect(aboutLine({ topic: null, option: null, studentName: null })).toBe("");
  });

  it("gives relative times for the last week only", () => {
    const now = Date.parse("2026-10-28T12:00:00Z");
    expect(ago("2026-10-28T11:59:40Z", now)).toEqual({ key: "justNow", count: 0 });
    expect(ago("2026-10-28T11:30:00Z", now)).toEqual({ key: "minutes", count: 30 });
    expect(ago("2026-10-28T09:00:00Z", now)).toEqual({ key: "hours", count: 3 });
    expect(ago("2026-10-25T12:00:00Z", now)).toEqual({ key: "days", count: 3 });
    expect(ago("2026-10-01T12:00:00Z", now)).toBeNull();
  });
});
