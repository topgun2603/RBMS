import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addMonths, bpToPercent, minutesLabel, paiseToRupees, parseHalfDays, percentToBp, rupeesToPaise } from "./lib/format";
import { PAYROLL_FEATURES, PAYROLL_PERMISSIONS } from "./lib/access";
import { payrollMessages } from "./lib/messages";
import {
  ATTENDANCE_STATUSES,
  DUE_KINDS,
  ERROR_CODES,
  EXPECTED_DAYS,
  LEAVE_STATUSES,
  LINE_WARNINGS,
  MONTHLY_BASES,
  PAY_METHODS,
  PAY_TYPES,
  PT_MODES,
  RUN_STATUSES,
} from "./lib/types";
import { payrollModule } from "./module";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });

describe("payroll messages", () => {
  it("has the same keys in English and Tamil", () => {
    expect(Object.keys(payrollMessages.ta).sort()).toEqual(Object.keys(payrollMessages.en).sort());
  });

  it("covers every key the module uses", () => {
    const src = files(__dirname).map((f) => readFileSync(f, "utf8")).join("\n");
    const used = new Set([...src.matchAll(/["`](payroll\.[A-Za-z0-9_.-]+)["`]/g)].map((m) => m[1]!));
    const add = (prefix: string, keys: readonly string[]) => keys.forEach((k) => used.add(`${prefix}.${k}`));
    add("payroll.status", [...ATTENDANCE_STATUSES, "unmarked"]);
    add("payroll.expected", EXPECTED_DAYS);
    add("payroll.run.status", RUN_STATUSES);
    add("payroll.warning", LINE_WARNINGS);
    add("payroll.method", PAY_METHODS);
    add("payroll.payType", PAY_TYPES);
    add("payroll.leave.status", LEAVE_STATUSES);
    add("payroll.leave.done", ["approve", "reject", "cancel"]);
    add("payroll.dues.kind", DUE_KINDS);
    add("payroll.settings.basisOpt", MONTHLY_BASES);
    add("payroll.settings.ptModeOpt", PT_MODES);
    add("payroll.kiosk.hello", ["morning", "afternoon", "evening"]);
    add("payroll.errors", ERROR_CODES);
    // Feature and permission keys share the prefix but aren't messages.
    for (const k of [...Object.values(PAYROLL_FEATURES), ...Object.values(PAYROLL_PERMISSIONS)]) used.delete(k);
    expect([...used].filter((k) => !(k in payrollMessages.en))).toEqual([]);
  });

  it("never names the platform vendor in customer text", () => {
    const all = [...Object.values(payrollMessages.en), ...Object.values(payrollMessages.ta)].join("\n");
    expect(all).not.toMatch(/srikit|srirealtime/i);
  });
});

describe("payrollModule", () => {
  it("gates every route and nav item by a payroll feature, salary pages by payroll.salary + payroll.manage", () => {
    const m = payrollModule();
    expect(m.id).toBe("payroll");
    expect(m.basePath).toBe("/staff");
    for (const r of m.routes) expect(String(r.feature)).toMatch(/^payroll/);
    for (const i of m.nav.flatMap((s) => s.items)) expect(String(i.feature)).toMatch(/^payroll/);
    for (const path of ["payroll", "payroll/:id", "advances", "dues"]) {
      const r = m.routes.find((x) => x.path === path)!;
      expect(r.feature).toBe("payroll.salary");
      expect(r.permission).toBe("payroll.manage");
    }
    // My attendance needs no permission (the API shows only the linked record).
    expect(m.routes.find((r) => r.path === "me")?.permission).toBeUndefined();
    expect(m.routes.find((r) => r.path === "kiosk")?.immersive).toBe(true);
    expect(m.routes.findIndex((r) => r.path === "payroll")).toBeLessThan(m.routes.findIndex((r) => r.path === "payroll/:id"));
    expect(m.settings?.map((s) => s.path)).toEqual(["payroll"]);
    expect(payrollModule({ basePath: "/team" }).basePath).toBe("/team");
  });

  it("knows a message for every API error code", () => {
    for (const c of ERROR_CODES) expect(payrollMessages.en[`payroll.errors.${c}`]).toBeTruthy();
  });
});

describe("format helpers", () => {
  it("converts rupees, percent and days", () => {
    expect(rupeesToPaise("1,500")).toBe(150000);
    expect(rupeesToPaise("12.345")).toBeNull();
    expect(paiseToRupees(150000)).toBe("1500");
    expect(paiseToRupees(9950)).toBe("99.50");
    expect(paiseToRupees(null)).toBe("");
    expect(percentToBp("12")).toBe(1200);
    expect(percentToBp("0.75")).toBe(75);
    expect(percentToBp("101")).toBeNull();
    expect(bpToPercent(325)).toBe("3.25");
    expect(parseHalfDays("1.5")).toBe(1.5);
    expect(parseHalfDays("1.25")).toBeNull();
    expect(parseHalfDays("-2", true)).toBe(-2);
    expect(parseHalfDays("-2")).toBeNull();
  });

  it("formats minutes and months", () => {
    expect(minutesLabel(65)).toBe("1h 05m");
    expect(minutesLabel(45)).toBe("45m");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});
