import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { daysLeftTone, paiseToRupees, phoneLabel, presetFor, renewalStart, rupeesToPaise } from "./lib/format";
import { MEMBERSHIPS_FEATURES, MEMBERSHIPS_PERMISSIONS } from "./lib/access";
import { membershipsConfig } from "./lib/config";
import { membershipsMessages } from "./lib/messages";
import { CHECKIN_REFUSALS, ERROR_CODES, MEMBER_STATUSES, SUBSCRIPTION_STATES } from "./lib/types";
import { membershipsModule } from "./module";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });

describe("memberships messages", () => {
  it("has the same keys in English and Tamil", () => {
    expect(Object.keys(membershipsMessages.ta).sort()).toEqual(Object.keys(membershipsMessages.en).sort());
  });

  it("covers every key the module uses", () => {
    const src = files(__dirname).map((f) => readFileSync(f, "utf8")).join("\n");
    const used = new Set([...src.matchAll(/["`](memberships\.[A-Za-z0-9_.]+)["`]/g)].map((m) => m[1]!));
    for (const s of MEMBER_STATUSES) used.add(`memberships.status.${s}`);
    for (const s of SUBSCRIPTION_STATES) used.add(`memberships.state.${s}`);
    for (const r of CHECKIN_REFUSALS) used.add(`memberships.checkin.reason.${r}`);
    for (const c of ERROR_CODES) used.add(`memberships.errors.${c}`);
    // Feature and permission keys share the prefix but aren't messages.
    for (const k of [...Object.values(MEMBERSHIPS_FEATURES), ...Object.values(MEMBERSHIPS_PERMISSIONS)]) used.delete(k);
    expect([...used].filter((k) => !(k in membershipsMessages.en))).toEqual([]);
  });
});

describe("membershipsModule", () => {
  it("gates every route and nav item by a memberships feature and makes check-in immersive", () => {
    const m = membershipsModule({ invoiceHref: (id) => `/billing/invoices/${id}` });
    expect(m.id).toBe("memberships");
    expect(m.basePath).toBe("/members");
    for (const r of m.routes) expect(String(r.feature)).toMatch(/^memberships/);
    for (const i of m.nav.flatMap((s) => s.items)) expect(String(i.feature)).toMatch(/^memberships/);
    const checkin = m.routes.find((r) => r.path === "checkin");
    expect(checkin?.immersive).toBe(true);
    expect(checkin?.feature).toBe("memberships.checkin");
    expect(m.routes.findIndex((r) => r.path === "checkin")).toBeLessThan(m.routes.findIndex((r) => r.path === "m/:id"));
    expect(m.settings?.map((s) => s.path)).toEqual(["memberships"]);
    expect(m.widgets?.map((w) => w.zone)).toEqual(["attention", "kpi"]);
    expect(membershipsConfig().invoiceHref("abc")).toBe("/billing/invoices/abc");
    expect(membershipsModule({ basePath: "/gym", widgets: false }).widgets).toEqual([]);
  });
});

describe("format helpers", () => {
  it("converts rupees and paise", () => {
    expect(rupeesToPaise("1,500")).toBe(150000);
    expect(rupeesToPaise("₹ 99.5")).toBe(9950);
    expect(rupeesToPaise("12.345")).toBeNull();
    expect(rupeesToPaise("")).toBeNull();
    expect(paiseToRupees(150000)).toBe("1500");
    expect(paiseToRupees(9950)).toBe("99.50");
  });

  it("maps durations, tones, phones and renewal dates", () => {
    expect(presetFor(90)?.months).toBe(3);
    expect(presetFor(45)).toBeNull();
    expect(daysLeftTone(-1)).toBe("danger");
    expect(daysLeftTone(3, 7)).toBe("warning");
    expect(daysLeftTone(30, 7)).toBe("success");
    expect(phoneLabel("+919876543210")).toBe("98765 43210");
    expect(renewalStart("2026-10-30", "2026-10-20")).toBe("2026-10-31");
    expect(renewalStart("2026-10-01", "2026-10-20")).toBe("2026-10-20");
  });
});
