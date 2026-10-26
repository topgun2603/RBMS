import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  featureChecker,
  normalizeBase,
  visibleFor,
  type FeatureState,
  type MountedModule,
  type PlanInfo,
  type RouteDef,
  type Subscription,
  type SubscriptionCurrent,
} from "@srirealtime/web";
import { AUDIT_MODULES, describeAction, ENTITY_TYPES, KNOWN_ACTION_IDS, normalizeAction } from "./lib/audit-actions";
import { errorRowsCsv, toCsv } from "./lib/csv";
import { diffJson } from "./lib/diff";
import { workspaceMessages } from "./lib/messages";
import { BUILTIN_ROLE_NAMES, coveringPattern, permissionMatches, roleKeyFrom, ROLE_KEY_RE } from "./lib/permissions";
import { canCancel, hasMandate, periodEndOf, planMode } from "./lib/plan-actions";
import { resolveStepHref } from "./lib/step-href";
import { workspaceModule } from "./module";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });
}

const { en, ta } = workspaceMessages;

describe("workspaceModule", () => {
  it("puts everything under Settings, each page and widget with a feature (Plan & billing is the platform's)", () => {
    const m = workspaceModule();
    expect(m.id).toBe("workspace");
    expect(m.nav).toEqual([]);
    expect((m.settings ?? []).map((p) => p.path)).toEqual(["setup", "team", "audit", "import", "messages", "ai", "counter", "studio", "plan"]);
    // Customer messages spans features (its events are filtered by feature on the server); owners/admins only.
    for (const p of m.settings ?? []) if (p.path !== "plan" && p.path !== "messages") expect(p.feature, p.path).toBeTruthy();
    expect(m.settings?.find((p) => p.path === "messages")?.roles).toEqual(["owner", "admin"]);
    expect(workspaceModule({ planBilling: false }).settings?.map((p) => p.path)).not.toContain("plan");
    for (const w of m.widgets ?? []) expect(w.feature, w.id).toBeTruthy();
    for (const p of m.settings ?? []) expect(p.label in en, p.label).toBe(true);
  });

  it("owner-only pieces declare their roles", () => {
    const m = workspaceModule();
    expect(m.settings?.find((p) => p.path === "setup")?.roles).toEqual(["owner", "admin"]);
    expect(m.widgets?.[0]?.roles).toEqual(["owner", "admin"]);
    expect(m.widgets?.[0]?.zone).toBe("setup");
    expect(workspaceModule({ onboardingWidget: false }).widgets).toEqual([]);
  });

  it("hides pages whose feature is off (kumar without staff/audit)", () => {
    const state = (key: string, enabled: boolean): FeatureState => ({
      key,
      module: key,
      label: key,
      description: "",
      dependsOn: [],
      shopToggle: false,
      enabled,
      reason: enabled ? null : "plan",
      available: enabled,
      shopEnabled: null,
    });
    const { check } = featureChecker({
      appId: "BL",
      planId: "free",
      enabled: ["onboarding", "importexport"],
      features: [state("onboarding", true), state("importexport", true), state("staff", false), state("audit", false)],
    });
    const m = workspaceModule();
    expect((m.settings ?? []).filter((p) => check(p.feature).ok).map((p) => p.path)).toEqual(["setup", "import", "messages", "plan"]);
  });
});

describe("messages", () => {
  it("has the same keys in English and Tamil", () => {
    expect(Object.keys(ta).sort()).toEqual(Object.keys(en).sort());
  });

  it("defines every literal workspace.* key used in the source", () => {
    const used = new Set<string>();
    for (const file of sources(join(__dirname))) {
      for (const m of readFileSync(file, "utf8").matchAll(/["'`](workspace\.[a-zA-Z0-9_.-]+)["'`]/g)) used.add(m[1]!);
    }
    expect([...used].filter((k) => !(k in en) && !k.endsWith("."))).toEqual([]);
  });

  it("defines the dynamic keys (levels, statuses, actions, modules, built-in roles)", () => {
    const keys = [
      ...["owner", "admin", "staff", "member"].map((l) => `workspace.levels.${l}`),
      ...["preview", "queued", "running", "done", "failed"].map((s) => `workspace.import.status.${s}`),
      ...KNOWN_ACTION_IDS.map((id) => `workspace.audit.actions.${id}`),
      ...["create", "update", "delete", "other"].map((v) => `workspace.audit.generic.${v}`),
      ...[...AUDIT_MODULES, ...ENTITY_TYPES].map((m) => `workspace.audit.modules.${m}`),
      ...["today", "7d", "30d", "90d", "custom"].map((p) => `workspace.audit.presets.${p}`),
      ...["added", "removed", "changed"].map((d) => `workspace.audit.diff.${d}`),
      ...["done", "skipped", "todo"].map((s) => `workspace.onboarding.state.${s}`),
      ...Object.keys(BUILTIN_ROLE_NAMES).flatMap((k) => [`workspace.roles.builtin.${k}.name`, `workspace.roles.builtin.${k}.description`]),
      "workspace.audit.before",
      "workspace.audit.after",
    ];
    expect(keys.filter((k) => !(k in en))).toEqual([]);
  });

  it("uses Tamil script for Tamil strings (no Hindi terms)", () => {
    const latinOnly = Object.entries(ta).filter(([, v]) => !/[஀-௿]/.test(v) && !/^[A-Z0-9 ()%/.{}+·#↻✕-]+$/i.test(v));
    expect(latinOnly.map(([k]) => k).filter((k) => !/(\.csv|export\.excel|targetPlaceholder)$/.test(k))).toEqual([]);
    const all = Object.values(ta).join(" ");
    expect(all).not.toMatch(/[ऀ-ॿ]/); // no Devanagari
    expect(all.toLowerCase()).not.toMatch(/khata|udhaar|hisaab/);
  });
});

describe("permissions", () => {
  it("matches patterns like the server", () => {
    expect(permissionMatches("*", "invoices.create")).toBe(true);
    expect(permissionMatches("*.view", "audit.view")).toBe(true);
    expect(permissionMatches("*.view", "audit.manage")).toBe(false);
    expect(permissionMatches("orders.*", "orders.ship")).toBe(true);
    expect(permissionMatches("orders.*", "orders")).toBe(true);
    expect(permissionMatches("orders.*", "coupons.manage")).toBe(false);
    expect(coveringPattern(["catalogue.*", "catalogue.manage"], "catalogue.manage")).toBe("catalogue.*");
    expect(coveringPattern(["catalogue.manage"], "catalogue.manage")).toBeNull();
  });

  it("builds valid, unique role keys from any name", () => {
    expect(roleKeyFrom("Senior Cashier")).toBe("senior-cashier");
    expect(roleKeyFrom("Cashier", new Set(["cashier"]))).toBe("cashier-2");
    for (const n of ["காசாளர்", "1st shift", "", "A", "x".repeat(60)]) expect(roleKeyFrom(n)).toMatch(ROLE_KEY_RE);
  });
});

describe("audit actions", () => {
  it("normalises derived actions", () => {
    expect(normalizeAction("invoices.post /:id([0-9a-fA-F-]{36})/cancel")).toBe("invoices.post /:/cancel");
    expect(normalizeAction("staff.role.update")).toBe("staff.role.update");
  });

  it("maps known actions and falls back by verb", () => {
    expect(describeAction("invoices.post /:id([0-9a-fA-F-]{36})/cancel")).toMatchObject({ kind: "known", id: "invoiceCancel" });
    expect(describeAction("invoices.post /")).toMatchObject({ kind: "known", id: "invoiceCreate" });
    expect(describeAction("staff.role.delete")).toMatchObject({ kind: "known", id: "roleDelete", module: "staff" });
    expect(describeAction("cms.put /home")).toMatchObject({ kind: "generic", verb: "update", module: "cms" });
    expect(describeAction("delivery.post /zones/:id/disable")).toMatchObject({ kind: "generic", verb: "create", module: "delivery" });
    expect(describeAction("orders.post /:id/void")).toMatchObject({ kind: "generic", verb: "delete" });
    expect(describeAction("reviews.thing.created")).toMatchObject({ kind: "generic", verb: "create", module: "reviews" });
  });
});

describe("diff and csv", () => {
  it("diffs nested objects by path", () => {
    expect(diffJson({ roles: ["staff"], active: true, a: { b: 1 } }, { roles: ["staff", "role:cashier"], active: true, a: { b: 2, c: 3 } })).toEqual([
      { path: "a.b", kind: "changed", before: 1, after: 2 },
      { path: "a.c", kind: "added", after: 3 },
      { path: "roles", kind: "changed", before: ["staff"], after: ["staff", "role:cashier"] },
    ]);
    expect(diffJson(null, { x: 1 })).toEqual([{ path: "x", kind: "added", after: 1 }]);
    expect(diffJson({ x: 1 }, undefined)).toEqual([{ path: "x", kind: "removed", before: 1 }]);
  });

  it("writes error rows with the original cells and guards formulas", () => {
    const csv = errorRowsCsv(
      [
        { row: 3, message: "Price is required" },
        { row: 2, message: "Bad GST" },
        { row: 3, message: "Name too long" },
      ],
      new Map([[2, ["=SUM(A1)", "a,b"]]]),
      ["Name", "Price"],
      { row: "Row", error: "Problem" },
    );
    expect(csv.split("\r\n").slice(0, 3)).toEqual(["﻿Row,Problem,Name,Price", `2,Bad GST,'=SUM(A1),"a,b"`, "3,Price is required; Name too long,,"]);
    expect(toCsv(["a"], [['he said "hi"']])).toContain('"he said ""hi"""');
  });
});

describe("onboarding step links", () => {
  const route = (path: string): RouteDef => ({ path, component: () => null });
  const mod = (basePath: string, routes: string[], settings: string[] = []): MountedModule => ({
    id: basePath,
    basePath: normalizeBase(basePath),
    messages: { en: {}, ta: {} },
    nav: [],
    routes: routes.map(route),
    settings: settings.map((path) => ({ path, label: "x", component: () => null })),
  });
  const billingApp = { modules: [mod("/", ["", "invoices", "invoices/new", "items"], ["", "payments"])] };
  const shopApp = {
    modules: [mod("/", ["products", "products/new"]), mod("/billing", ["", "invoices/new", "items"], ["", "payments"])],
  };

  it("resolves hints against what each app mounts", () => {
    expect(resolveStepHref(billingApp, "invoices/new")).toBe("/invoices/new");
    expect(resolveStepHref(shopApp, "invoices/new")).toBe("/billing/invoices/new");
    expect(resolveStepHref(shopApp, "catalogue/products/new")).toBe("/products/new");
    expect(resolveStepHref(billingApp, "catalogue/products/new")).toBe("/items");
    expect(resolveStepHref(billingApp, "settings/payments")).toBe("/settings/payments");
    expect(resolveStepHref(billingApp, "settings/business")).toBe("/settings");
    expect(resolveStepHref(billingApp, "store/home")).toBe("/store/home");
    expect(resolveStepHref(null, "/x/y/")).toBe("/x/y");
  });
});

describe("permission gating (Gated.permission)", () => {
  const visible = (perms: string[]) =>
    visibleFor({ roles: ["staff"], access: { fullAccess: false, permissions: perms }, checkFeature: featureChecker(undefined).check });
  const settings = workspaceModule().settings!;
  const by = (path: string) => settings.find((s) => s.path === path)!;

  it("declares the API's permission keys on each settings page", () => {
    expect(by("team")).toMatchObject({ permission: "staff.manage" });
    expect(by("audit")).toMatchObject({ permission: "audit.view", permissionExplicit: true });
    expect(by("import")).toMatchObject({ permission: "importexport.run" });
    expect(by("plan")).toMatchObject({ permission: "subscriptions.manage" });
  });

  it("shows Plan & billing to owners/admins and an explicit grant, not to staff defaults", () => {
    expect(visible(["*.view"])(by("plan"))).toBe(false);
    expect(visible(["subscriptions.manage"])(by("plan"))).toBe(true);
    const owner = visibleFor({ roles: ["owner"], access: { fullAccess: true, permissions: ["*"] }, checkFeature: featureChecker(undefined).check });
    expect(owner(by("plan"))).toBe(true);
  });

  it("hides the audit log from the staff default `*.view` but shows it to an explicit grant", () => {
    expect(visible(["*.view"])(by("audit"))).toBe(false);
    expect(visible(["audit.view"])(by("audit"))).toBe(true);
    expect(visible(["audit.*"])(by("audit"))).toBe(true);
    expect(visible(["staff.manage"])(by("team"))).toBe(true);
    expect(visible(["reports.view"])(by("team"))).toBe(false);
  });
});

describe("plan actions", () => {
  const plan = (id: string, monthly: number, sort: number): PlanInfo => ({
    id,
    name: id,
    description: null,
    priceMonthlyPaise: monthly,
    priceYearlyPaise: monthly * 10,
    modules: [],
    limits: {},
    features: {},
    sort,
  });
  const plans = [plan("free", 0, 0), plan("starter", 49_900, 1), plan("pro", 149_900, 2)];
  const [free, starter, pro] = plans as [PlanInfo, PlanInfo, PlanInfo];
  const sub = (s: Partial<Subscription>): Subscription => ({
    id: "s",
    tenantId: "t",
    planId: "starter",
    interval: "monthly",
    status: "active",
    trialEndsAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: "2026-11-16T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    graceEndsAt: null,
    provider: "mock",
    authUrl: null,
    pendingPlanId: null,
    pendingInterval: null,
    ...s,
  });
  const cur = (s: Partial<Subscription> | null, p: PlanInfo | null = starter): SubscriptionCurrent => ({
    subscription: s ? sub(s) : null,
    plan: p,
    trialDaysLeft: null,
    usage: [],
    canTrial: false,
  });

  it("switches the trial plan without payment", () => {
    const c = cur({ status: "trialing", trialEndsAt: "2026-10-30T00:00:00.000Z" });
    expect(planMode(c, plans, pro, "monthly")).toBe("trial");
    expect(planMode(c, plans, starter, "yearly")).toBe("trial");
    expect(planMode(c, plans, starter, "monthly")).toBe("current");
    expect(planMode(c, plans, free, "monthly")).toBe("downgrade");
    expect(periodEndOf(c.subscription)).toBe("2026-10-30T00:00:00.000Z");
  });

  it("upgrades now and downgrades at period end while active", () => {
    const c = cur({ status: "active" });
    expect(planMode(c, plans, pro, "monthly")).toBe("upgrade");
    expect(planMode(c, plans, free, "monthly")).toBe("downgrade");
    expect(planMode(c, plans, starter, "monthly")).toBe("current");
    expect(planMode(cur({ status: "past_due" }), plans, pro, "monthly")).toBe("upgrade");
  });

  it("starts a checkout from free, expired or cancelled", () => {
    expect(planMode(cur(null, free), plans, pro, "yearly")).toBe("start");
    expect(planMode(cur(null, free), plans, free, "monthly")).toBe("current");
    expect(planMode(cur({ status: "expired" }, free), plans, starter, "monthly")).toBe("start");
    expect(planMode(cur({ status: "active", planId: "free", provider: null }, free), plans, starter, "monthly")).toBe("start");
    // Complimentary Pro: a paid plan goes through trial/checkout, Free applies now (no period end).
    const comped = cur({ status: "active", planId: "pro", provider: "manual", currentPeriodEnd: null }, pro);
    expect(planMode(comped, plans, starter, "monthly")).toBe("start");
    expect(planMode(comped, plans, free, "monthly")).toBe("downgrade");
    expect(periodEndOf(comped.subscription)).toBeNull();
  });

  it("knows what can be cancelled and when a trial mandate exists", () => {
    expect(canCancel(cur({ status: "active" }))).toBe(true);
    expect(canCancel(cur({ status: "active", cancelAtPeriodEnd: true }))).toBe(false);
    expect(canCancel(cur({ status: "active", provider: "manual" }))).toBe(false);
    expect(canCancel(cur({ status: "active", planId: "free" }, free))).toBe(false);
    expect(canCancel(cur({ status: "expired" }))).toBe(false);
    expect(hasMandate(sub({ providerSubscriptionId: "sub_1" }))).toBe(true);
    expect(hasMandate(sub({ providerSubscriptionId: "sub_1", authUrl: "https://x" }))).toBe(false);
  });
});

describe("POS PINs in Team & roles", () => {
  it("validates PINs like the server (4–6 digits, not weak)", async () => {
    const { pinProblem, POS_DEVICES_PERMISSION, POS_TERMINALS_FEATURE } = await import("./lib/pins");
    expect(pinProblem("123")).toBe("format");
    expect(pinProblem("1234")).toBe("weak");
    expect(pinProblem("0000")).toBe("weak");
    expect(pinProblem("987654")).toBe("weak");
    expect(pinProblem("2580", "2581")).toBe("mismatch");
    expect(pinProblem("2580", "2580")).toBeNull();
    expect(POS_DEVICES_PERMISSION).toBe("pos.devices");
    expect(POS_TERMINALS_FEATURE).toBe("pos.terminals");
  });
});
