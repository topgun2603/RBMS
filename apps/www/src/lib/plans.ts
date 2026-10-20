/**
 * Plan maths and the comparison table, built from `GET /v1/plans?app=XX` (shape: packages/plans). Pure: used by the
 * server pricing page and the client sign-up wizard. Plans are per app (`bl-starter`, `rs-pro`, …); the UI keys on the
 * `tier`, which is the same across apps.
 *
 * `modules` hold feature keys and module wildcards (docs/features.md): `inventory` is a module's base feature,
 * `inventory.*` the whole module.
 */
import { formatCurrencyINR, type Locale, type Translator } from "@srirealtime/i18n/client";
import { appParam, type AppId } from "./site";

export type PlanTier = "free" | "starter" | "pro" | "enterprise";
export const PLAN_TIERS: readonly PlanTier[] = ["free", "starter", "pro", "enterprise"];

export interface Plan {
  id: string;
  appId: string;
  tier: PlanTier;
  name: string;
  description: string | null;
  priceMonthlyPaise: number;
  priceYearlyPaise: number;
  modules: string[];
  limits: Record<string, number>;
  features: Record<string, boolean>;
  isPublic?: boolean;
  sort?: number;
}

export type Interval = "monthly" | "yearly";
export const parseInterval = (v: string | null | undefined): Interval => (v === "yearly" ? "yearly" : "monthly");

export const isFreePlan = (p: Plan) => p.priceMonthlyPaise <= 0 && p.priceYearlyPaise <= 0;

/** The tier the pricing page highlights (and the sign-up wizard pre-selects). */
export const POPULAR_TIER: PlanTier = "starter";

const isTier = (v: string | null | undefined): v is PlanTier => PLAN_TIERS.includes(v as PlanTier);

/** A plan's tier; older payloads without `tier` fall back to the id's suffix (`bl-starter` → starter). */
export const planTier = (p: { id: string; tier?: string | null }): PlanTier | null => (isTier(p.tier) ? p.tier : (PLAN_TIERS.find((tier) => p.id === tier || p.id.endsWith(`-${tier}`)) ?? null));

/**
 * The tier a `?plan=` asks for: a tier ("starter"), any app's plan id ("bl-pro", looked up in `all` or by suffix).
 * Lets a link from one app's pricing land on the same tier of the app chosen in the wizard.
 */
export function tierFromParam(v: string | null | undefined, all: readonly Plan[] = []): PlanTier | null {
  const s = (v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (isTier(s)) return s;
  const hit = all.find((p) => p.id === s);
  return hit ? planTier(hit) : planTier({ id: s });
}

/** One app's plan of a tier, else its popular tier, else the first. */
export const planForTier = (plans: readonly Plan[], tier: PlanTier | null) =>
  plans.find((p) => planTier(p) === tier) ?? plans.find((p) => planTier(p) === POPULAR_TIER) ?? plans[0] ?? null;

/** Does a plan's module list grant this feature key? (`a.b` is granted by `a.b` or `a.*`; `a` by `a` or `a.*`.) */
export function planHas(modules: readonly string[], key: string): boolean {
  if (modules.includes(key)) return true;
  const base = key.split(".")[0]!;
  return modules.includes(`${base}.*`);
}

/** The wizard link for a plan card: `/signup?plan=bl-starter&interval=monthly&app=billing`. */
export function signupHref(planId: string, interval: Interval, app: AppId | null) {
  const q = new URLSearchParams({ plan: planId, interval });
  if (app) q.set("app", appParam(app));
  return `/signup?${q.toString()}`;
}

/** Price for one period in paise. */
export const pricePaise = (p: Plan, interval: Interval) => (interval === "yearly" ? p.priceYearlyPaise : p.priceMonthlyPaise);

/** Whole-percent saving of paying yearly vs 12 × monthly (0 when there isn't one). */
export function yearlySavingPct(p: Plan): number {
  const full = p.priceMonthlyPaise * 12;
  if (full <= 0 || p.priceYearlyPaise <= 0 || p.priceYearlyPaise >= full) return 0;
  return Math.round((1 - p.priceYearlyPaise / full) * 100);
}

export const yearlySavingPaise = (p: Plan) => Math.max(0, p.priceMonthlyPaise * 12 - p.priceYearlyPaise);

export const maxSavingPct = (plans: readonly Plan[]) => plans.reduce((m, p) => Math.max(m, yearlySavingPct(p)), 0);

/** ₹ without paise when whole: 49900 → "₹499". */
export function rupees(locale: Locale | string, paise: number): string {
  const whole = paise % 100 === 0;
  return formatCurrencyINR(locale, paise / 100, { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}

/** Tier names are translated (`plan.<tier>.name`); the API's name when a tier has no key. */
export function planName(t: Translator, p: Plan): string {
  const key = `plan.${planTier(p)}.name`;
  return t.has(key) ? t(key) : p.name;
}

/**
 * The API's description is written per app ("KOTs for one counter"), so English uses it; other locales prefer the
 * translated, app-neutral `plan.<tier>.description` and fall back to the API text.
 */
export function planDescription(t: Translator, p: Plan, locale: Locale | string = "en"): string {
  const key = `plan.${planTier(p)}.description`;
  const own = t.has(key) ? t(key) : "";
  return locale === "en" ? p.description || own : own || (p.description ?? "");
}

/** Public, priced or free, sorted. Enterprise-style "custom" plans (private, ₹0 but not free) are left out by the API. */
export const visiblePlans = (plans: readonly Plan[]) => [...plans].filter((p) => p.isPublic !== false).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

// ------------------------------------------------------------------ comparison table

export type CellValue = { kind: "bool"; on: boolean } | { kind: "text"; text: string };
export interface CompareRow {
  key: string;
  label: string;
  values: CellValue[];
}
export interface CompareGroup {
  key: string;
  label: string;
  rows: CompareRow[];
}

/** Rows shown per group, by feature key. Keys no plan grants are dropped, so the table follows the catalogue. */
const MODULE_GROUPS: { key: string; rows: string[] }[] = [
  { key: "billing", rows: ["invoices", "invoices.whatsapp", "invoices.reports", "invoices.credit-book", "invoices.gst-reports", "inventory", "payments", "expenses", "gst-einvoice", "gst-ewaybill", "multi-branch"] },
  { key: "store", rows: ["storefront", "catalogue.variants", "delivery", "coupons", "reviews", "cms.blog", "custom-domain", "marketplace"] },
  { key: "growth", rows: ["loyalty", "chat", "support", "whatsapp", "analytics", "reports.advanced"] },
  { key: "team", rows: ["staff", "importexport", "audit", "developer"] },
];
const LIMIT_ROWS = ["invoices_per_month", "staff", "storage_mb", "sms_per_month", "whatsapp_per_month"];
const FEATURE_ROWS = ["remove_branding", "priority_support"];

function limitText(t: Translator, locale: Locale | string, key: string, v: number | undefined): CellValue {
  if (v === undefined) return { kind: "bool", on: false };
  if (v < 0) return { kind: "text", text: t("pricing.unlimited") };
  if (v === 0) return { kind: "bool", on: false };
  if (key === "storage_mb") return { kind: "text", text: v >= 1000 ? t("cmp.storage.gb", { n: new Intl.NumberFormat("en-IN").format(v / 1000) }) : t("cmp.storage.mb", { n: v }) };
  return { kind: "text", text: new Intl.NumberFormat(locale === "ta" ? "ta-IN" : "en-IN").format(v) };
}

export function compareTable(plans: readonly Plan[], t: Translator, locale: Locale | string): CompareGroup[] {
  const groups: CompareGroup[] = [];
  for (const g of MODULE_GROUPS) {
    const rows = g.rows
      .map((key) => ({ key, label: t(`cmp.${key}`), values: plans.map((p) => ({ kind: "bool", on: planHas(p.modules, key) }) as CellValue) }))
      .filter((r) => r.values.some((v) => v.kind === "bool" && v.on));
    if (rows.length) groups.push({ key: g.key, label: t(`cmp.group.${g.key}`), rows });
  }
  const limits = LIMIT_ROWS.filter((k) => plans.some((p) => k in p.limits)).map((key) => ({
    key,
    label: t(`cmp.limit.${key}`),
    values: plans.map((p) => limitText(t, locale, key, p.limits[key])),
  }));
  if (limits.length) groups.push({ key: "limits", label: t("cmp.group.limits"), rows: limits });
  const extras = FEATURE_ROWS.filter((k) => plans.some((p) => k in p.features)).map((key) => ({
    key,
    label: t(`cmp.feature.${key}`),
    values: plans.map((p) => ({ kind: "bool", on: !!p.features[key] }) as CellValue),
  }));
  if (extras.length) groups.push({ key: "extras", label: t("cmp.group.extras"), rows: extras });
  return groups;
}

/** A few headline lines for a plan card (what this plan adds), from the same rows. */
export function planHighlights(plan: Plan, all: readonly Plan[], t: Translator, locale: Locale | string, max = 6): string[] {
  const sorted = visiblePlans(all);
  const idx = sorted.findIndex((p) => p.id === plan.id);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  const out: string[] = [];
  for (const key of ["invoices_per_month", "staff"]) {
    const v = plan.limits[key];
    if (v === undefined) continue;
    const cell = limitText(t, locale, key, v);
    out.push(`${t(`cmp.limit.${key}`)}: ${cell.kind === "text" ? cell.text : "0"}`);
  }
  for (const g of MODULE_GROUPS)
    for (const key of g.rows) {
      if (out.length >= max) return out;
      if (planHas(plan.modules, key) && !(prev && planHas(prev.modules, key))) out.push(t(`cmp.${key}`));
    }
  return out.slice(0, max);
}
