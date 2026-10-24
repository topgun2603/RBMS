import type { AccountingService } from "@srirealtime/accounting";
import type { Db } from "@srirealtime/db";
import { and, eq, gte, inArray, lte } from "@srirealtime/db";
import { expenseCategories, expenses } from "@srirealtime/expenses";
import type { ExpenseSrc, GstSourcesPort, LedgerPort, PurchaseReturnSrc, PurchaseSrc, SalesDocSrc, VoidedNumberSrc } from "@srirealtime/gstfiling";
import { formatInvoiceNumber, todayIST } from "@srirealtime/gst";
import { debitNotes, purchases, suppliers } from "@srirealtime/inventory";
import { posNumberBlocks } from "@srirealtime/pos";

/** Ports of GST filing over the bills, purchases, expenses and offline-billing blocks. Read-only: nothing here writes. */
export interface GstFilingAdapterDeps {
  db: Db;
  /** The shop's billing profile (settings namespace "billing"). */
  profile: (tenantId: string) => Promise<{ gstin?: unknown; legalName?: unknown; stateCode?: unknown }>;
  /** Bills and credit notes dated in the range (imported history and drafts already left out), as the e-invoice module reads them. */
  salesForPeriod: (tenantId: string, range: { from: string; to: string }) => Promise<SalesDocSrc[]>;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const n = (v: unknown) => Number(v ?? 0);

export function gstFilingSources(deps: GstFilingAdapterDeps): GstSourcesPort {
  const { db } = deps;

  const toPurchase = (p: typeof purchases.$inferSelect): PurchaseSrc => ({
    id: p.id,
    billNumber: p.billNumber,
    date: p.date,
    status: p.status === "cancelled" ? "cancelled" : "recorded",
    imported: p.imported,
    supplierId: p.supplierId,
    supplierName: p.supplier?.name ?? "Supplier",
    supplierGstin: p.supplier?.gstin ?? null,
    supplierState: p.supplier?.stateCode ?? null,
    placeOfSupply: p.placeOfSupply,
    interState: p.interState,
    lines: p.lines.map((l) => ({ description: l.description, hsn: l.hsn ?? null, qty: l.qty, gstRate: l.gstRate, taxable: l.taxable, cgst: l.cgst, sgst: l.sgst, igst: l.igst })),
    taxable: n(p.totals.taxable),
    cgst: n(p.totals.cgst),
    sgst: n(p.totals.sgst),
    igst: n(p.totals.igst),
    total: p.total,
    amountPaid: p.amountPaid,
    dueDate: p.dueDate,
  });

  const toExpense = (e: typeof expenses.$inferSelect): ExpenseSrc => ({
    id: e.id,
    date: e.date,
    status: e.status,
    categoryName: "",
    amount: e.amount,
    gstRate: e.gstRate,
    gstAmount: e.gstAmount,
    vendorName: e.vendorName,
    vendorGstin: e.vendorGstin,
    reference: e.reference,
  });

  const expenseRows = async (where: ReturnType<typeof and>): Promise<ExpenseSrc[]> => {
    const rows = await db.select({ e: expenses, category: expenseCategories.name }).from(expenses).leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId)).where(where);
    return rows.map(({ e, category }) => ({ ...toExpense(e), categoryName: category ?? "Other" }));
  };

  return {
    async profile(tenantId) {
      const p = await deps.profile(tenantId);
      return { gstin: str(p.gstin), legalName: str(p.legalName), stateCode: str(p.stateCode) };
    },

    async sales(tenantId, range) {
      return deps.salesForPeriod(tenantId, range);
    },

    async purchases(tenantId, range) {
      const rows = await db.select().from(purchases).where(and(eq(purchases.tenantId, tenantId), gte(purchases.date, range.from), lte(purchases.date, range.to)));
      return rows.map(toPurchase);
    },

    async purchasesByIds(tenantId, ids) {
      if (!ids.length) return [];
      const rows = await db.select().from(purchases).where(and(eq(purchases.tenantId, tenantId), inArray(purchases.id, ids)));
      return rows.map(toPurchase);
    },

    async purchaseReturns(tenantId, range) {
      const rows = await db
        .select({ d: debitNotes, bill: purchases.billNumber, imported: purchases.imported, supplier: purchases.supplier, supplierRow: suppliers.gstin })
        .from(debitNotes)
        .leftJoin(purchases, eq(purchases.id, debitNotes.purchaseId))
        .leftJoin(suppliers, eq(suppliers.id, debitNotes.supplierId))
        .where(and(eq(debitNotes.tenantId, tenantId), gte(debitNotes.date, range.from), lte(debitNotes.date, range.to)));
      return rows.map(
        ({ d, bill, imported, supplier, supplierRow }): PurchaseReturnSrc => ({
          id: d.id,
          number: d.number,
          date: d.date,
          status: d.status === "cancelled" ? "cancelled" : "issued",
          imported: !!imported,
          purchaseId: d.purchaseId,
          billNumber: bill ?? null,
          supplierId: d.supplierId,
          supplierName: d.supplierName,
          supplierGstin: supplier?.gstin ?? supplierRow ?? null,
          taxable: n(d.totals.taxable),
          cgst: n(d.totals.cgst),
          sgst: n(d.totals.sgst),
          igst: n(d.totals.igst),
          total: d.total,
        }),
      );
    },

    expenses: (tenantId, range) => expenseRows(and(eq(expenses.tenantId, tenantId), gte(expenses.date, range.from), lte(expenses.date, range.to))),
    async expensesByIds(tenantId, ids) {
      if (!ids.length) return [];
      return expenseRows(and(eq(expenses.tenantId, tenantId), inArray(expenses.id, ids)));
    },

    /** Numbers of closed offline blocks that no bill holds, and bills cancelled at the counter, by the day they were released. */
    async voidedNumbers(tenantId, range) {
      const rows = await db.select().from(posNumberBlocks).where(eq(posNumberBlocks.tenantId, tenantId));
      const out: VoidedNumberSrc[] = [];
      for (const b of rows) {
        const fy = b.fy;
        for (const v of b.voided ?? []) {
          const date = todayIST(new Date(v.at));
          if (date < range.from || date > range.to) continue;
          out.push({ number: formatInvoiceNumber(b.prefix, fy, v.seq), prefix: b.prefix, seq: v.seq, date, reason: v.reason });
        }
      }
      return out;
    },
  };
}

/** The books' GST ledger, when the shop has switched accounting on. */
export function gstFilingLedger(deps: { accounting: AccountingService; isEnabled: (tenantId: string, key: string) => Promise<boolean> }): LedgerPort {
  return {
    isEnabled: (tenantId) => deps.isEnabled(tenantId, "accounting"),
    async gstLedger(tenantId, range) {
      const l = await deps.accounting.gstLedger(tenantId, range);
      return { output: { cgst: l.output.cgst, sgst: l.output.sgst, igst: l.output.igst, cess: l.output.cess }, input: { cgst: l.input.cgst, sgst: l.input.sgst, igst: l.input.igst, cess: l.input.cess } };
    },
  };
}
