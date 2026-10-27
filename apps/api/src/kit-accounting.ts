import type {
  GstPaymentSrc,
  CreditNoteSrc,
  DebitNoteSrc,
  ExpenseSrc,
  InvoicePaymentSrc,
  InvoiceSrc,
  MoneyMethod,
  PayrollSrc,
  PurchaseSrc,
  ReceiptSrc,
  ReconcilePort,
  SalesDebitNoteSrc,
  SourcesPort,
  StockAdjustmentSrc,
  StockValuePort,
  SupplierPaymentSrc,
  TillSrc,
} from "@srirealtime/accounting";
import { TDS_SETTLEMENT_PREFIX } from "@srirealtime/accounting";
import type { Db } from "@srirealtime/db";
import { expenseCategories, expenses, itcOf } from "@srirealtime/expenses";
import { gstTaxPayments } from "@srirealtime/gstfiling";
import { todayIST } from "@srirealtime/gst";
import { billingCustomers, creditNotes, customerReceipts, invoicePayments, invoices, salesDebitNotes, tillSessions, type InvoicesService } from "@srirealtime/invoices";
import { debitNotes, methodAt, purchasePayments, purchases, stockItems, stockMovements, suppliers, type InventoryService } from "@srirealtime/inventory";
import { and, eq, gt, inArray, isNull, sql } from "@srirealtime/db";
import { likePattern } from "@srirealtime/core";

/** Ports of the accounting module over the invoices, inventory and expenses tables. Read-only, except settleSupplierTds / unsettleSupplierTds (Part B), which record and undo the TDS on a supplier bill through the inventory service. */
export interface AccountingAdapterDeps {
  db: Db;
  invoices: InvoicesService;
  inventory: InventoryService;
  /** The shop's GST state code from the billing profile. */
  sellerState: (tenantId: string) => Promise<string | null>;
  isEnabled: (tenantId: string, key: string) => Promise<boolean>;
  /** Staff payroll (final payrolls, salaries paid, advances, statutory deposits); see docs/payroll.md. */
  payroll?: { bookSources(tenantId: string): Promise<PayrollSrc> };
}

const istDate = (d: Date | null | undefined) => (d ? todayIST(d) : null);
const method = (m: string): MoneyMethod => (m === "cash" || m === "upi" || m === "card" || m === "bank" || m === "cheque" ? m : "other");
const n = (v: unknown) => Number(v ?? 0);

export function accountingSources(deps: AccountingAdapterDeps): SourcesPort {
  const { db } = deps;
  return {
    async invoices(tenantId) {
      const rows = await db
        .select({
          id: invoices.id,
          number: invoices.number,
          date: invoices.date,
          status: invoices.status,
          imported: invoices.imported,
          customerId: invoices.customerId,
          customer: invoices.customer,
          total: invoices.total,
          totals: invoices.totals,
          cancelledAt: invoices.cancelledAt,
        })
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), sql`${invoices.status} <> 'draft'`));
      return rows.map(
        (r): InvoiceSrc => ({
          id: r.id,
          number: r.number,
          date: r.date,
          status: r.status as InvoiceSrc["status"],
          imported: r.imported,
          customerId: r.customerId,
          customerName: r.customer?.name ?? "Customer",
          total: r.total,
          subtotal: n(r.totals.subtotal),
          discount: n(r.totals.discount),
          taxable: n(r.totals.taxable),
          cgst: n(r.totals.cgst),
          sgst: n(r.totals.sgst),
          igst: n(r.totals.igst),
          roundOff: n(r.totals.roundOff),
          cancelledOn: istDate(r.cancelledAt),
        }),
      );
    },

    async invoicePayments(tenantId) {
      const rows = await db
        .select({
          id: invoicePayments.id,
          invoiceId: invoicePayments.invoiceId,
          number: invoices.number,
          customerId: invoices.customerId,
          customer: invoices.customer,
          imported: invoices.imported,
          date: invoicePayments.date,
          amount: invoicePayments.amount,
          method: invoicePayments.method,
          receiptId: invoicePayments.receiptId,
          forexDiff: invoicePayments.forexDiff,
        })
        .from(invoicePayments)
        .innerJoin(invoices, and(eq(invoices.id, invoicePayments.invoiceId), eq(invoices.tenantId, tenantId)))
        .where(eq(invoicePayments.tenantId, tenantId));
      return rows.map(
        (r): InvoicePaymentSrc => ({
          id: r.id,
          invoiceId: r.invoiceId,
          invoiceNumber: r.number,
          customerId: r.customerId,
          customerName: r.customer?.name ?? "Customer",
          imported: r.imported,
          date: r.date,
          amount: r.amount,
          method: method(r.method),
          receiptId: r.receiptId,
          ...(r.forexDiff ? { forexDiff: r.forexDiff } : {}),
        }),
      );
    },

    async receipts(tenantId) {
      const rows = await db
        .select({ id: customerReceipts.id, customerId: customerReceipts.customerId, name: billingCustomers.name, date: customerReceipts.date, amount: customerReceipts.amount, method: customerReceipts.method, reference: customerReceipts.reference })
        .from(customerReceipts)
        .leftJoin(billingCustomers, eq(billingCustomers.id, customerReceipts.customerId))
        .where(eq(customerReceipts.tenantId, tenantId));
      return rows.map((r): ReceiptSrc => ({ id: r.id, customerId: r.customerId, customerName: r.name ?? "Customer", date: r.date, amount: r.amount, method: method(r.method), reference: r.reference }));
    },

    async creditNotes(tenantId) {
      const rows = await db
        .select({
          id: creditNotes.id,
          number: creditNotes.number,
          invoiceNumber: creditNotes.invoiceNumber,
          date: creditNotes.date,
          status: creditNotes.status,
          customerId: creditNotes.customerId,
          customer: creditNotes.customer,
          total: creditNotes.total,
          totals: creditNotes.totals,
          cancelledAt: creditNotes.cancelledAt,
          invoiceStatus: invoices.status,
          invoiceImported: invoices.imported,
        })
        .from(creditNotes)
        .innerJoin(invoices, and(eq(invoices.id, creditNotes.invoiceId), eq(invoices.tenantId, tenantId)))
        .where(eq(creditNotes.tenantId, tenantId));
      return rows.map(
        (r): CreditNoteSrc => ({
          id: r.id,
          number: r.number,
          invoiceNumber: r.invoiceNumber,
          date: r.date,
          status: r.status,
          invoiceCancelled: r.invoiceStatus === "cancelled",
          invoiceImported: r.invoiceImported,
          customerId: r.customerId,
          customerName: r.customer?.name ?? "Customer",
          total: r.total,
          taxable: n(r.totals.taxable),
          cgst: n(r.totals.cgst),
          sgst: n(r.totals.sgst),
          igst: n(r.totals.igst),
          roundOff: n(r.totals.roundOff),
          cancelledOn: istDate(r.cancelledAt),
        }),
      );
    },

    async purchases(tenantId) {
      const rows = await db.select().from(purchases).where(eq(purchases.tenantId, tenantId));
      return rows.map(
        (r): PurchaseSrc => ({
          id: r.id,
          billNumber: r.billNumber,
          date: r.date,
          status: r.status,
          imported: r.imported,
          supplierId: r.supplierId,
          supplierName: r.supplier?.name ?? "Supplier",
          total: r.total,
          cgst: n(r.totals.cgst),
          sgst: n(r.totals.sgst),
          igst: n(r.totals.igst),
          roundOff: n(r.totals.roundOff),
          cancelledOn: istDate(r.cancelledAt),
        }),
      );
    },

    async supplierPayments(tenantId) {
      const rows = await db
        .select({
          id: purchasePayments.id,
          supplierId: purchasePayments.supplierId,
          supplierName: suppliers.name,
          bill: purchases.billNumber,
          billImported: purchases.imported,
          expenseRef: sql<string | null>`coalesce(${expenses.reference}, ${expenseCategories.name})`,
          kind: purchasePayments.kind,
          amount: purchasePayments.amount,
          mode: purchasePayments.mode,
          date: purchasePayments.date,
          reversedAt: purchasePayments.reversedAt,
        })
        .from(purchasePayments)
        .leftJoin(suppliers, eq(suppliers.id, purchasePayments.supplierId))
        .leftJoin(purchases, eq(purchases.id, purchasePayments.purchaseId))
        // An expense bought on credit, paid through Payables (docs/expenses-debit-notes.md).
        .leftJoin(expenses, eq(expenses.id, purchasePayments.expenseId))
        .leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
        // TDS settled on a bill (Part B) is posted by its TDS entry (Dr Creditors / Cr TDS payable), not as a payment.
        .where(and(eq(purchasePayments.tenantId, tenantId), sql`coalesce(${purchasePayments.reference}, '') not like ${`${TDS_SETTLEMENT_PREFIX}%`}`));
      return rows.map(
        (r): SupplierPaymentSrc => ({
          id: r.id,
          supplierId: r.supplierId,
          supplierName: r.supplierName ?? "Supplier",
          purchaseBill: r.bill ?? r.expenseRef,
          purchaseImported: !!r.billImported,
          kind: r.kind,
          amount: r.amount,
          mode: method(r.mode),
          date: r.date,
          reversedOn: istDate(r.reversedAt),
        }),
      );
    },

    async debitNotes(tenantId) {
      const rows = await db
        .select({ d: debitNotes, imported: purchases.imported })
        .from(debitNotes)
        .leftJoin(purchases, eq(purchases.id, debitNotes.purchaseId))
        .where(eq(debitNotes.tenantId, tenantId));
      return rows.map(
        ({ d, imported }): DebitNoteSrc => ({
          id: d.id,
          number: d.number,
          date: d.date,
          status: d.status === "cancelled" ? "cancelled" : "issued",
          supplierId: d.supplierId,
          supplierName: d.supplierName,
          purchaseImported: !!imported,
          total: d.total,
          cgst: n(d.totals.cgst),
          sgst: n(d.totals.sgst),
          igst: n(d.totals.igst),
          roundOff: n(d.totals.roundOff),
          cancelledOn: istDate(d.cancelledAt),
        }),
      );
    },

    async expenses(tenantId) {
      const rows = await db
        .select({ e: expenses, category: expenseCategories.name })
        .from(expenses)
        .leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
        // Drafts (recurring expenses waiting to be filled) are not in the books until recorded.
        .where(and(eq(expenses.tenantId, tenantId), sql`${expenses.status} <> 'draft'`));
      return rows.map(
        ({ e, category }): ExpenseSrc => ({
          id: e.id,
          date: e.date,
          status: e.status === "cancelled" ? "cancelled" : "recorded",
          categoryId: e.categoryId,
          categoryName: category ?? "Other",
          amount: e.amount,
          gstAmount: e.gstAmount,
          // The credit the expense carried when recorded (a cancelled expense reports none).
          itc: itcOf({ gstAmount: e.gstAmount, vendorGstin: e.vendorGstin, status: "recorded" }),
          vendorName: e.vendorName,
          vendorGstin: e.vendorGstin,
          paymentMethod: method(e.paymentMethod),
          // Bought on credit: owed to the supplier (Creditors) until paid through Payables.
          onCredit: e.paymentMethod === "credit" && !!e.supplierId,
          supplierId: e.supplierId,
          cancelledOn: e.status === "cancelled" ? istDate(e.updatedAt) : null,
        }),
      );
    },

    /** Debit notes to customers (docs/expenses-debit-notes.md): the customer owes more, sales and output GST go up. */
    async salesDebitNotes(tenantId) {
      const rows = await db.select().from(salesDebitNotes).where(eq(salesDebitNotes.tenantId, tenantId));
      return rows.map(
        (r): SalesDebitNoteSrc => ({
          id: r.id,
          number: r.number,
          invoiceNumber: r.invoiceNumber,
          date: r.date,
          status: r.status,
          customerId: r.customerId,
          customerName: r.customer?.name ?? "Customer",
          total: r.total,
          taxable: n(r.totals.taxable),
          cgst: n(r.totals.cgst),
          sgst: n(r.totals.sgst),
          igst: n(r.totals.igst),
          roundOff: n(r.totals.roundOff),
          cancelledOn: istDate(r.cancelledAt),
        }),
      );
    },

    /** Composition tax paid by challan (GST filing > Composition): an expense of the shop. */
    async gstPayments(tenantId) {
      const rows = await db.select().from(gstTaxPayments).where(and(eq(gstTaxPayments.tenantId, tenantId), eq(gstTaxPayments.kind, "composition")));
      return rows.map(
        (r): GstPaymentSrc => ({
          id: r.id,
          date: r.paidOn,
          amount: r.igst + r.cgst + r.sgst + r.cess + r.interest + r.lateFee,
          mode: method(r.method),
          status: r.status === "cancelled" ? "cancelled" : "paid",
          cancelledOn: r.status === "cancelled" ? istDate(r.updatedAt) : null,
          period: r.period,
        }),
      );
    },

    /** Staff payroll: the payroll module hands over its own documents (cancelled ones left out, so their postings reverse). */
    async payroll(tenantId) {
      if (!deps.payroll) return { runs: [], payments: [], advances: [], dues: [] };
      return deps.payroll.bookSources(tenantId);
    },

    async tills(tenantId) {
      const rows = await db
        .select({ id: tillSessions.id, register: tillSessions.register, status: tillSessions.status, closedAt: tillSessions.closedAt, difference: tillSessions.difference, cashEntries: tillSessions.cashEntries, handovers: tillSessions.handovers })
        .from(tillSessions)
        .where(eq(tillSessions.tenantId, tenantId));
      return rows.map(
        (r): TillSrc => ({
          id: r.id,
          register: r.register,
          status: r.status,
          closedOn: istDate(r.closedAt),
          difference: r.difference,
          cashEntries: (r.cashEntries ?? []).map((c) => ({ id: c.id, amount: c.amount, reason: c.reason, on: todayIST(new Date(c.at)), ...(c.category ? { category: c.category } : {}) })),
          handovers: (r.handovers ?? []).map((h) => ({ id: h.id, difference: h.difference, on: todayIST(new Date(h.at)) })),
        }),
      );
    },

    async openingBalances(tenantId) {
      const [customers, sups] = await Promise.all([
        db
          .select({ id: billingCustomers.id, name: billingCustomers.name, opening: billingCustomers.openingBalance })
          .from(billingCustomers)
          .where(and(eq(billingCustomers.tenantId, tenantId), isNull(billingCustomers.deletedAt), sql`${billingCustomers.openingBalance} <> 0`)),
        db
          .select({ id: suppliers.id, name: suppliers.name, opening: suppliers.openingBalance })
          .from(suppliers)
          .where(and(eq(suppliers.tenantId, tenantId), isNull(suppliers.deletedAt), sql`${suppliers.openingBalance} <> 0`)),
      ]);
      return { customers, suppliers: sups };
    },

    /** Opening stock and hand adjustments at cost: the movement's unit cost for stock added, the item's average cost otherwise. */
    async stockAdjustments(tenantId) {
      if (!(await deps.isEnabled(tenantId, "inventory"))) return [];
      const rows = await db
        .select({
          id: stockMovements.id,
          reason: stockMovements.reason,
          delta: stockMovements.delta,
          unitCost: stockMovements.unitCost,
          at: stockMovements.createdAt,
          avgCost: stockItems.avgCost,
          costFifo: stockMovements.costFifo,
        })
        .from(stockMovements)
        .leftJoin(
          stockItems,
          and(eq(stockItems.tenantId, stockMovements.tenantId), eq(stockItems.itemId, stockMovements.itemId), sql`${stockItems.locationId} is not distinct from ${stockMovements.locationId}`),
        )
        .where(and(eq(stockMovements.tenantId, tenantId), sql`${stockMovements.reason} in ('opening', 'adjustment', 'audit')`));
      // From the date a shop values stock by FIFO, a write-off is valued at the FIFO cost it took (docs/valuation-reports.md).
      const history = await deps.inventory.costing.history(tenantId);
      return rows.flatMap((r): StockAdjustmentSrc[] => {
        const delta = Number(r.delta);
        const unit = delta > 0 ? (r.unitCost ?? r.avgCost ?? 0) : (r.avgCost ?? r.unitCost ?? 0);
        const fifo = history.length > 0 && r.costFifo !== null && methodAt(history, todayIST(r.at)) === "fifo";
        const value = fifo ? r.costFifo! : Math.round(delta * unit);
        return value ? [{ id: r.id, date: todayIST(r.at), reason: r.reason === "opening" ? "opening" : "adjustment", value, itemName: null }] : [];
      });
    },

    shopStateCode: (tenantId) => deps.sellerState(tenantId),

    // ---- Part B (TDS/TCS): parties with their GSTIN, and the TDS settled on supplier bills in Payables.
    async parties(tenantId, type, q = {}) {
      const limit = Math.min(Math.max(q.limit ?? 50, 1), 500);
      const n = q.ids?.length ? q.ids.length : limit;
      if (type === "supplier") {
        return db
          .select({ id: suppliers.id, name: suppliers.name, gstin: suppliers.gstin, phone: suppliers.phone })
          .from(suppliers)
          .where(and(eq(suppliers.tenantId, tenantId), isNull(suppliers.deletedAt), q.ids?.length ? inArray(suppliers.id, q.ids) : undefined, q.search ? sql`${suppliers.name} ilike ${likePattern(q.search)}` : undefined))
          .orderBy(sql`lower(${suppliers.name})`)
          .limit(n);
      }
      return db
        .select({ id: billingCustomers.id, name: billingCustomers.name, gstin: billingCustomers.gstin, phone: billingCustomers.phone })
        .from(billingCustomers)
        .where(and(eq(billingCustomers.tenantId, tenantId), isNull(billingCustomers.deletedAt), q.ids?.length ? inArray(billingCustomers.id, q.ids) : undefined, q.search ? sql`${billingCustomers.name} ilike ${likePattern(q.search)}` : undefined))
        .orderBy(sql`lower(${billingCustomers.name})`)
        .limit(n);
    },

    async settleSupplierTds(tenantId, p) {
      const reference = `${TDS_SETTLEMENT_PREFIX}${p.tdsId}`;
      const input = { amount: p.amount, mode: "other" as const, reference, date: p.date, note: p.note.slice(0, 500) };
      if (p.expenseId) {
        // An expense bought on credit: the tax is settled on that expense in Payables.
        const r = await deps.inventory.purchasing.paySupplier(tenantId, p.supplierId, { ...input, allocations: [{ expenseId: p.expenseId, amount: p.amount }] }, null);
        return `group:${r.groupId}`;
      }
      if (p.purchaseId) {
        await deps.inventory.purchasing.payPurchase(tenantId, p.purchaseId, input, null);
        const [row] = await db
          .select({ id: purchasePayments.id })
          .from(purchasePayments)
          .where(and(eq(purchasePayments.tenantId, tenantId), eq(purchasePayments.reference, reference), isNull(purchasePayments.reversedAt)))
          .limit(1);
        return row ? `payment:${row.id}` : null;
      }
      const r = await deps.inventory.purchasing.paySupplier(tenantId, p.supplierId, input, null);
      return `group:${r.groupId}`;
    },

    async unsettleSupplierTds(tenantId, settlementId, reason) {
      const [kind, id] = settlementId.split(":");
      if (!id) return;
      if (kind === "group") await deps.inventory.purchasing.reversePaymentGroup(tenantId, id, { reason }, null);
      else await deps.inventory.purchasing.reversePayment(tenantId, id, { reason }, null);
    },
  };
}

/**
 * Stock value from the moving-average cost: quantity at the date (current quantity less later movements) x average cost.
 * From the date a shop switched to FIFO (docs/valuation-reports.md) the FIFO layers left as of the date instead.
 */
export function accountingStock(deps: Pick<AccountingAdapterDeps, "db" | "isEnabled" | "sellerState"> & { inventory?: InventoryService }): StockValuePort {
  const { db } = deps;
  return {
    async value(tenantId, asOf) {
      if (!(await deps.isEnabled(tenantId, "inventory"))) return null;
      if (deps.inventory) return deps.inventory.costing.bookValue(tenantId, asOf, () => averageValue(tenantId, asOf));
      return averageValue(tenantId, asOf);
    },
  };
  async function averageValue(tenantId: string, asOf: string): Promise<number> {
    const items = await db
      .select({ itemId: stockItems.itemId, locationId: stockItems.locationId, qty: stockItems.qty, avgCost: stockItems.avgCost })
      .from(stockItems)
      .where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.track, true)));
    const key = (i: string, l: string | null) => `${i}|${l ?? ""}`;
    const after = new Map<string, number>();
    if (asOf < todayIST(new Date())) {
      const cutoff = new Date(`${asOf}T23:59:59.999+05:30`);
      const rows = await db
        .select({ itemId: stockMovements.itemId, locationId: stockMovements.locationId, delta: sql<string>`sum(${stockMovements.delta})` })
        .from(stockMovements)
        .where(and(eq(stockMovements.tenantId, tenantId), gt(stockMovements.createdAt, cutoff)))
        .groupBy(stockMovements.itemId, stockMovements.locationId);
      for (const r of rows) after.set(key(r.itemId, r.locationId), Number(r.delta));
    }
    let total = 0;
    for (const i of items) {
      const qty = Math.max(0, Number(i.qty) - (after.get(key(i.itemId, i.locationId)) ?? 0));
      total += Math.round(qty * (i.avgCost ?? 0));
    }
    return total;
  }
}

/** The credit book and payables totals, and the existing GST summaries, to reconcile the books against. */
export function accountingReconcile(deps: AccountingAdapterDeps): ReconcilePort {
  return {
    async customerBalances(tenantId) {
      const out: { id: string; name: string; balance: number }[] = [];
      for (let offset = 0; offset < 50_000; offset += 500) {
        const page = await deps.invoices.creditBook(tenantId, { filter: "all", limit: 500, offset });
        for (const c of page.items) if (c.balance !== 0) out.push({ id: c.customer.id, name: c.customer.name, balance: c.balance });
        if (offset + 500 >= page.total) break;
      }
      return out;
    },
    async supplierBalances(tenantId) {
      const report = await deps.inventory.purchasing.payablesAgeing(tenantId, {});
      return report.rows.filter((r) => r.total !== 0).map((r) => ({ id: r.supplierId, name: r.name, balance: r.total }));
    },
    async salesGst(tenantId, from, to) {
      const t = (await deps.invoices.gstSummary(tenantId, { from, to })).totals;
      return { taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst };
    },
    async purchaseItc(tenantId, from, to) {
      if (!(await deps.isEnabled(tenantId, "inventory.purchases"))) return { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      const itc = (await deps.inventory.purchaseReport(tenantId, { from, to })).itc;
      return { taxable: itc.taxable, cgst: itc.cgst, sgst: itc.sgst, igst: itc.igst };
    },
  };
}
