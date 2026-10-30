import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildNavModel, featureChecker, normalizeBase, permissionAllows, visibleFor, type FeatureState, type MountedModule } from "@rbms/web";
import { POS_FEATURES, POS_PERMISSIONS } from "./lib/access";
import { posMessages } from "./lib/messages";
import { SHORTCUTS } from "./lib/shortcuts";
import { posModule } from "./module";

const state = (key: string, enabled: boolean): FeatureState => ({
  key,
  module: key.split(".")[0]!,
  label: key,
  description: "",
  dependsOn: [],
  shopToggle: true,
  enabled,
  reason: enabled ? null : "plan",
  available: enabled,
  shopEnabled: null,
});

describe("terminal mode and Settings → POS terminals", () => {
  it("terminal mode is a public route (a paired device has no staff sign-in)", () => {
    const m = posModule();
    expect(m.publicRoutes?.map((r) => r.path)).toEqual(["terminal", "display"]);
    // It gates itself from GET /pos/device; no feature on the route (visitors would just see not found).
    expect(m.publicRoutes?.[0]?.feature).toBeUndefined();
  });

  it("the terminals settings page needs pos.terminals and pos.devices", () => {
    const m: MountedModule = { ...posModule(), basePath: normalizeBase("/pos") };
    const page = m.settings?.find((p) => p.path === "pos-terminals");
    expect(page).toMatchObject({ feature: POS_FEATURES.terminals, permission: POS_PERMISSIONS.devices, label: "pos.nav.terminals" });
    const ctx = (on: boolean, perms: string[] | null, fullAccess = false) => {
      const { check } = featureChecker({ appId: "BL", planId: "starter", enabled: on ? ["pos.terminals"] : [], features: [state("pos.terminals", on)] });
      return { roles: ["staff"], access: { fullAccess, permissions: perms }, checkFeature: check };
    };
    expect(visibleFor(ctx(true, ["pos.devices"]))(page!, m)).toBe(true);
    expect(visibleFor(ctx(true, ["invoices.create"]))(page!, m)).toBe(false);
    expect(visibleFor(ctx(true, [], true))(page!, m)).toBe(true);
    expect(visibleFor(ctx(false, ["pos.devices"]))(page!, m)).toBe(false);
    expect(POS_PERMISSIONS.weigh).toBe("pos.weigh");
    expect(POS_FEATURES.weighing).toBe("pos.weighing");
  });
});

describe("posModule", () => {
  it("mounts at /pos by default with one immersive route gated by invoices + invoices.create", () => {
    const m = posModule();
    expect(m.id).toBe("pos");
    expect(m.basePath).toBe("/pos");
    expect(m.routes).toHaveLength(1);
    expect(m.routes[0]).toMatchObject({ path: "", immersive: true, feature: "invoices", permission: "invoices.create" });
    expect(posModule({ basePath: "/counter" }).basePath).toBe("/counter");
  });

  it("gates every nav item, route and action", () => {
    const m = posModule();
    const gated = [...m.routes, ...m.nav, ...m.nav.flatMap((s) => s.items), ...(m.actions ?? [])];
    for (const g of gated) {
      expect(g.feature).toBe(POS_FEATURES.invoices);
      expect(g.permission).toBe(POS_PERMISSIONS.create);
    }
    const item = m.nav[0]!.items[0]!;
    expect(item.label).toBe("pos.nav.counter");
    expect(item.icon).toBeTruthy();
    expect(item.href.startsWith("/")).toBe(false);
  });

  it("shows the counter only when invoices is on", () => {
    const m: MountedModule = { ...posModule(), basePath: normalizeBase("/pos") };
    const nav = (on: boolean) => {
      const { check } = featureChecker({ appId: "BL", planId: "pro", enabled: on ? ["invoices"] : [], features: [state("invoices", on)] });
      return buildNavModel({ modules: [m] }, (g) => check(g.feature, m.features).ok, []).sections.flatMap((s) => s.items.map((i) => i.href));
    };
    expect(nav(true)).toEqual(["/pos"]);
    expect(nav(false)).toEqual([]);
  });

  it("needs invoices.create unless the member has full access", () => {
    expect(permissionAllows({ fullAccess: false, permissions: ["invoices.create"] }, POS_PERMISSIONS.create)).toBe(true);
    expect(permissionAllows({ fullAccess: false, permissions: ["invoices.*"] }, POS_PERMISSIONS.create)).toBe(true);
    expect(permissionAllows({ fullAccess: false, permissions: ["reports.view"] }, POS_PERMISSIONS.create)).toBe(false);
    expect(permissionAllows({ fullAccess: true, permissions: [] }, POS_PERMISSIONS.create)).toBe(true);
    expect(POS_PERMISSIONS.discount).toBe("invoices.discount");
    expect(POS_PERMISSIONS.cancel).toBe("invoices.cancel");
  });
});

/** Every .ts/.tsx file under src except tests. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("messages", () => {
  const { en, ta } = posMessages;

  it("has the same keys in English and Tamil, all under pos.*", () => {
    expect(Object.keys(ta).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en)) expect(k.startsWith("pos.")).toBe(true);
  });

  it("defines every pos.* key the code uses (literal and built)", () => {
    const used = new Set<string>();
    for (const f of sources(__dirname)) {
      // messages.ts defines them; access.ts holds permission keys (e.g. "pos.till"), not messages.
      if (f.endsWith("messages.ts") || f.endsWith("access.ts")) continue;
      for (const m of readFileSync(f, "utf8").matchAll(/["'`](pos\.[a-zA-Z0-9_.]+)["'`]/g)) used.add(m[1]!);
    }
    const built = [
      ...["unsupported", "denied", "error"].flatMap((s) => [`pos.scan.${s}Title`, `pos.scan.${s}Body`]),
      ...["cash", "upi", "card", "credit", "points", "other"].map((m) => `pos.pay.method.${m}`),
      ...["short", "overNonCash", "upiUnconfirmed", "creditNeedsCustomer", "creditUnavailable", "nothingToPay"].map((p) => `pos.pay.problem.${p}`),
      ...["cash", "upi", "card", "bank", "cheque", "other", "credit"].map((m) => `pos.day.method.${m}`),
      ...SHORTCUTS.map((s) => s.description),
      ...["idle", "expired", "locked"].map((n) => `pos.lock.notice.${n}`),
      ...["format", "invalid", "tooMany", "network", "wrongShop", "featureOff", "other"].map((e) => `pos.pair.error.${e}`),
      ...["open", "used", "cancelled"].map((s) => `pos.weigh.status.${s}`),
      ...["notFound", "used", "expired", "cancelled", "network", "other"].map((e) => `pos.ticket.error.${e}`),
      ...["weak", "taken"].map((e) => `pos.pin.error.${e}`),
      ...["petty_expense", "owner_drawing", "change_float", "other"].map((c) => `pos.cash.cat.${c}`),
      ...["58", "80", "a4"].map((p) => `pos.day.paper.${p}`),
      ...["auto", "en", "ta"].map((l) => `pos.display.lang.${l}`),
      ...["format", "weak", "mismatch"].map((e) => `pos.pin.problem.${e}`),
    ];
    expect(used.size).toBeGreaterThan(200);
    expect([...used, ...built].filter((k) => !(k in en))).toEqual([]);
  });

  it("uses Tamil script for the Tamil strings (no Latin-only translations, no Hindi terms)", () => {
    const tamil = /[஀-௿]/;
    // Brand / tax terms that stay as they are.
    const latinOk = /^[A-Z0-9 ()%/.{}+·#:₹−-]*$/;
    const latin = Object.keys(en).filter((k) => !tamil.test(ta[k]!) && !latinOk.test(ta[k]!.replace(/\{[^}]+\}/g, "")));
    expect(latin).toEqual([]);
    const hindi = /khata|udhaar|udhar|hisaab|rupaye|dukaan|गल्ला|खाता|[ऀ-ॿ]/i;
    expect(Object.values(ta).filter((v) => hindi.test(v))).toEqual([]);
    expect(Object.values(en).filter((v) => hindi.test(v))).toEqual([]);
  });
});
