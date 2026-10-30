import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { featureChecker, visibleFor, type FeatureState, type MountedModule } from "@rbms/web";
import { barPercent, checkBranchGst, presetRange, sampleBillNumber, sanitizePrefix, suggestPrefix } from "./lib/branches";
import { displayPhone, money, rupeesToPaise, searchTerm } from "./lib/format";
import { isValidPan, isValidShopGstin, latestChecks, maskedRows, panFromGstin, scoreBand } from "./lib/kyc";
import { earnExample, earnPoints, maxRedeemOn, rewardPercent, signedPoints, tierFor, validateSettings } from "./lib/loyalty";
import { growthMessageAreas, growthMessages } from "./lib/messages";
import type { KycCheck, LoyaltySettings } from "./lib/types";
import { GROWTH_FEATURES, GROWTH_PERMISSIONS, growthModule } from "./module";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });
}

const state = (key: string, enabled: boolean, reason: FeatureState["reason"] = "plan"): FeatureState => ({
  key,
  module: key.split(".")[0]!,
  label: key,
  description: "",
  dependsOn: [],
  shopToggle: false,
  enabled,
  reason: enabled ? null : reason,
  available: enabled,
  shopEnabled: null,
});

const ALL = Object.values(GROWTH_FEATURES);
const checker = (on: string[]) =>
  featureChecker({ appId: "BL", planId: "pro", enabled: on, features: ALL.map((k) => state(k, on.includes(k))) }).check;
const mounted = (m = growthModule()): MountedModule => ({ ...m, basePath: m.basePath ?? "/grow" }) as MountedModule;

describe("growthModule", () => {
  it("mounts at /grow by default with a Grow section (Loyalty, Reports) and four settings pages", () => {
    const m = growthModule();
    expect(m.id).toBe("growth");
    expect(m.basePath).toBe("/grow");
    expect(m.nav.map((s) => s.id)).toEqual(["grow"]);
    expect(m.nav[0]!.items.map((i) => i.href)).toEqual(["loyalty", "reports"]);
    expect((m.settings ?? []).map((p) => p.path).sort()).toEqual(["branches", "developer", "einvoice", "kyc"]);
    expect(growthModule({ basePath: "/x" }).basePath).toBe("/x");
  });

  it("declares a feature and a permission on every nav item, route, widget and settings page", () => {
    const m = growthModule();
    const gated = [...m.nav.flatMap((s) => s.items), ...m.routes, ...(m.widgets ?? []), ...(m.settings ?? [])];
    for (const g of gated) {
      expect(g.feature, JSON.stringify(g)).toBeTruthy();
      expect(g.permission, JSON.stringify(g)).toBeTruthy();
    }
  });

  it("uses the server's feature and permission keys", () => {
    const m = growthModule();
    const byPath = Object.fromEntries((m.settings ?? []).map((p) => [p.path, p]));
    expect(byPath.kyc!.feature).toBe("kyc");
    expect(byPath.einvoice!.feature).toBe("gst-einvoice");
    expect(byPath.einvoice!.permission).toBe("einvoice.manage");
    expect(byPath.branches!.feature).toBe("multi-branch");
    expect(byPath.branches!.permission).toBe("branches.manage");
    expect(byPath.developer!.feature).toBe("developer");
    expect(byPath.developer!.permission).toBe("developer.manage");
    const route = (p: string) => m.routes.find((r) => r.path === p)!;
    expect(route("loyalty").permission).toBe("loyalty.manage");
    expect(route("reports").feature).toBe("reports.advanced");
    expect(route("reports").permission).toBe(GROWTH_PERMISSIONS.reportsView);
    expect(m.widgets?.find((w) => w.id === "report-schedules")?.permission).toBe(GROWTH_PERMISSIONS.reportsManage);
  });

  it("puts static routes before :id and never uses absolute paths", () => {
    const paths = growthModule().routes.map((r) => r.path);
    expect(paths.indexOf("reports/new")).toBeLessThan(paths.indexOf("reports/:id"));
    for (const p of [...paths, ...growthModule().nav.flatMap((s) => s.items.map((i) => i.href))]) expect(p.startsWith("/"), p).toBe(false);
  });

  it("hides what the shop doesn't have (only loyalty on)", () => {
    const m = mounted();
    const visible = visibleFor({ roles: ["owner"], access: { fullAccess: true, permissions: ["*"] }, checkFeature: checker(["loyalty"]) });
    expect(m.nav[0]!.items.filter((i) => visible(i, m)).map((i) => i.href)).toEqual(["loyalty"]);
    expect((m.settings ?? []).filter((p) => visible(p, m))).toEqual([]);
    expect((m.widgets ?? []).filter((w) => visible(w, m)).map((w) => w.id)).toEqual(["loyalty-summary"]);
  });

  it("hides pages from staff without the permission", () => {
    const m = mounted();
    const visible = visibleFor({ roles: ["staff"], access: { fullAccess: false, permissions: ["reports.view"] }, checkFeature: checker(ALL) });
    expect(m.nav[0]!.items.filter((i) => visible(i, m)).map((i) => i.href)).toEqual(["reports"]);
    expect((m.settings ?? []).filter((p) => visible(p, m))).toEqual([]);
    expect((m.widgets ?? []).filter((w) => visible(w, m))).toEqual([]);
  });

  it("can drop the widgets", () => {
    expect(growthModule({ widgets: false }).widgets).toEqual([]);
  });
});

describe("messages", () => {
  const { en, ta } = growthMessages;

  it("has the same keys in English and Tamil, area by area", () => {
    for (const [name, area] of Object.entries(growthMessageAreas)) {
      expect(Object.keys(area.ta).sort(), name).toEqual(Object.keys(area.en).sort());
    }
    expect(Object.keys(ta).sort()).toEqual(Object.keys(en).sort());
  });

  it("only uses growth.* keys", () => {
    expect(Object.keys(en).filter((k) => !k.startsWith("growth."))).toEqual([]);
  });

  it("keeps the same {placeholders} in Tamil", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
    const bad = Object.keys(en).filter((k) => JSON.stringify(vars(en[k]!)) !== JSON.stringify(vars(ta[k]!)));
    expect(bad).toEqual([]);
  });

  it("writes Tamil in Tamil script (codes like GSTIN, PAN, CSV may stay Latin)", () => {
    const latin = Object.keys(ta).filter((k) => !/[஀-௿]/.test(ta[k]!) && !/^[A-Z0-9 ()%/.,{}+·#&_:×–—-]+$/i.test(ta[k]!) && ta[k] !== en[k]);
    expect(latin).toEqual([]);
  });

  it("uses no Hindi trade words", () => {
    const banned = /\b(khata|khaata|bahi|udhaar|udhar|hisaab|hisab|dukaan|grahak)\b|காதா|உதார்|ஹிசாப்|துக்கான்/i;
    expect(Object.entries(ta).filter(([, v]) => banned.test(v)).map(([k]) => k)).toEqual([]);
    expect(Object.entries(en).filter(([, v]) => banned.test(v)).map(([k]) => k)).toEqual([]);
  });

  it("defines every literal growth.* key used in the sources", () => {
    const used = new Set<string>();
    for (const f of sources(__dirname)) {
      if (f.includes(`${join("lib", "messages")}`)) continue;
      for (const m of readFileSync(f, "utf8").matchAll(/["'`](growth\.[a-zA-Z0-9_.]+)["'`]/g)) used.add(m[1]!);
    }
    const missing = [...used].filter((k) => !k.endsWith(".") && k.split(".").length > 2 && !(k in en));
    expect(missing).toEqual([]);
  });
});

describe("loyalty rules", () => {
  const s: LoyaltySettings = {
    earnPer100: 1,
    pointValuePaise: 100,
    minRedeemPoints: 100,
    maxRedeemPercent: 50,
    expiryMonths: 12,
    tiers: [
      { name: "Silver", minSpend: 0, multiplier: 1 },
      { name: "Gold", minSpend: 2_500_000, multiplier: 1.5 },
    ],
  };

  it("matches the settings example: a ₹2,000 bill earns 20 points worth ₹20", () => {
    expect(earnExample(s, 200_000)).toEqual({ points: 20, value: 2000 });
    expect(earnExample(s, 200_000, 1.5)).toEqual({ points: 30, value: 3000 });
    expect(earnPoints(9_999, 1)).toBe(0);
    expect(earnPoints(115_000, 1)).toBe(11);
    expect(earnPoints(-100, 1)).toBe(0);
    expect(rewardPercent(s)).toBe(1);
  });

  it("caps redemption at the percent of the bill in whole points", () => {
    expect(maxRedeemOn(s, 200_000)).toBe(100_000);
    expect(maxRedeemOn({ maxRedeemPercent: 33, pointValuePaise: 100 }, 100_050)).toBe(33_000);
  });

  it("finds the tier for a lifetime spend", () => {
    expect(tierFor(0, s.tiers)?.name).toBe("Silver");
    expect(tierFor(2_500_000, s.tiers)?.name).toBe("Gold");
    expect(tierFor(10, [{ name: "B", minSpend: 5, multiplier: 1 }, { name: "A", minSpend: 0, multiplier: 1 }])?.name).toBe("B");
  });

  it("validates like the server", () => {
    expect(validateSettings(s)).toEqual([]);
    const fields = (x: LoyaltySettings) => validateSettings(x).map((i) => `${i.field}:${i.code}`);
    expect(fields({ ...s, earnPer100: 101 })).toContain("earnPer100:range");
    expect(fields({ ...s, pointValuePaise: 0 })).toContain("pointValuePaise:range");
    expect(fields({ ...s, expiryMonths: 1.5 })).toContain("expiryMonths:range");
    expect(fields({ ...s, tiers: [] })).toContain("tiers:none");
    expect(fields({ ...s, tiers: [{ name: "Gold", minSpend: 100, multiplier: 1 }] })).toContain("tiers:entry");
    expect(fields({ ...s, tiers: [s.tiers[0]!, { ...s.tiers[1]!, name: "silver" }] })).toContain("tiers:names");
    expect(fields({ ...s, tiers: [s.tiers[0]!, { ...s.tiers[1]!, minSpend: 0 }] })).toContain("tiers:spends");
    expect(fields({ ...s, tiers: [{ name: " ", minSpend: 0, multiplier: 11 }] })).toEqual(expect.arrayContaining(["tiers.0.name:required", "tiers.0.multiplier:range"]));
  });

  it("formats signed points", () => {
    expect(signedPoints(1200)).toBe("+1,200");
    expect(signedPoints(-40)).toBe("−40");
    expect(signedPoints(0)).toBe("0");
  });
});

describe("format helpers", () => {
  it("parses rupees into paise and shows phones", () => {
    expect(rupeesToPaise("2,000")).toBe(200_000);
    expect(rupeesToPaise("12.5")).toBe(1250);
    expect(rupeesToPaise("1.234")).toBeNull();
    expect(rupeesToPaise("")).toBeNull();
    expect(displayPhone("+919876543210")).toBe("98765 43210");
    expect(searchTerm("98765 43210")).toBe("9876543210");
    expect(searchTerm(" Meena ")).toBe("Meena");
    expect(money(200_000)).toContain("2,000");
  });
});

describe("kyc helpers", () => {
  it("checks PAN and GSTIN formats locally", () => {
    expect(isValidPan("abcde1234f")).toBe(true);
    expect(isValidPan("ABCDE12345")).toBe(false);
    expect(isValidShopGstin("33AABFR1234K1ZI")).toBe(true);
    expect(isValidShopGstin("33AABFR1234K1ZJ")).toBe(false);
    expect(panFromGstin("33AABFR1234K1ZI")).toBe("AABFR1234K");
  });

  it("bands the name match score at the server's 80 pass mark", () => {
    expect(scoreBand(80)).toBe("good");
    expect(scoreBand(79)).toBe("fair");
    expect(scoreBand(10)).toBe("poor");
    expect(scoreBand(null)).toBeNull();
  });

  it("keeps the newest check per type and orders masked rows", () => {
    const c = (id: string, type: KycCheck["type"], createdAt: string) => ({ id, type, createdAt }) as KycCheck;
    expect(latestChecks([c("a", "pan", "2026-01-01"), c("b", "pan", "2026-02-01"), c("c", "gstin", "2026-01-15")]).map((x) => x.id)).toEqual(["b", "c"]);
    expect(maskedRows({ name: "A", pan: "ABCDE****F", empty: "" }).map((r) => r.key)).toEqual(["pan", "name"]);
  });
});

describe("branch helpers", () => {
  it("checks the GSTIN against the state", () => {
    expect(checkBranchGst("", "")).toEqual({ ok: true, stateCode: null });
    expect(checkBranchGst("33AABFR1234K1ZI", "")).toEqual({ ok: true, stateCode: "33" });
    expect(checkBranchGst("33AABFR1234K1ZI", "29")).toMatchObject({ ok: false, field: "stateCode", code: "state_mismatch" });
    expect(checkBranchGst("33AABFR1234K1ZJ", "33")).toMatchObject({ ok: false, field: "gstin" });
  });

  it("suggests free bill prefixes and shows a sample number", () => {
    expect(sanitizePrefix("mdu north")).toBe("MDUNOR");
    expect(suggestPrefix("MDU-NORTH", [])).toBe("MDU-NO");
    expect(suggestPrefix("MDU-NORTH", ["mdu-no"])).toBe("MDU-N2");
    expect(sampleBillNumber("MDU", "2026-10-16")).toBe("MDU/26-27/0001");
    expect(sampleBillNumber("", "2027-03-31")).toBe("INV/26-27/0001");
  });

  it("works out summary ranges in IST dates and bar widths", () => {
    expect(presetRange("this_month", "2026-10-16")).toEqual({ from: "2026-10-01", to: "2026-10-16" });
    expect(presetRange("last_month", "2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("last_30", "2026-10-16")).toEqual({ from: "2026-09-17", to: "2026-10-16" });
    expect(presetRange("this_fy", "2026-02-01")).toEqual({ from: "2025-04-01", to: "2026-02-01" });
    expect(barPercent(50, 100)).toBe(50);
    expect(barPercent(1, 1000)).toBe(2);
    expect(barPercent(0, 100)).toBe(0);
    expect(barPercent(5, 0)).toBe(0);
  });
});
