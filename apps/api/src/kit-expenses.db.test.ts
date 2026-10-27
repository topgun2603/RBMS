/**
 * Expenses bought on credit as supplier bills (kit-expenses.ts `expenseBillsPort`) with the real inventory Payables and
 * the books' posting rules, against Postgres (docs/expenses-debit-notes.md): the expense is in the supplier's ageing and
 * statement, "Pay supplier" settles it oldest first with the purchase bills (or as chosen), a reversal gives the balance
 * back, and the books net the supplier to what Payables says. Runs only with `EXPENSES_TEST_DATABASE_URL` set; it copies
 * the tables into a throw-away schema and drops it afterwards.
 */
import { randomUUID } from "node:crypto";
import { expensePostings, isBalanced, SYS, supplierPaymentPostings, type Posting } from "@srirealtime/accounting";
import { createDb, sql, type Db } from "@srirealtime/db";
import { ExpensesService } from "@srirealtime/expenses";
import { InventoryService, purchases } from "@srirealtime/inventory";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountingSources } from "./kit-accounting";
import { expenseBillsPort, expenseSuppliersPort } from "./kit-expenses";

const URL_ = process.env.EXPENSES_TEST_DATABASE_URL;
const SCHEMA = `exp_payables_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["expense_categories", "expenses", "suppliers", "purchases", "purchase_payments", "debit_notes"];
const T = randomUUID();

describe.skipIf(!URL_)("credit expenses in Payables and the books (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let inventory: InventoryService;
  let expenses: ExpensesService;
  const clock = new Date("2026-10-25T06:00:00Z");

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 4 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    inventory = new InventoryService({
      db,
      catalog: { getItems: async () => [], listItems: async () => [] },
      sellerState: { stateCode: async () => "33" },
      expenseBills: expenseBillsPort(db),
      now: () => clock,
    });
    expenses = new ExpensesService({ db, now: () => clock, suppliers: expenseSuppliersPort(() => inventory) });
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema "${SCHEMA}" cascade`));
    await close?.();
  });

  const amountOn = (ps: Posting[], key: string, partyId?: string) =>
    ps.flatMap((p) => p.lines).filter((l) => "key" in l.account && l.account.key === key && (!partyId || l.party?.id === partyId)).reduce((t, l) => t + l.debit - l.credit, 0);

  it("ages, lists, pays and posts a credit expense like a purchase bill", async () => {
    const sup = await inventory.createSupplier(T, { name: "Kumar Estates", gstin: "33AAGCB7383J1ZF" });
    // A purchase bill of 1 Oct (₹5,000) and the October rent bought on credit, due 10 Oct (₹11,800 incl. 18% GST).
    const [bill] = await db
      .insert(purchases)
      .values({
        tenantId: T,
        supplierId: sup.id,
        supplier: { name: sup.name, phone: null, email: null, gstin: sup.gstin, address: null, stateCode: "33" },
        billNumber: "KE-101",
        date: "2026-10-01",
        placeOfSupply: "33",
        lines: [],
        totals: { subtotal: 500_000, discount: 0, taxable: 500_000, cgst: 0, sgst: 0, igst: 0, roundOff: 0, total: 500_000, taxBreakup: [] },
        total: 500_000,
      })
      .returning();
    const rent = await expenses.create(T, { date: "2026-10-05", amount: 1_180_000, gstRate: 18, paymentMethod: "credit", supplierId: sup.id, reference: "RENT-OCT", dueDate: "2026-10-10" }, null);
    expect(rent).toMatchObject({ vendorName: "Kumar Estates", balance: 1_180_000, itc: 180_000 });

    // Supplier list, ageing and statement include the expense.
    expect((await inventory.getSupplier(T, sup.id)).payable).toBe(500_000 + 1_180_000);
    const ageing = await inventory.purchasing.payablesAgeing(T, { asOf: "2026-10-25" });
    expect(ageing.rows.find((r) => r.supplierId === sup.id)).toMatchObject({ total: 1_680_000, overdue: 1_680_000, b0_30: 1_680_000 });
    const st = await inventory.purchasing.supplierStatement(T, sup.id);
    expect(st.rows.map((r) => [r.type, r.ref, r.credit])).toEqual([
      ["purchase", "KE-101", 500_000],
      ["expense", "RENT-OCT", 1_180_000],
    ]);

    // Pay ₹10,000 as a lump sum: the older purchase bill first, then the expense.
    const pay = await inventory.purchasing.paySupplier(T, sup.id, { amount: 1_000_000, mode: "bank", date: "2026-10-25" });
    expect(pay.allocations).toEqual([
      { purchaseId: bill!.id, expenseId: null, billNumber: "KE-101", amount: 500_000 },
      { purchaseId: null, expenseId: rent.id, billNumber: "RENT-OCT", amount: 500_000 },
    ]);
    expect(pay.onAccount).toBe(0);
    expect((await expenses.get(T, rent.id)).balance).toBe(680_000);
    // A chosen part names the expense.
    const rest = await inventory.purchasing.paySupplier(T, sup.id, { amount: 680_000, mode: "upi", date: "2026-10-25", allocations: [{ expenseId: rent.id, amount: 680_000 }] });
    expect(rest.allocations[0]).toMatchObject({ expenseId: rent.id, amount: 680_000 });
    expect((await expenses.get(T, rent.id)).balance).toBe(0);
    // An expense with money on it can't be cancelled; reversing the payment gives the balance back.
    await expect(expenses.cancel(T, rent.id)).rejects.toMatchObject({ status: 400 });
    await inventory.purchasing.reversePaymentGroup(T, rest.groupId, { reason: "wrong account" });
    expect((await expenses.get(T, rent.id)).balance).toBe(680_000);
    const listed = await inventory.purchasing.listPayments(T, { supplierId: sup.id });
    expect(listed.items.filter((p) => p.expenseId === rent.id).map((p) => p.billNumber)).toEqual(["RENT-OCT", "RENT-OCT"]);

    // The books: expense Dr (net of ITC) / Cr Creditors; payments Dr Creditors / Cr bank. The supplier nets to what
    // Payables still shows for the expense (purchase bills are posted by their own rule and left out here).
    const src = accountingSources({ db, invoices: null as never, inventory, sellerState: async () => "33", isEnabled: async () => true });
    const exp = (await src.expenses(T)).find((e) => e.id === rent.id)!;
    expect(exp).toMatchObject({ onCredit: true, supplierId: sup.id, itc: 180_000 });
    const postings = [
      ...expensePostings(exp, { importedBills: "exclude", shopState: "33" }),
      ...(await src.supplierPayments(T)).filter((p) => p.purchaseBill === "RENT-OCT").flatMap((p) => supplierPaymentPostings(p, { importedBills: "exclude", shopState: "33" })),
    ];
    for (const p of postings) expect(isBalanced(p.lines)).toBe(true);
    expect(amountOn(postings, SYS.creditors, sup.id)).toBe(-680_000);
    expect(amountOn(postings, SYS.gstInCgst) + amountOn(postings, SYS.gstInSgst)).toBe(180_000);
    expect((await expenses.get(T, rent.id)).balance).toBe(680_000);
  });
});
