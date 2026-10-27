import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PART_B_NAV, PART_B_ROUTES, withAccountingPartB } from "./accounting-b";
import { billingMessages, billingModule } from "./index";
import { en, ta } from "./lib/messages/accounting-b";
import { billingModule as baseModule } from "./module";

const FILES = [
  "pages/acctb-bank.tsx",
  "pages/acctb-bank-import.tsx",
  "pages/acctb-bank-reconcile.tsx",
  "pages/acctb-bank-statement.tsx",
  "pages/acctb-cheques.tsx",
  "pages/acctb-tds.tsx",
  "pages/acctb-tds-settings.tsx",
  "pages/acctb-assets.tsx",
  "pages/acctb-year-end.tsx",
  "components/accounting/part-b.tsx",
  "accounting-b.tsx",
];
const src = (f: string) => readFileSync(join(__dirname, f), "utf8");

/** Keys built at run time (`billing.acctb.x.${value}`) and the values they take. */
const DYNAMIC: Record<string, readonly string[]> = {
  "billing.acctb.bank.step.": ["import", "importBody", "match", "matchBody", "confirm", "confirmBody"],
  "billing.acctb.cheque.": ["issued", "received"],
  "billing.acctb.cheque.done.": ["deposit", "clear", "bounce", "cancel", "reopen"],
  "billing.acctb.cheque.reasons.": ["funds", "signature", "stale", "stopped", "other"],
  "billing.acctb.cheque.status.": ["pending", "deposited", "cleared", "bounced", "cancelled"],
  "billing.acctb.deductee.": ["individual", "huf", "company", "firm", "other"],
  "billing.acctb.field.": ["date", "valueDate", "narration", "reference", "debit", "credit", "amount", "drcr", "balance"],
  "billing.acctb.layout.": ["hdfc", "icici", "sbi", "axis", "kotak", "generic"],
  "billing.acctb.preset.": ["bank_charges", "interest_received", "interest_paid", "other_income", "other_expense", "drawings", "capital", "cash_deposit", "cash_withdrawal", "account"],
  "billing.acctb.rec.method.": ["auto", "created", "manual"],
  "billing.acctb.tds.status.": ["paid", "due", "late"],
  "billing.acctb.tds.tab.": ["overview", "register", "challans", "quarterly", "check"],
  "billing.acctb.ye.fix.": ["trial_balance", "year_over", "bank", "tds", "depreciation"],
  "billing.acctb.ye.check.": ["trial_balance", "year_over", "bank", "tds", "depreciation"],
};

describe("accounting Part B screens", () => {
  it("defines every billing.acctb.* key the screens use, in English and Tamil", () => {
    const used = new Set<string>();
    for (const f of FILES) {
      for (const m of src(f).matchAll(/["'`](billing\.acctb\.[a-zA-Z0-9_.]+)(["'`]|\$\{)/g)) {
        const key = m[1]!;
        if (m[2] === "${" || key.endsWith(".")) {
          const values = DYNAMIC[key.endsWith(".") ? key : `${key}.`];
          expect(values, `dynamic key ${key}`).toBeDefined();
          for (const v of values!) used.add(`${key.endsWith(".") ? key : `${key}.`}${v}`);
        } else used.add(key);
      }
    }
    const missingEn = [...used].filter((k) => !(k in en));
    const missingTa = [...used].filter((k) => !(k in ta));
    expect(missingEn).toEqual([]);
    expect(missingTa).toEqual([]);
  });

  it("has the same keys in both languages", () => {
    expect(Object.keys(ta).sort()).toEqual(Object.keys(en).sort());
  });

  it("has Tamil script in every Tamil string (apart from codes like TDS)", () => {
    const latin = Object.keys(en).filter((k) => !/[஀-௿]/.test(ta[k]!) && !/^[A-Z0-9 ()%/.{}+·#-]+$/i.test(ta[k]!));
    expect(latin).toEqual([]);
  });

  it("keeps the same {placeholders} in both languages", () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort().join(",");
    expect(Object.keys(en).filter((k) => ph(en[k]!) !== ph(ta[k]!))).toEqual([]);
  });

  it("adds the screens to the Accounts section after the chart of accounts, behind the accounting feature", () => {
    for (const nav of ["sections", "single"] as const) {
      const m = billingModule({ nav });
      const items = m.nav.flatMap((s) => s.items).map((i) => i.href);
      const at = items.indexOf("accounting/accounts");
      expect(items.slice(at + 1, at + 1 + PART_B_NAV.length)).toEqual(PART_B_NAV.map((i) => i.href));
    }
    for (const i of PART_B_NAV) {
      expect(i.feature).toBe("accounting");
      expect(i.permission).toBe("accounting.view");
    }
    const m = billingModule();
    const paths = m.routes.map((r) => r.path);
    for (const r of PART_B_ROUTES) expect(paths).toContain(r.path);
    expect(m.routes.find((r) => r.path === "accounting/bank/import")?.permission).toBe("accounting.bank");
    for (const r of PART_B_ROUTES) expect(r.feature).toBe("accounting");
    // Nothing of the base module is lost.
    expect(m.routes.length).toBe(baseModule().routes.length + PART_B_ROUTES.length);
  });

  it("merges the messages into the module and the exported billingMessages", () => {
    const m = withAccountingPartB(baseModule());
    expect(m.messages!.en["billing.acctb.nav.bank"]).toBe(en["billing.acctb.nav.bank"]);
    expect(m.messages!.ta["billing.acctb.nav.bank"]).toBe(ta["billing.acctb.nav.bank"]);
    expect(m.messages!.en["billing.accounting.nav.overview"]).toBeTruthy();
    expect(billingMessages.ta["billing.acctb.tds.title"]).toBe(ta["billing.acctb.tds.title"]);
  });

  it("page grids say grid-cols-1 before their wider columns (no overflow at phone width)", () => {
    const bad: string[] = [];
    for (const f of FILES.filter((x) => x.startsWith("pages/"))) {
      for (const m of src(f).matchAll(/className="([^"]*)"/g)) {
        const cls = m[1]!.split(/\s+/);
        if (!cls.includes("grid")) continue;
        const responsive = cls.some((c) => /^(sm|md|lg|xl):grid-cols-/.test(c));
        const base = cls.some((c) => /^grid-cols-/.test(c));
        if (responsive && !base) bad.push(`${f}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
