import { describe, expect, it } from "vitest";
import { ACCOUNTING_FEATURES, ACCOUNTING_PERMISSIONS } from "./features";
import { accountInput, accountPatch, backfillInput, entryInput, entryListQuery, kindLabel, lockInput, reverseInput, settingsPatch } from "./service";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("module declarations", () => {
  it("declares one feature that is off until the owner switches it on, and three permissions", () => {
    expect(ACCOUNTING_FEATURES).toHaveLength(1);
    expect(ACCOUNTING_FEATURES[0]).toMatchObject({ key: "accounting", shopToggle: true, defaultOn: false, dependsOn: ["invoices"] });
    expect(ACCOUNTING_PERMISSIONS.map((p) => p.key)).toEqual(["accounting.view", "accounting.post", "accounting.lock"]);
    for (const p of ACCOUNTING_PERMISSIONS) expect(p.module).toBe("accounting");
  });
});

describe("entryInput", () => {
  it("accepts a journal with lines and a simple payment voucher", () => {
    expect(() => entryInput.parse({ voucherType: "journal", date: "2026-10-01", narration: "Rent", lines: [{ accountId: A, debit: 100 }, { accountId: B, credit: 100 }] })).not.toThrow();
    expect(() => entryInput.parse({ voucherType: "payment", date: "2026-10-01", narration: "Rent", simple: { accountId: A, otherAccountId: B, amount: 100 } })).not.toThrow();
  });
  it("needs lines for a journal and the two accounts for the others", () => {
    expect(() => entryInput.parse({ voucherType: "journal", date: "2026-10-01", narration: "x" })).toThrow();
    expect(() => entryInput.parse({ voucherType: "receipt", date: "2026-10-01", narration: "x", lines: [] })).toThrow();
  });
  it("rejects a bad date, an empty narration, a negative or fractional amount", () => {
    const base = { voucherType: "journal", date: "2026-10-01", narration: "x", lines: [{ accountId: A, debit: 1 }] };
    expect(() => entryInput.parse({ ...base, date: "2026-13-01" })).toThrow();
    expect(() => entryInput.parse({ ...base, narration: " " })).toThrow();
    expect(() => entryInput.parse({ ...base, lines: [{ accountId: A, debit: -1 }] })).toThrow();
    expect(() => entryInput.parse({ ...base, lines: [{ accountId: A, debit: 1.5 }] })).toThrow();
    expect(() => entryInput.parse({ ...base, voucherType: "auto" })).toThrow();
  });
});

describe("other inputs", () => {
  it("account input and patch", () => {
    expect(accountInput.parse({ name: " Shop rent deposit ", type: "asset", group: "current_assets" }).name).toBe("Shop rent deposit");
    expect(() => accountInput.parse({ name: "x", type: "asset", group: "current_assets", code: "bad code!" })).toThrow();
    expect(() => accountInput.parse({ name: "x", type: "wealth", group: "g" })).toThrow();
    expect(accountPatch.parse({ active: false })).toEqual({ active: false });
    expect(() => accountPatch.parse({ bankAccountLast4: "12345" })).toThrow();
  });
  it("lock, reverse, settings and backfill", () => {
    expect(lockInput.parse({ lockedThrough: null }).lockedThrough).toBeNull();
    expect(() => lockInput.parse({ lockedThrough: "yesterday" })).toThrow();
    expect(() => reverseInput.parse({})).toThrow();
    expect(reverseInput.parse({ reason: "Wrong account" }).reason).toBe("Wrong account");
    expect(settingsPatch.parse({ importedBills: "post" })).toEqual({ importedBills: "post" });
    expect(() => settingsPatch.parse({ importedBills: "maybe" })).toThrow();
    expect(backfillInput.parse({ from: "2026-04-01", dryRun: true })).toEqual({ from: "2026-04-01", dryRun: true });
  });
  it("list query: comma lists, bad enum and reversed range", () => {
    expect(entryListQuery.parse({ voucherType: "journal,contra", origin: "manual" }).voucherType).toEqual(["journal", "contra"]);
    expect(() => entryListQuery.parse({ voucherType: "bogus" })).toThrow();
    expect(() => entryListQuery.parse({ from: "2026-10-10", to: "2026-10-01" })).toThrow();
  });
  it("names an entry in plain words", () => {
    expect(kindLabel({ voucherType: "auto", sourceType: "invoice" })).toBe("Sales bill");
    expect(kindLabel({ voucherType: "journal", sourceType: null })).toBe("Journal voucher");
    expect(kindLabel({ voucherType: "reversal", sourceType: null })).toBe("Reversal");
  });
});
