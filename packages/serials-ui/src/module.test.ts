import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SERIALS_FEATURES, SERIALS_PERMISSIONS } from "./lib/access";
import { serialsMessages } from "./lib/messages";
import { EVENT_TYPES, MANUAL_STATUSES, SERIAL_STATUSES } from "./lib/types";
import { serialsModule } from "./module";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });

describe("serials messages", () => {
  const en = Object.keys(serialsMessages.en).sort();
  const ta = Object.keys(serialsMessages.ta).sort();

  it("has the same keys in English and Tamil", () => {
    expect(ta).toEqual(en);
  });

  it("covers every key the module uses", () => {
    const src = files(__dirname).map((f) => readFileSync(f, "utf8")).join("\n");
    const accessKeys = new Set<string>([...Object.values(SERIALS_FEATURES), ...Object.values(SERIALS_PERMISSIONS)]);
    const used = new Set([...src.matchAll(/["`](serials\.[A-Za-z0-9_.]+)["`]/g)].map((m) => m[1]!).filter((k) => !accessKeys.has(k)));
    for (const s of SERIAL_STATUSES) used.add(`serials.status.${s}`);
    for (const s of MANUAL_STATUSES) used.add(`serials.unit.to.${s}`);
    for (const e of EVENT_TYPES) used.add(`serials.events.types.${e}`);
    for (const c of ["empty", "format", "imei_check", "duplicate_in_batch", "same_as_imei1", "exists"]) used.add(`serials.receive.problems.${c}`);
    expect([...used].filter((k) => !(k in serialsMessages.en))).toEqual([]);
  });
});

describe("serialsModule", () => {
  it("gates every route, nav item and widget by a serials feature and permission", () => {
    const m = serialsModule();
    expect(m.id).toBe("serials");
    expect(m.basePath).toBe("/serials");
    for (const r of m.routes) {
      expect(String(r.feature)).toMatch(/^serials/);
      expect(r.permission).toBeTruthy();
    }
    for (const i of m.nav.flatMap((s) => s.items)) expect(String(i.feature)).toMatch(/^serials/);
    for (const w of m.widgets ?? []) expect(String(w.feature)).toMatch(/^serials/);
    expect(m.routes.find((r) => r.path === "warranty")?.feature).toBe("serials.warranty");
  });

  it("takes basePath, features and widgets options", () => {
    const m = serialsModule({ basePath: "/phones", features: ["serials"], widgets: false, invoiceHref: (id) => `/billing/invoices/${id}` });
    expect(m.basePath).toBe("/phones");
    expect(m.features).toEqual(["serials"]);
    expect(m.widgets).toEqual([]);
  });
});
