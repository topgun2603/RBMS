import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildNavModel, featureChecker, normalizeBase, type FeatureState, type MountedModule } from "@srirealtime/web";
import { billingMessages, billingModule } from "./index";
import { permissionMatches } from "./lib/access";
import { RECURRING_FREQUENCIES, RECURRING_RUN_STATUSES, RECURRING_STATUSES, scheduleText } from "./lib/types-recurring";

const KEYS = ["invoices", "invoices.quotations", "invoices.sales-docs", "invoices.recurring"];

function featuresOf(off: string[] = []) {
  return {
    appId: "BL",
    planId: "pro",
    enabled: KEYS.filter((k) => !off.includes(k)),
    features: KEYS.map<FeatureState>((key) => ({
      key,
      module: key.split(".")[0]!,
      label: key,
      description: "",
      dependsOn: [],
      shopToggle: true,
      enabled: !off.includes(key),
      reason: off.includes(key) ? "app" : null,
      available: !off.includes(key),
      shopEnabled: null,
    })),
  };
}

const visible = (off: string[]) => {
  const { check } = featureChecker(featuresOf(off));
  return (g: { feature?: string | readonly string[] }, m?: { features?: readonly string[] }) => check(g.feature, m?.features).ok;
};

describe("recurring bills in the billing module", () => {
  it("adds Recurring to the sell section right after the delivery challans, behind the feature and recurring.view", () => {
    const m = billingModule({ basePath: "/" });
    const mounted: MountedModule = { ...m, basePath: normalizeBase(m.basePath) };
    const sell = m.nav.find((s) => s.id === "sell")!;
    const hrefs = sell.items.map((i) => i.href);
    expect(hrefs[hrefs.indexOf("challans") + 1]).toBe("recurring");
    expect(sell.items.find((i) => i.href === "recurring")).toMatchObject({ feature: "invoices.recurring", permission: "recurring.view", label: "billing.nav.recurring" });
    const navHrefs = (off: string[]) => buildNavModel({ modules: [mounted] }, visible(off), []).sections.flatMap((s) => s.items.map((i) => i.href));
    expect(navHrefs([])).toContain("/recurring");
    expect(navHrefs(["invoices.recurring"])).not.toContain("/recurring");
  });

  it("goes after bills when the sales documents are not there (single section layout too)", () => {
    const m = billingModule({ nav: "single" });
    const items = m.nav.flatMap((s) => s.items.map((i) => i.href));
    expect(items.filter((h) => h === "recurring")).toHaveLength(1);
  });

  it("routes list, new, detail and edit with the right permission; static segments before :id", () => {
    const m = billingModule();
    const route = (p: string) => m.routes.find((r) => r.path === p)!;
    expect(route("recurring")).toMatchObject({ feature: "invoices.recurring", permission: "recurring.view" });
    expect(route("recurring/new")).toMatchObject({ feature: "invoices.recurring", permission: "recurring.manage", immersive: true });
    expect(route("recurring/:id")).toMatchObject({ permission: "recurring.view" });
    expect(route("recurring/:id/edit")).toMatchObject({ permission: "recurring.manage" });
    const paths = m.routes.map((r) => r.path);
    expect(paths.indexOf("recurring/new")).toBeLessThan(paths.indexOf("recurring/:id"));
    expect(m.actions?.find((a) => a.id === "new-recurring")).toMatchObject({ href: "recurring/new", permission: "recurring.manage" });
    // Earlier screens are still there.
    expect(route("challans/:id")).toBeDefined();
  });

  it("matches the permissions like the server", () => {
    expect(permissionMatches("*.view", "recurring.view")).toBe(true);
    expect(permissionMatches("*.view", "recurring.manage")).toBe(false);
    expect(permissionMatches("recurring.*", "recurring.manage")).toBe(true);
  });

  it("knows the server's statuses and describes schedules", () => {
    expect([...RECURRING_STATUSES]).toEqual(["active", "paused", "ended"]);
    expect([...RECURRING_RUN_STATUSES]).toEqual(["pending", "created", "skipped", "locked", "failed"]);
    expect(scheduleText({ frequency: "monthly", interval: 1, dayOfMonth: 31, weekday: null, startDate: "2026-01-31" })).toEqual({ key: "billing.recurring.every.monthlyOne", values: { n: 1, day: 31 } });
    // 14 Oct 2026 is a Wednesday.
    expect(scheduleText({ frequency: "weekly", interval: 2, dayOfMonth: null, weekday: null, startDate: "2026-10-14" })).toEqual({
      key: "billing.recurring.every.weeklyMany",
      values: { n: 2, weekday: "billing.recurring.weekday.3" },
    });
  });
});

describe("recurring bill messages", () => {
  const { en, ta } = billingMessages;
  const own = (m: Record<string, string>) => Object.keys(m).filter((k) => k.startsWith("billing.recurring.") || /^billing\.nav\.(recurring|newRecurring)$/.test(k));

  it("has the same keys in English and Tamil, with the same placeholders", () => {
    expect(own(ta).sort()).toEqual(own(en).sort());
    expect(own(en).length).toBeGreaterThan(100);
    const ph = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]!).sort();
    expect(own(en).filter((k) => JSON.stringify(ph(en[k]!)) !== JSON.stringify(ph(ta[k]!)))).toEqual([]);
    expect(ta["billing.nav.recurring"]).toMatch(/[஀-௿]/);
  });

  it("defines every key the screens use, literal and built from a status / frequency / weekday", () => {
    const files = ["recurring.tsx", "components/recurring/rc-ui.tsx", "components/recurring/rc-form.tsx", "pages/recurring.tsx", "pages/recurring-new.tsx", "pages/recurring-edit.tsx", "pages/recurring-detail.tsx"];
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(join(__dirname, f), "utf8").matchAll(/["'`](billing\.(?:recurring\.|nav\.(?:recurring|newRecurring))[a-zA-Z0-9_.]*)["'`]/g)) used.add(m[1]!);
    const dynamic = [
      ...RECURRING_STATUSES.map((s) => `billing.recurring.status.${s}`),
      ...RECURRING_RUN_STATUSES.map((s) => `billing.recurring.run.${s}`),
      ...RECURRING_FREQUENCIES.flatMap((f) => [`billing.recurring.frequency.${f}`, `billing.recurring.form.intervalUnit.${f}`, `billing.recurring.every.${f}One`, `billing.recurring.every.${f}Many`]),
      ...[0, 1, 2, 3, 4, 5, 6].map((d) => `billing.recurring.weekday.${d}`),
      ...["auto", "manual", "user"].map((x) => `billing.recurring.trigger.${x}`),
      ...["pause", "resume", "skip", "end"].map((x) => `billing.recurring.done.${x}`),
    ];
    const all = [...used, ...dynamic].filter((k) => !k.endsWith("."));
    expect(all.filter((k) => !(k in en))).toEqual([]);
    expect(all.filter((k) => !(k in ta))).toEqual([]);
  });

  it("says RBMS, never the internal names", () => {
    for (const m of [en, ta]) for (const k of own(m)) expect(m[k], k).not.toMatch(/srikit|srirealtime/i);
  });
});
