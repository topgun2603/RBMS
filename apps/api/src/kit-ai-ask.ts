import { askModule, type AiService, type AskPorts, type GstFigures } from "@rbms/ai";
import type { SrModule } from "@rbms/core";
import { sql, type Db } from "@rbms/db";
import type { EInvoiceService } from "@rbms/einvoice";
import type { ExpensesService } from "@rbms/expenses";
import { todayIST } from "@rbms/gst";
import type { InventoryService } from "@rbms/inventory";
import type { InvoicesService } from "@rbms/invoices";
import type { MedicinesService } from "@rbms/medicines";
import type { BranchesService } from "@rbms/branches";

export interface AskKitDeps {
  db: Db;
  ai: AiService;
  invoices: Pick<InvoicesService, "salesRegister" | "paymentsReport" | "topItems" | "topCustomers" | "ageing" | "creditBook" | "gstSummary" | "salesByBranch">;
  inventory: Pick<InventoryService, "stockReport" | "purchaseReport" | "purchasing" | "batches">;
  expenses: Pick<ExpensesService, "summary" | "profit">;
  medicines: Pick<MedicinesService, "expirySummary" | "listBatches">;
  branches: () => Pick<BranchesService, "list"> | null;
  einvoice: () => Pick<EInvoiceService, "gstr1"> | null;
  isEnabled: (tenantId: string, key: string) => Promise<boolean>;
  now?: () => Date;
}

const BILLED = ["issued", "partially_paid", "paid"];
const num = (v: unknown) => Number(v ?? 0) || 0;

/**
 * The ports "Ask your shop" reads through (docs/ai.md, Phase 2): the same service and report functions the Reports pages
 * call, for ONE tenant, read-only. A port answers `null` when the shop does not have the module switched on. The only SQL
 * is two small, fixed, parameterised read queries (staff-wise sales, last sale per item); the model never writes SQL.
 */
export function createAskPorts(d: AskKitDeps): AskPorts {
  const now = d.now ?? (() => new Date());
  const gate = async (tenantId: string, ...keys: string[]) => {
    for (const k of keys) if (!(await d.isEnabled(tenantId, k).catch(() => false))) return false;
    return true;
  };
  const REPORTS = "invoices.reports";

  return {
    today: () => todayIST(now()),

    async sales(tenantId, range) {
      if (!(await gate(tenantId, REPORTS))) return null;
      const r = await d.invoices.salesRegister(tenantId, range);
      const byDay = new Map<string, { bills: number; total: number }>();
      for (const row of r.items) {
        const b = byDay.get(row.date) ?? { bills: 0, total: 0 };
        if (row.type === "invoice") b.bills += 1;
        b.total += row.total;
        byDay.set(row.date, b);
      }
      return {
        bills: r.totals.count,
        creditNotes: r.totals.creditNotes,
        taxable: r.totals.taxable,
        tax: r.totals.cgst + r.totals.sgst + r.totals.igst,
        total: r.totals.total,
        paid: r.totals.paid,
        byDay: [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, v]) => ({ date, ...v })),
      };
    },

    async payments(tenantId, range) {
      if (!(await gate(tenantId, REPORTS))) return null;
      const r = await d.invoices.paymentsReport(tenantId, range);
      return { byMethod: r.byMethod.map((m) => ({ method: m.method, amount: m.amount, count: m.count })) };
    },

    async topItems(tenantId, range, limit) {
      if (!(await gate(tenantId, REPORTS))) return null;
      const r = await d.invoices.topItems(tenantId, { ...range, limit });
      return r.items.map((i) => ({ name: i.description, qty: i.qty, unit: i.unit, taxable: i.taxable }));
    },

    async topCustomers(tenantId, range, limit) {
      if (!(await gate(tenantId, REPORTS))) return null;
      const r = await d.invoices.topCustomers(tenantId, { ...range, limit });
      return r.items.map((c) => ({ name: c.name, bills: c.invoices, total: c.total }));
    },

    async ageing(tenantId, q) {
      if (!(await gate(tenantId, REPORTS))) return null;
      const r = await d.invoices.ageing(tenantId, q.asOf ? { asOf: q.asOf } : {});
      return {
        asOf: r.asOf,
        buckets: r.buckets.map((b) => ({ key: b.key, amount: b.amount, count: b.count })),
        customers: r.customers.slice(0, q.limit).map((c) => ({ name: c.name, current: c.current, d1_30: c.d1_30, d31_60: c.d31_60, d61_90: c.d61_90, d90_plus: c.d90_plus, total: c.total })),
        totalCustomers: r.customers.length,
      };
    },

    async creditBook(tenantId, q) {
      if (!(await gate(tenantId, "invoices.credit-book"))) return null;
      const r = await d.invoices.creditBook(tenantId, { filter: "due", limit: q.limit, offset: 0 });
      return {
        totals: { receivable: r.totals.receivable, customersWithDues: r.totals.customersWithDues },
        items: r.items.map((c) => ({ name: c.customer.name, phone: c.customer.phone, balance: c.balance, overdue: c.overdue, oldestDue: c.oldestDue })),
      };
    },

    async stock(tenantId, q) {
      if (!(await gate(tenantId, "inventory"))) return null;
      const r = await d.inventory.stockReport(tenantId);
      const hit = r.items.filter((i) => i.track && i.status === q.status).sort((a, b) => a.qty - b.qty || a.name.localeCompare(b.name));
      return {
        totals: { items: r.items.length, stockValue: r.totals.stockValue, lowCount: r.totals.lowCount, outCount: r.totals.outCount },
        items: hit.slice(0, q.limit).map((i) => ({ name: i.name, qty: i.qty, unit: i.unit, reorderLevel: i.reorderLevel, value: i.value })),
      };
    },

    async slowStock(tenantId, q) {
      if (!(await gate(tenantId, "inventory", REPORTS))) return null;
      const today = todayIST(now());
      const stock = await d.inventory.stockReport(tenantId);
      const onShelf = stock.items.filter((i) => i.track && i.qty > 0);
      const windowStart = new Date(Date.parse(`${today}T00:00:00Z`) - (q.days - 1) * 86_400_000).toISOString().slice(0, 10);
      const yearStart = new Date(Date.parse(`${today}T00:00:00Z`) - 364 * 86_400_000).toISOString().slice(0, 10);
      const rows = (await d.db.execute(sql`
        select l->>'itemId' as item_id,
               coalesce(sum((l->>'qty')::numeric) filter (where i.date >= ${windowStart}), 0) as sold,
               max(i.date) as last_sold
          from invoices i, jsonb_array_elements(i.lines) as l
         where i.tenant_id = ${tenantId}
           and i.status in ('issued', 'partially_paid', 'paid')
           and i.date >= ${yearStart} and i.date <= ${today}
           and l->>'itemId' is not null
         group by 1`)) as unknown as { item_id: string; sold: string; last_sold: string }[];
      const sold = new Map([...rows].map((r) => [r.item_id, { qty: num(r.sold), last: r.last_sold ?? null }]));
      const list = onShelf
        .map((i) => ({ name: i.name, qty: i.qty, unit: i.unit, value: i.value, soldQty: sold.get(i.itemId)?.qty ?? 0, lastSold: sold.get(i.itemId)?.last ?? null }))
        .filter((i) => (q.onlyUnsold ? i.soldQty === 0 : true))
        .sort((a, b) => a.soldQty - b.soldQty || b.value - a.value);
      return { asOf: today, totalOnShelf: onShelf.length, items: list.slice(0, q.limit) };
    },

    async expiry(tenantId, q) {
      if (await gate(tenantId, "medicines")) {
        const [summary, batches] = await Promise.all([
          d.medicines.expirySummary(tenantId, q.withinDays),
          d.medicines.listBatches(tenantId, { status: ["expired", "expiring"], within: q.withinDays, sort: "expiry", limit: q.limit, offset: 0 } as never),
        ]);
        return {
          source: "pharmacy" as const,
          expired: summary.expired,
          expiring: summary.expiring,
          items: batches.items.map((b) => ({ item: b.itemName, batchNo: b.batchNo, expiry: b.expiry, daysLeft: b.daysLeft, qty: Number(b.qty) })),
        };
      }
      if (await gate(tenantId, "inventory")) {
        const [summary, alerts] = await Promise.all([d.inventory.batches.expirySummary(tenantId), d.inventory.batches.alerts(tenantId, q.withinDays)]);
        const within = alerts.filter((a) => a.daysLeft <= q.withinDays);
        const sum = (rows: typeof within) => ({ batches: rows.length, qty: rows.reduce((n, r) => n + r.qty, 0) });
        return {
          source: "stock" as const,
          expired: { ...sum(within.filter((a) => a.daysLeft < 0)), value: summary.expired.value },
          expiring: { ...sum(within.filter((a) => a.daysLeft >= 0)), value: summary.expiring.value },
          items: within.slice(0, q.limit).map((a) => ({ item: a.itemName, batchNo: a.batchNo, expiry: a.expiry, daysLeft: a.daysLeft, qty: a.qty })),
        };
      }
      return null;
    },

    async purchases(tenantId, range) {
      if (!(await gate(tenantId, "inventory.purchases"))) return null;
      const r = await d.inventory.purchaseReport(tenantId, { from: range.from, to: range.to });
      const by = new Map<string, { bills: number; total: number }>();
      for (const p of r.rows) {
        const b = by.get(p.supplierName) ?? { bills: 0, total: 0 };
        b.bills += 1;
        b.total += p.total;
        by.set(p.supplierName, b);
      }
      return {
        bills: r.rows.length,
        taxable: r.rows.reduce((n, p) => n + p.taxable, 0),
        itc: r.itc.total,
        total: r.rows.reduce((n, p) => n + p.total, 0),
        bySupplier: [...by.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total),
      };
    },

    async payables(tenantId, q) {
      if (!(await gate(tenantId, "inventory.purchases"))) return null;
      const [sum, ageing] = await Promise.all([d.inventory.purchasing.payablesSummary(tenantId), d.inventory.purchasing.payablesAgeing(tenantId)]);
      return {
        asOf: sum.asOf,
        payable: sum.payable,
        overdue: sum.overdue,
        dueSoon: sum.dueSoon,
        suppliers: ageing.rows
          .filter((r) => r.total > 0)
          .sort((a, b) => b.total - a.total)
          .slice(0, q.limit)
          .map((r) => ({ name: r.name, total: r.total, overdue: r.overdue })),
      };
    },

    async expenses(tenantId, range) {
      if (!(await gate(tenantId, "expenses"))) return null;
      const r = await d.expenses.summary(tenantId, { from: range.from, to: range.to });
      return { total: r.total, gst: r.gst, count: r.count, byCategory: r.byCategory.map((c) => ({ name: c.name, total: c.total, count: c.count })) };
    },

    async profit(tenantId, range) {
      if (!(await gate(tenantId, "expenses"))) return null;
      const r = await d.expenses.profit(tenantId, { from: range.from, to: range.to });
      return {
        salesTaxable: r.sales.taxable,
        purchasesTaxable: r.purchases.taxable,
        expensesTotal: r.expenses.total,
        expensesItc: r.expenses.itc,
        grossProfit: r.grossProfit,
        netProfit: r.netProfit,
        gstOutput: r.gst.output,
        gstItc: r.gst.itc,
        gstPayable: r.gst.payable,
      };
    },

    async gst(tenantId, range): Promise<GstFigures | null> {
      if (!(await gate(tenantId, "invoices.gst-reports"))) return null;
      const r = await d.invoices.gstSummary(tenantId, range);
      return {
        invoices: r.totals.invoices,
        creditNotes: r.totals.creditNotes,
        taxable: r.totals.taxable,
        cgst: r.totals.cgst,
        sgst: r.totals.sgst,
        igst: r.totals.igst,
        total: r.totals.total,
        byRate: r.byRate.map((x) => ({ rate: Number(x.gstRate), taxable: x.taxable, cgst: x.cgst, sgst: x.sgst, igst: x.igst })),
        sections: { b2b: r.b2b.reduce((n, x) => n + x.invoices, 0), b2cl: r.b2cl.length, b2cs: r.b2cs.length, cdnr: r.cdnr.length, cdnur: r.cdnur.length },
        nilRated: r.gstr3b.nilRated,
      };
    },

    async gstr1Check(tenantId, period) {
      if (!(await gate(tenantId, "invoices.gst-reports"))) return null;
      const svc = d.einvoice();
      if (!svc) return null;
      const r = await svc.gstr1(tenantId, period);
      return { counts: { ...r.counts }, warnings: r.warnings };
    },

    async salesByStaff(tenantId, range) {
      if (!(await gate(tenantId, REPORTS))) return null;
      const rows = (await d.db.execute(sql`
        select u.name as name, count(*)::int as bills, coalesce(sum(i.total), 0) as total
          from invoices i left join users u on u.id = i.created_by
         where i.tenant_id = ${tenantId}
           and i.status in ('issued', 'partially_paid', 'paid')
           and i.date >= ${range.from} and i.date <= ${range.to}
         group by u.name
         order by 3 desc`)) as unknown as { name: string | null; bills: number; total: string }[];
      return [...rows].map((r) => ({ name: r.name?.trim() || "Not recorded", bills: Number(r.bills), total: num(r.total) }));
    },

    async salesByBranch(tenantId, range) {
      if (!(await gate(tenantId, REPORTS, "multi-branch"))) return null;
      const branches = d.branches();
      if (!branches) return null;
      const [sales, list] = await Promise.all([d.invoices.salesByBranch(tenantId, range), branches.list(tenantId, { includeInactive: true } as never)]);
      const name = new Map(list.items.map((b) => [b.id, b.name]));
      return sales.map((s) => ({ name: s.branchId ? (name.get(s.branchId) ?? "Branch") : "No branch", bills: s.bills, total: s.sales }));
    },
  };
}

/** Mounts `POST /v1/ai/ask` and `POST /v1/ai/ask/gst` (docs/ai.md, Phase 2 part A). */
export function createAiAsk(d: AskKitDeps): { module: SrModule; ports: AskPorts } {
  const ports = createAskPorts(d);
  return { module: askModule({ ai: d.ai, ports }), ports };
}
