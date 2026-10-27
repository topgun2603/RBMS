/**
 * Stock valuation and profit reports (docs/valuation-reports.md), everything that needs more than one module:
 *  - routes under /v1/valuation: valuation method, stock valuation as of a date, landed-cost vouchers, item-wise profit,
 *    packaged sales reports (staff, hour / weekday heatmap, category, brand, payment mode, branch) and the branch view,
 *    each with `format=csv`; PDFs through the documents module (`sales-analysis`, `profit-report`);
 *  - the item-wise profit dataset of the report builder;
 *  - item weights for the catalogue port (landed charges by weight) and the credit-note -> bill map for the layer build.
 * Cost of goods sold comes from the cost recorded on each sale / return movement (both methods are kept; the shop's
 * method on the bill date picks one), so profit never drifts when later purchases move the average.
 */
import { requirePermission, requireRole, requireTenant, type RequestContext, type SrModule, defineModule } from "@srirealtime/core";
import { REPORT_CSS, reportBodyHtml, tableToCsv, type ReportTable } from "@srirealtime/accounting";
import { sql, type Db, type SQL } from "@srirealtime/db";
import { page, type DocumentRegistry } from "@srirealtime/documents";
import { todayIST } from "@srirealtime/gst";
import { CHARGE_KINDS, type InventoryService, type ItemCatalogPort } from "@srirealtime/inventory";
import { datasetFromSql, type ReportsService } from "@srirealtime/reports";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

const rows = <R>(r: unknown): R[] => ((r as { rows?: R[] }).rows ?? (r as R[]));
const n = (v: unknown) => Number(v ?? 0);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** The catalogue item port with each variant's weight (grams per unit) added, for landed charges spread by weight. */
export function withItemWeights(port: ItemCatalogPort, db: Db): ItemCatalogPort {
  return {
    ...port,
    async getItems(tenantId, ids) {
      const items = await port.getItems(tenantId, ids);
      if (items.length === 0) return items;
      const w = rows<{ id: string; w: number | null }>(
        await db.execute(sql`select id, weight_grams as w from catalog_variants where tenant_id = ${tenantId} and id in (${sql.join(items.map((i) => sql`${i.id}::uuid`), sql`, `)})`),
      );
      const by = new Map(w.map((r) => [r.id, r.w]));
      return items.map((i) => ({ ...i, weightGrams: by.get(i.id) ?? null }));
    },
  };
}

/** Credit note id -> bill id (returned goods come back at the cost of their sale when the layers are built from history). */
export const returnSales = (db: Db) => async (tenantId: string) =>
  new Map(rows<{ id: string; invoice_id: string }>(await db.execute(sql`select id::text, invoice_id::text from credit_notes where tenant_id = ${tenantId}`)).map((r) => [r.id, r.invoice_id]));

// ------------------------------------------------------------------ profit lines (SQL)

/**
 * A document line's quantity in the item's base (stock) unit, in SQL: `qty x unitFactor` to 3 decimals, like
 * `baseQtyOf` (@srirealtime/gst, docs/price-lists-units.md); lines without an alternate unit keep their qty. So boxes
 * and pieces of one item add up, and match the stock movements (always in the base unit).
 */
export const baseQtySql = (line: SQL): SQL =>
  sql`(CASE WHEN coalesce(nullif(${line}->>'unitFactor', '')::numeric, 0) > 0 AND (${line}->>'unitFactor')::numeric <> 1
    THEN round((${line}->>'qty')::numeric * (${line}->>'unitFactor')::numeric, 3) ELSE (${line}->>'qty')::numeric END)`;


/**
 * One row per bill line and per credit-note line (negative), with its cost of goods sold: the cost recorded on the
 * bill's sale movements (or the credit note's restock movements) of that item, shared by quantity between lines of the
 * same item, at the method in force on the document date. Items without a stock movement (untracked, services, bills
 * whose goods left on a delivery challan) use the item's cost; credit-note lines that put nothing back cost nothing.
 * Imported bills and cancelled bills are left out (like the books). `inner` filters the documents (tenant, dates).
 */
export function profitLinesSql(inner: { invoices: SQL; creditNotes: SQL }): SQL {
  return sql`(
    SELECT d.*,
      coalesce(cat.name, '') AS category,
      coalesce(p.brand, '') AS brand,
      coalesce(ts.opened_by_name, '') AS staff,
      coalesce(b.name, '') AS branch,
      CASE WHEN v.id IS NULL THEN NULL WHEN v.title = '' THEN p.name ELSE p.name || ' – ' || v.title END AS item_name,
      d.sign * d.taxable AS sales,
      d.sign * CASE
        WHEN coalesce(mv.q, 0) > 0 THEN round(coalesce(CASE WHEN d.method = 'fifo' THEN mv.f ELSE mv.a END, 0) * d.base_qty / nullif(d.item_qty, 0))
        WHEN d.item_id IS NOT NULL AND (d.kind = 'invoice' OR (d.line->>'restock')::boolean IS TRUE) AND v.cost IS NOT NULL THEN round(v.cost * d.base_qty)
        ELSE 0 END::bigint AS cogs,
      CASE WHEN coalesce(mv.q, 0) > 0 THEN 'stock' WHEN d.item_id IS NOT NULL AND v.cost IS NOT NULL AND (d.kind = 'invoice' OR (d.line->>'restock')::boolean IS TRUE) THEN 'item' WHEN d.kind = 'credit_note' THEN 'none' ELSE 'missing' END AS cost_source
    FROM (
      SELECT x.*, sum(x.base_qty) OVER (PARTITION BY x.tenant_id, x.kind, x.ref_id, x.date, x.item_id) AS item_qty,
        coalesce((SELECT h->>'method' FROM stock_valuation_settings s CROSS JOIN jsonb_array_elements(s.history) h
                  WHERE s.tenant_id = x.tenant_id AND (h->>'from') <= x.date::text ORDER BY h->>'from' DESC LIMIT 1), 'average') AS method
      FROM (
        SELECT i.tenant_id, 'invoice' AS kind, i.id::text AS ref_id, i.number, i.date, i.branch_id, i.till_session_id, i.issued_at AS at,
          l.line, nullif(l.line->>'itemId', '')::uuid AS item_id, l.line->>'description' AS description,
          ${baseQtySql(sql`l.line`)} AS base_qty,
          (l.line->>'taxable')::bigint AS taxable, 1 AS sign
        FROM invoices i CROSS JOIN LATERAL jsonb_array_elements(i.lines) AS l(line)
        WHERE i.status NOT IN ('draft', 'cancelled') AND NOT i.imported AND ${inner.invoices}
        UNION ALL
        SELECT cn.tenant_id, 'credit_note', cn.id::text, cn.number, cn.date, cn.branch_id, cn.till_session_id, cn.issued_at,
          l.line, nullif(l.line->>'itemId', '')::uuid, l.line->>'description',
          ${baseQtySql(sql`l.line`)},
          (l.line->>'taxable')::bigint, -1
        FROM credit_notes cn JOIN invoices ci ON ci.id = cn.invoice_id AND ci.tenant_id = cn.tenant_id
          CROSS JOIN LATERAL jsonb_array_elements(cn.lines) AS l(line)
        WHERE cn.status = 'issued' AND ci.status <> 'cancelled' AND NOT ci.imported AND ${inner.creditNotes}
      ) x
    ) d
    LEFT JOIN LATERAL (
      SELECT sum(abs(m.delta)) AS q, sum(abs(m.cost_avg)) AS a, sum(abs(m.cost_fifo)) AS f FROM stock_movements m
      WHERE m.tenant_id = d.tenant_id AND m.ref_type = d.kind AND m.ref_id = d.ref_id AND m.item_id = d.item_id AND m.reason IN ('sale', 'sale_return')
    ) mv ON d.item_id IS NOT NULL
    LEFT JOIN catalog_variants v ON v.id = d.item_id AND v.tenant_id = d.tenant_id
    LEFT JOIN catalog_products p ON p.id = v.product_id AND p.tenant_id = d.tenant_id
    LEFT JOIN catalog_categories cat ON cat.id = p.category_id AND cat.tenant_id = d.tenant_id
    LEFT JOIN till_sessions ts ON ts.id = d.till_session_id AND ts.tenant_id = d.tenant_id
    LEFT JOIN branches b ON b.id = d.branch_id AND b.tenant_id = d.tenant_id
  ) pl`;
}

interface ProfitLine {
  kind: "invoice" | "credit_note";
  ref_id: string;
  date: string;
  at: Date | string | null;
  item_id: string | null;
  description: string;
  base_qty: string;
  sales: string;
  cogs: string;
  cost_source: "stock" | "item" | "none" | "missing";
  category: string;
  brand: string;
  staff: string;
  branch: string;
  branch_id: string | null;
}

export const PROFIT_GROUPS = ["item", "category", "brand", "staff", "branch", "month"] as const;
export type ProfitGroup = (typeof PROFIT_GROUPS)[number];
export const SALES_VIEWS = ["staff", "hour", "weekday", "heatmap", "category", "brand", "payment", "branch"] as const;
export type SalesView = (typeof SALES_VIEWS)[number];

const rangeQuery = z
  .object({ from: dateStr, to: dateStr, branchId: z.string().uuid().optional(), format: z.enum(["json", "csv"]).default("json") })
  .refine((v) => v.from <= v.to, { message: "`from` must be on or before `to`", path: ["from"] });
const profitQuery = z.object({ groupBy: z.enum(PROFIT_GROUPS).default("item"), lowMargin: z.coerce.number().min(-100).max(100).default(10) });

export interface ProfitRow {
  key: string;
  label: string;
  qty: number;
  sales: number;
  returns: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  /** Gross profit / net sales x 100, one decimal; null when nothing was sold. */
  margin: number | null;
  flag: "negative" | "low" | "no_cost" | null;
}

export interface ProfitReport {
  from: string;
  to: string;
  groupBy: ProfitGroup;
  rows: ProfitRow[];
  totals: Omit<ProfitRow, "key" | "label" | "flag">;
  /** Sales lines whose cost came from the item's cost (no stock movement), and lines with no cost at all. */
  itemCostLines: number;
  noCostLines: number;
  /** Landed costs added later on goods already sold (inside cogs). */
  landedOnSold: number;
  lowMargin: number;
}

const marginOf = (gp: number, net: number) => (net !== 0 ? Math.round((gp / net) * 1000) / 10 : null);

/** A sales line as `profitLinesSql` gives it (numbers as text from Postgres). */
export type ProfitLineRow = Pick<ProfitLine, "kind" | "item_id" | "description" | "base_qty" | "sales" | "cogs" | "cost_source" | "category" | "brand" | "staff" | "branch" | "date">;

/**
 * Expenses of the branch report by column (docs/expenses-debit-notes.md): each branch's own, and those without a branch
 * — or of a branch that no longer exists — in the shop-wide column (key null). `v` is paise net of input credit.
 */
export function expensesByBranch(rows: readonly { branch_id: string | null; v: string | number }[], branchIds: readonly string[]): Map<string | null, number> {
  const known = new Set(branchIds);
  const out = new Map<string | null, number>();
  for (const r of rows) {
    const key = r.branch_id && known.has(r.branch_id) ? r.branch_id : null;
    out.set(key, (out.get(key) ?? 0) + Number(r.v ?? 0));
  }
  return out;
}

/**
 * Groups profit lines. Quantities are in the base unit (`base_qty`), so a box line and a piece line of the same item
 * are one row, labelled with the item's name. `landed`: later landed costs on goods already sold (cost only).
 */
export function aggregateProfit(
  lines: readonly ProfitLineRow[],
  landed: readonly { itemId: string; date: string; value: number; name: string; category: string; brand: string }[],
  groupBy: ProfitGroup,
  low: number,
): Omit<ProfitReport, "from" | "to" | "groupBy" | "lowMargin"> {
  const keyOf = (l: Pick<ProfitLine, "item_id" | "description" | "category" | "brand" | "staff" | "branch" | "date">): [string, string] => {
    switch (groupBy) {
      case "item":
        return [l.item_id ?? `text:${l.description.toLowerCase()}`, l.description];
      case "category":
        return [l.category, l.category];
      case "brand":
        return [l.brand, l.brand];
      case "staff":
        return [l.staff, l.staff];
      case "branch":
        return [l.branch, l.branch];
      case "month":
        return [l.date.slice(0, 7), l.date.slice(0, 7)];
    }
  };
  const groups = new Map<string, ProfitRow & { noCost: number }>();
  let itemCostLines = 0;
  let noCostLines = 0;
  const add = (key: string, label: string, f: { qty: number; sales: number; returns: number; cogs: number; noCost: number }) => {
    const g = groups.get(key) ?? { key, label, qty: 0, sales: 0, returns: 0, netSales: 0, cogs: 0, grossProfit: 0, margin: null, flag: null, noCost: 0 };
    g.qty = Math.round((g.qty + f.qty) * 1000) / 1000;
    g.sales += f.sales;
    g.returns += f.returns;
    g.cogs += f.cogs;
    g.noCost += f.noCost;
    groups.set(key, g);
  };
  for (const l of lines) {
    const sales = n(l.sales);
    const qty = n(l.base_qty) * (l.kind === "invoice" ? 1 : -1);
    if (l.cost_source === "item") itemCostLines++;
    const missing = l.cost_source === "missing" && l.kind === "invoice" && sales !== 0;
    if (missing) noCostLines++;
    const [k, label] = keyOf(l);
    add(k, label, { qty, sales: l.kind === "invoice" ? sales : 0, returns: l.kind === "invoice" ? 0 : -sales, cogs: n(l.cogs), noCost: missing ? 1 : 0 });
  }
  let landedOnSold = 0;
  for (const x of landed) {
    const [k, label] = keyOf({ item_id: x.itemId, description: x.name, category: x.category, brand: x.brand, staff: "", branch: "", date: x.date });
    add(k, label, { qty: 0, sales: 0, returns: 0, cogs: x.value, noCost: 0 });
    landedOnSold += x.value;
  }
  const out: ProfitRow[] = [...groups.values()].map(({ noCost, ...g }) => {
    const netSales = g.sales - g.returns;
    const grossProfit = netSales - g.cogs;
    const margin = marginOf(grossProfit, netSales);
    const flag: ProfitRow["flag"] = grossProfit < 0 ? "negative" : noCost > 0 && g.cogs === 0 ? "no_cost" : margin !== null && margin < low ? "low" : null;
    return { ...g, netSales, grossProfit, margin, flag };
  });
  out.sort((a, b) => b.netSales - a.netSales || a.label.localeCompare(b.label));
  const t = out.reduce((s, r) => ({ qty: s.qty + r.qty, sales: s.sales + r.sales, returns: s.returns + r.returns, netSales: s.netSales + r.netSales, cogs: s.cogs + r.cogs, grossProfit: s.grossProfit + r.grossProfit }), { qty: 0, sales: 0, returns: 0, netSales: 0, cogs: 0, grossProfit: 0 });
  return { rows: out, totals: { ...t, qty: Math.round(t.qty * 1000) / 1000, margin: marginOf(t.grossProfit, t.netSales) }, itemCostLines, noCostLines, landedOnSold };
}

export interface BranchColumn {
  id: string | null;
  name: string;
  sales: number;
  returns: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  purchases: number;
  expenses: number;
  stockValue: number;
}
export interface BranchView {
  from: string;
  to: string;
  branches: BranchColumn[];
  total: Omit<BranchColumn, "id" | "name">;
  method: string;
}

export interface ValuationWiringDeps {
  db: Db;
  inventory: () => InventoryService;
  documents: { registry: DocumentRegistry };
  reports: ReportsService;
  isEnabled: (tenantId: string, key: string) => Promise<boolean>;
  /** The books' period lock (accounting), null when unlocked or the books are off. */
  lockedThrough: (tenantId: string) => Promise<string | null>;
}

export function wireValuation(d: ValuationWiringDeps) {
  const { db } = d;

  async function profitLines(tenantId: string, from: string, to: string, branchId?: string): Promise<ProfitLine[]> {
    const br = (col: SQL) => (branchId ? sql` AND ${col} = ${branchId}::uuid` : sql``);
    const q = sql`SELECT pl.kind, pl.ref_id, pl.date::text AS date, pl.at, pl.item_id::text AS item_id, coalesce(pl.item_name, pl.description, '') AS description, pl.base_qty, pl.sales, pl.cogs, pl.cost_source, pl.category, pl.brand, pl.staff, pl.branch, pl.branch_id::text AS branch_id FROM ${profitLinesSql({
      invoices: sql`i.tenant_id = ${tenantId} AND i.date BETWEEN ${from} AND ${to}${br(sql`i.branch_id`)}`,
      creditNotes: sql`cn.tenant_id = ${tenantId} AND cn.date BETWEEN ${from} AND ${to}${br(sql`cn.branch_id`)}`,
    })}`;
    return rows<ProfitLine>(await db.execute(q));
  }

  /** Item-wise (or category, brand, staff, branch, month) profit with returns netted and the later landed costs on goods sold. */
  async function profit(tenantId: string, q: { from: string; to: string; groupBy?: ProfitGroup; branchId?: string; lowMargin?: number }): Promise<ProfitReport> {
    const groupBy = q.groupBy ?? "item";
    const low = q.lowMargin ?? 10;
    await d.inventory().costing.ensureBuilt(tenantId);
    const lines = await profitLines(tenantId, q.from, q.to, q.branchId);
    // A cost added after the purchase (later freight bill) on goods already sold is cost of goods sold on its date.
    const landed = q.branchId ? [] : await d.inventory().costing.soldLanded(tenantId, q.from, q.to);
    const meta = new Map<string, { name: string; category: string; brand: string }>();
    if (landed.length) {
      for (const r of rows<{ id: string; name: string; category: string; brand: string }>(
        await db.execute(
          sql`SELECT v.id::text AS id, CASE WHEN v.title = '' THEN p.name ELSE p.name || ' – ' || v.title END AS name, coalesce(c.name, '') AS category, coalesce(p.brand, '') AS brand
              FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id AND p.tenant_id = v.tenant_id LEFT JOIN catalog_categories c ON c.id = p.category_id AND c.tenant_id = v.tenant_id
              WHERE v.tenant_id = ${tenantId} AND v.id IN (${sql.join([...new Set(landed.map((x) => x.itemId))].map((id) => sql`${id}::uuid`), sql`, `)})`,
        ),
      ))
        meta.set(r.id, r);
    }
    const agg = aggregateProfit(
      lines,
      landed.map((x) => ({ ...x, ...(meta.get(x.itemId) ?? { name: "", category: "", brand: "" }) })),
      groupBy,
      low,
    );
    return { from: q.from, to: q.to, groupBy, ...agg, lowMargin: low };
  }

  // ---------------------------------------------------------------- packaged sales reports

  interface SalesRow {
    key: string;
    label: string;
    bills: number;
    sales: number;
    returns: number;
    netSales: number;
    gst: number;
    /** Money in (payment mode view): amount received less refunds. */
    amount?: number;
  }
  interface SalesReport {
    from: string;
    to: string;
    view: SalesView;
    rows: SalesRow[];
    totals: Omit<SalesRow, "key" | "label">;
    /** heatmap: weekday (0 = Sunday) x hour cells. */
    cells?: { weekday: number; hour: number; bills: number; netSales: number }[];
  }

  async function salesAnalysis(tenantId: string, q: { from: string; to: string; view: SalesView; branchId?: string }): Promise<SalesReport> {
    const { from, to, view } = q;
    const br = (col: SQL) => (q.branchId ? sql` AND ${col} = ${q.branchId}::uuid` : sql``);
    let list: SalesRow[] = [];
    let cells: SalesReport["cells"];
    if (view === "payment") {
      const r = rows<{ method: string; n: number; amount: string }>(
        await db.execute(sql`SELECT p.method, count(*)::int AS n, sum(p.amount) AS amount FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id AND i.tenant_id = p.tenant_id
          WHERE p.tenant_id = ${tenantId} AND p.date BETWEEN ${from} AND ${to} AND i.status <> 'cancelled'${br(sql`i.branch_id`)} GROUP BY 1`),
      );
      list = r.map((x) => ({ key: x.method, label: x.method, bills: x.n, sales: 0, returns: 0, netSales: 0, gst: 0, amount: n(x.amount) }));
    } else if (view === "category" || view === "brand") {
      const lines = await profitLines(tenantId, from, to, q.branchId);
      const m = new Map<string, SalesRow & { refs: Set<string> }>();
      for (const l of lines) {
        const k = view === "category" ? l.category : l.brand;
        const g = m.get(k) ?? { key: k, label: k, bills: 0, sales: 0, returns: 0, netSales: 0, gst: 0, refs: new Set<string>() };
        const s = n(l.sales);
        if (l.kind === "invoice") {
          g.sales += s;
          g.refs.add(l.ref_id);
        } else g.returns += -s;
        m.set(k, g);
      }
      list = [...m.values()].map(({ refs, ...g }) => ({ ...g, bills: refs.size, netSales: g.sales - g.returns }));
    } else {
      // Bill-level views: one row per bill and credit note (taxable value, GST).
      const dim =
        view === "staff"
          ? sql`coalesce(ts.opened_by_name, '')`
          : view === "branch"
            ? sql`coalesce(b.name, '')`
            : view === "hour"
              ? sql`extract(hour FROM (coalesce(x.at, x.created_at) AT TIME ZONE 'Asia/Kolkata'))::int::text`
              : view === "weekday"
                ? sql`extract(dow FROM x.date)::int::text`
                : sql`(extract(dow FROM x.date)::int * 100 + extract(hour FROM (coalesce(x.at, x.created_at) AT TIME ZONE 'Asia/Kolkata'))::int)::text`;
      const r = rows<{ k: string; bills: number; sales: string; returns: string; gst: string }>(
        await db.execute(sql`SELECT ${dim} AS k,
            count(*) FILTER (WHERE x.sign = 1)::int AS bills,
            coalesce(sum(x.taxable) FILTER (WHERE x.sign = 1), 0) AS sales,
            coalesce(sum(x.taxable) FILTER (WHERE x.sign = -1), 0) AS returns,
            coalesce(sum(x.sign * x.gst), 0) AS gst
          FROM (
            SELECT i.tenant_id, i.date, i.issued_at AS at, i.created_at, i.till_session_id, i.branch_id, (i.totals->>'taxable')::bigint AS taxable,
              (i.totals->>'cgst')::bigint + (i.totals->>'sgst')::bigint + (i.totals->>'igst')::bigint AS gst, 1 AS sign
            FROM invoices i WHERE i.tenant_id = ${tenantId} AND i.status NOT IN ('draft', 'cancelled') AND NOT i.imported AND i.date BETWEEN ${from} AND ${to}${br(sql`i.branch_id`)}
            UNION ALL
            SELECT cn.tenant_id, cn.date, cn.issued_at, cn.created_at, cn.till_session_id, cn.branch_id, (cn.totals->>'taxable')::bigint,
              (cn.totals->>'cgst')::bigint + (cn.totals->>'sgst')::bigint + (cn.totals->>'igst')::bigint, -1
            FROM credit_notes cn JOIN invoices ci ON ci.id = cn.invoice_id AND ci.tenant_id = cn.tenant_id
            WHERE cn.tenant_id = ${tenantId} AND cn.status = 'issued' AND ci.status <> 'cancelled' AND NOT ci.imported AND cn.date BETWEEN ${from} AND ${to}${br(sql`cn.branch_id`)}
          ) x
          LEFT JOIN till_sessions ts ON ts.id = x.till_session_id AND ts.tenant_id = x.tenant_id
          LEFT JOIN branches b ON b.id = x.branch_id AND b.tenant_id = x.tenant_id
          GROUP BY 1`),
      );
      list = r.map((x) => ({ key: x.k, label: x.k, bills: x.bills, sales: n(x.sales), returns: n(x.returns), netSales: n(x.sales) - n(x.returns), gst: n(x.gst) }));
      if (view === "heatmap") {
        cells = list.map((x) => ({ weekday: Math.floor(Number(x.key) / 100), hour: Number(x.key) % 100, bills: x.bills, netSales: x.netSales }));
        // Rows: one per weekday (the CSV / PDF), hours as the cells.
        const byDay = new Map<number, SalesRow>();
        for (const c of cells) {
          const g = byDay.get(c.weekday) ?? { key: String(c.weekday), label: String(c.weekday), bills: 0, sales: 0, returns: 0, netSales: 0, gst: 0 };
          g.bills += c.bills;
          g.netSales += c.netSales;
          byDay.set(c.weekday, g);
        }
        list = list.length ? [...byDay.values()] : [];
      }
    }
    if (view === "hour" || view === "weekday" || view === "heatmap") list.sort((a, b) => Number(a.key) - Number(b.key));
    else list.sort((a, b) => (b.amount ?? b.netSales) - (a.amount ?? a.netSales) || a.label.localeCompare(b.label));
    const totals = list.reduce((t, r) => ({ bills: t.bills + r.bills, sales: t.sales + r.sales, returns: t.returns + r.returns, netSales: t.netSales + r.netSales, gst: t.gst + r.gst, amount: (t.amount ?? 0) + (r.amount ?? 0) }), { bills: 0, sales: 0, returns: 0, netSales: 0, gst: 0, amount: 0 } as Omit<SalesRow, "key" | "label">);
    return { from, to, view, rows: list, totals, ...(cells ? { cells } : {}) };
  }

  // ---------------------------------------------------------------- branch view

  async function branches(tenantId: string, q: { from: string; to: string }): Promise<BranchView> {
    const inv = d.inventory();
    await inv.costing.ensureBuilt(tenantId);
    const list = rows<{ id: string; name: string; location_id: string | null }>(
      await db.execute(sql`SELECT id::text, name, stock_location_id::text AS location_id FROM branches WHERE tenant_id = ${tenantId} ORDER BY is_default DESC, name`),
    );
    const cols = new Map<string, BranchColumn>();
    const col = (id: string | null) => {
      const k = id ?? "";
      let c = cols.get(k);
      if (!c) {
        c = { id, name: id ? (list.find((b) => b.id === id)?.name ?? "") : "", sales: 0, returns: 0, netSales: 0, cogs: 0, grossProfit: 0, purchases: 0, expenses: 0, stockValue: 0 };
        cols.set(k, c);
      }
      return c;
    };
    for (const b of list) col(b.id);
    const branchOfLocation = new Map(list.filter((b) => b.location_id).map((b) => [b.location_id!, b.id]));
    for (const l of await profitLines(tenantId, q.from, q.to)) {
      const c = col(l.branch_id);
      const s = n(l.sales);
      if (l.kind === "invoice") c.sales += s;
      else c.returns += -s;
      c.cogs += n(l.cogs);
    }
    // Later landed costs on goods already sold: by the location the purchase came into.
    for (const x of await inv.costing.soldLanded(tenantId, q.from, q.to)) col(null).cogs += x.value;
    // Purchases: the branch whose stock location received the goods (bills without stock lines stay unassigned).
    const pr = rows<{ location_id: string | null; taxable: string; extra: string }>(
      await db.execute(sql`SELECT (SELECT m.location_id::text FROM stock_movements m WHERE m.tenant_id = p.tenant_id AND m.ref_type IN ('purchase', 'grn') AND m.ref_id IN (p.id::text, p.goods_receipt_id::text) LIMIT 1) AS location_id,
          (p.totals->>'taxable')::bigint AS taxable, p.total - (p.totals->>'total')::bigint AS extra
        FROM purchases p WHERE p.tenant_id = ${tenantId} AND p.status = 'recorded' AND NOT p.imported AND p.date BETWEEN ${q.from} AND ${q.to}`),
    );
    for (const p of pr) col(p.location_id ? (branchOfLocation.get(p.location_id) ?? null) : null).purchases += n(p.taxable) + n(p.extra);
    // Expenses by their branch (net of the GST credit, like the books); those without a branch are shop-wide (the
    // "not by branch" column). An expense of a branch that no longer exists counts shop-wide too.
    const ex = rows<{ branch_id: string | null; v: string }>(
      await db
        .execute(
          sql`SELECT e.branch_id::text AS branch_id, coalesce(sum(e.amount - CASE WHEN coalesce(e.vendor_gstin, '') <> '' THEN e.gst_amount ELSE 0 END), 0) AS v FROM expenses e WHERE e.tenant_id = ${tenantId} AND e.status = 'recorded' AND e.date BETWEEN ${q.from} AND ${q.to} GROUP BY e.branch_id`,
        )
        .catch(() => [] as never),
    );
    for (const [branchId, v] of expensesByBranch(ex, list.map((b) => b.id))) col(branchId).expenses += v;
    const asOf = q.to < todayIST(new Date()) ? q.to : todayIST(new Date());
    const val = await inv.costing.valuation(tenantId, { asOf, groupBy: "location" });
    for (const r of val.rows) col(r.locationId ? (branchOfLocation.get(r.locationId) ?? null) : null).stockValue += r.value;
    const out = [...cols.values()].map((c) => ({ ...c, netSales: c.sales - c.returns, grossProfit: c.sales - c.returns - c.cogs }));
    const shown = out.filter((c) => c.id !== null || c.sales || c.returns || c.cogs || c.purchases || c.expenses || c.stockValue);
    const total = shown.reduce((t, c) => ({ sales: t.sales + c.sales, returns: t.returns + c.returns, netSales: t.netSales + c.netSales, cogs: t.cogs + c.cogs, grossProfit: t.grossProfit + c.grossProfit, purchases: t.purchases + c.purchases, expenses: t.expenses + c.expenses, stockValue: t.stockValue + c.stockValue }), { sales: 0, returns: 0, netSales: 0, cogs: 0, grossProfit: 0, purchases: 0, expenses: 0, stockValue: 0 });
    return { from: q.from, to: q.to, branches: shown, total, method: val.method };
  }

  // ---------------------------------------------------------------- tables (CSV / PDF)

  const money = (key: string, label: string) => ({ key, label, kind: "money" as const, align: "right" as const });
  const text = (key: string, label: string, align?: "right") => ({ key, label, kind: "text" as const, ...(align ? { align } : {}) });
  const subtitle = (from: string, to: string) => `${from} to ${to}`;
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const blank = (s: string, none: string) => (s ? s : none);

  async function table(tenantId: string, report: string, query: Record<string, string | undefined>): Promise<ReportTable | null> {
    if (report === "stock-valuation") {
      const v = await d.inventory().costing.valuation(tenantId, { asOf: query.asOf, groupBy: (query.groupBy as "item") ?? "item", locationId: query.locationId || null });
      return {
        title: "Stock valuation",
        subtitle: `As of ${v.asOf}. Method: ${v.method === "fifo" ? "FIFO" : "weighted average"}`,
        columns: [text("label", v.groupBy === "item" ? "Item" : v.groupBy === "category" ? "Category" : "Location"), ...(v.groupBy === "item" ? [text("location", "Location")] : []), text("qty", "Qty", "right"), money("avgValue", "Weighted average"), money("fifoValue", "FIFO"), money("value", "Value (method in use)")],
        rows: [
          ...v.rows.map((r) => ({ cells: { label: blank(r.label, "Not set"), location: r.location ?? "", qty: r.qty, avgValue: r.avgValue, fifoValue: r.fifoValue, value: r.value } })),
          { style: "total" as const, cells: { label: "Total", location: "", qty: v.totals.qty, avgValue: v.totals.avgValue, fifoValue: v.totals.fifoValue, value: v.totals.value } },
        ],
        notes: ["Weighted average for a past date uses today's average cost on the quantity of that date (like the books)."],
      };
    }
    const r = rangeQuery.safeParse({ from: query.from, to: query.to, branchId: query.branchId || undefined });
    if (!r.success) return null;
    const { from, to } = r.data;
    if (report === "item-profit") {
      const g = profitQuery.parse({ groupBy: query.groupBy, lowMargin: query.lowMargin });
      const p = await profit(tenantId, { from, to, groupBy: g.groupBy, branchId: r.data.branchId, lowMargin: g.lowMargin });
      const head = { item: "Item", category: "Category", brand: "Brand", staff: "Cashier", branch: "Branch", month: "Month" }[g.groupBy];
      return {
        title: `Profit by ${head.toLowerCase()}`,
        subtitle: subtitle(from, to),
        columns: [text("label", head), text("qty", "Qty", "right"), money("sales", "Sales"), money("returns", "Returns"), money("netSales", "Net sales"), money("cogs", "Cost of goods"), money("grossProfit", "Gross profit"), text("margin", "Margin %", "right"), text("flag", "Note")],
        rows: [
          ...p.rows.map((x) => ({ cells: { label: blank(x.label, "Not set"), qty: x.qty, sales: x.sales, returns: x.returns, netSales: x.netSales, cogs: x.cogs, grossProfit: x.grossProfit, margin: x.margin === null ? "" : x.margin.toFixed(1), flag: x.flag === "negative" ? "Loss" : x.flag === "low" ? "Low margin" : x.flag === "no_cost" ? "No cost" : "" } })),
          { style: "total" as const, cells: { label: "Total", qty: p.totals.qty, sales: p.totals.sales, returns: p.totals.returns, netSales: p.totals.netSales, cogs: p.totals.cogs, grossProfit: p.totals.grossProfit, margin: p.totals.margin === null ? "" : p.totals.margin.toFixed(1), flag: "" } },
        ],
        notes: ["Sales are taxable values (before GST). Cost of goods is the cost recorded when the goods left stock, by the shop's valuation method on the bill date; returns put back their cost.", ...(p.landedOnSold ? [`Includes landed costs added later on goods already sold.`] : [])],
      };
    }
    if (report === "branches") {
      const b = await branches(tenantId, { from, to });
      const cols = [...b.branches.map((c, i) => ({ k: `b${i}`, c })), { k: "total", c: { ...b.total, name: "Total", id: "total" } as BranchColumn }];
      const line = (label: string, f: keyof Omit<BranchColumn, "id" | "name">) => ({ cells: Object.fromEntries([["label", label], ...cols.map((x) => [x.k, x.c[f]])]) });
      return {
        title: "By branch (from bills and purchases)",
        subtitle: subtitle(from, to),
        columns: [text("label", ""), ...cols.map((x) => money(x.k, x.c.id === null ? "Shop-wide / not by branch" : x.c.name))],
        rows: [line("Net sales", "netSales"), line("Cost of goods", "cogs"), { ...line("Gross profit", "grossProfit"), style: "total" as const }, line("Purchases", "purchases"), line("Expenses", "expenses"), line("Stock value", "stockValue")],
        notes: ["Not the books: journal entries carry no branch. Expenses are shown under their branch; expenses without a branch are in the shop-wide column."],
      };
    }
    const view = SALES_VIEWS.find((v) => `sales-${v}` === report);
    if (!view) return null;
    const s = await salesAnalysis(tenantId, { from, to, view, branchId: r.data.branchId });
    const label = (k: string) =>
      view === "weekday" || view === "heatmap" ? (WEEKDAYS[Number(k)] ?? k) : view === "hour" ? `${k.padStart(2, "0")}:00` : view === "staff" ? blank(k, "Not recorded") : view === "branch" ? blank(k, "No branch") : blank(k, "Not set");
    const title = { staff: "Sales by cashier", hour: "Sales by hour", weekday: "Sales by day of week", heatmap: "Sales by day and hour", category: "Sales by category", brand: "Sales by brand", payment: "Payments by mode", branch: "Sales by branch" }[view];
    if (view === "payment") {
      return {
        title,
        subtitle: subtitle(from, to),
        columns: [text("label", "Mode"), text("bills", "Payments", "right"), money("amount", "Amount")],
        rows: [...s.rows.map((x) => ({ cells: { label: x.label, bills: x.bills, amount: x.amount ?? 0 } })), { style: "total" as const, cells: { label: "Total", bills: s.totals.bills, amount: s.totals.amount ?? 0 } }],
      };
    }
    if (view === "heatmap") {
      const hours = Array.from({ length: 24 }, (_, h) => h).filter((h) => s.cells?.some((c) => c.hour === h));
      return {
        title,
        subtitle: `${subtitle(from, to)}. Net sales (before GST)`,
        columns: [text("label", "Day"), ...hours.map((h) => money(`h${h}`, `${String(h).padStart(2, "0")}h`)), money("total", "Total")],
        rows: s.rows.map((x) => ({ cells: Object.fromEntries([["label", label(x.key)], ...hours.map((h) => [`h${h}`, s.cells?.find((c) => c.weekday === Number(x.key) && c.hour === h)?.netSales ?? 0]), ["total", x.netSales]]) })),
      };
    }
    return {
      title,
      subtitle: subtitle(from, to),
      columns: [text("label", { staff: "Cashier", hour: "Hour", weekday: "Day", category: "Category", brand: "Brand", branch: "Branch" }[view as "staff"]), text("bills", "Bills", "right"), money("sales", "Sales"), money("returns", "Returns"), money("netSales", "Net sales"), money("gst", "GST")],
      rows: [
        ...s.rows.map((x) => ({ cells: { label: label(x.key), bills: x.bills, sales: x.sales, returns: x.returns, netSales: x.netSales, gst: x.gst } })),
        { style: "total" as const, cells: { label: "Total", bills: s.totals.bills, sales: s.totals.sales, returns: s.totals.returns, netSales: s.totals.netSales, gst: s.totals.gst } },
      ],
      notes: view === "staff" ? ["Cashier = who opened the till the bill was made at; bills made outside a till are 'Not recorded'."] : undefined,
    };
  }

  // ---------------------------------------------------------------- PDFs

  const render = (t: ReportTable, ctx: { locale: never; branding: never }) => page({ title: t.title, paper: "A4", locale: ctx.locale, branding: ctx.branding, css: REPORT_CSS, body: reportBodyHtml(t) });
  const filename = (t: ReportTable) => `${t.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
  // Sales reports: /v1/documents/sales-analysis/sales-<view>.pdf?from=&to=
  d.documents.registry.register<ReportTable>({
    key: "sales-analysis",
    paper: "A4",
    feature: "invoices.reports",
    permission: "reports.view",
    load: (tenantId, id, ctx) => (id.startsWith("sales-") ? table(tenantId, id, ctx.query) : Promise.resolve(null)),
    render: (t, ctx) => render(t, ctx as never),
    filename,
  });
  // Cost and profit (cost prices): /v1/documents/profit-report/<item-profit|branches|stock-valuation>.pdf
  d.documents.registry.register<ReportTable>({
    key: "profit-report",
    paper: "A4",
    feature: "inventory",
    permission: "inventory.purchases",
    load: (tenantId, id, ctx) => (["item-profit", "branches", "stock-valuation"].includes(id) ? table(tenantId, id, ctx.query) : Promise.resolve(null)),
    render: (t, ctx) => render(t, ctx as never),
    filename,
  });

  // ---------------------------------------------------------------- report builder dataset

  d.reports.registerDataset(
    datasetFromSql({
      definition: {
        id: "inventory.item-profit",
        label: "Item profit",
        description: "Every item sold with its cost of goods and gross profit; credit notes (returns) are negative rows.",
        module: "inventory",
        feature: "inventory",
        permission: "inventory.purchases",
        dateColumn: "date",
        defaultSort: { column: "date", dir: "desc" },
        columns: [
          { key: "date", label: "Date", type: "date", groupable: true },
          { key: "number", label: "Bill / credit note", type: "text", default: false },
          { key: "item", label: "Item", type: "text", groupable: true },
          { key: "category", label: "Category", type: "text", groupable: true },
          { key: "brand", label: "Brand", type: "text", groupable: true, default: false },
          { key: "staff", label: "Cashier", type: "text", groupable: true, default: false },
          { key: "branch", label: "Branch", type: "text", groupable: true, default: false },
          { key: "qty", label: "Qty", type: "number", aggregatable: true },
          { key: "sales", label: "Net sales", type: "money", aggregatable: true },
          { key: "cogs", label: "Cost of goods", type: "money", aggregatable: true },
          { key: "grossProfit", label: "Gross profit", type: "money", aggregatable: true },
        ],
      },
      execute: (q) => db.execute(q),
      from: profitLinesSql({ invoices: sql`TRUE`, creditNotes: sql`TRUE` }),
      where: (tenantId) => sql`pl.tenant_id = ${tenantId}`,
      columns: {
        date: sql`pl.date`,
        number: sql`pl.number`,
        item: sql`coalesce(pl.item_name, pl.description, '')`,
        category: sql`pl.category`,
        brand: sql`pl.brand`,
        staff: sql`pl.staff`,
        branch: sql`pl.branch`,
        qty: sql`pl.sign * pl.base_qty`,
        sales: sql`pl.sales`,
        cogs: sql`pl.cogs`,
        grossProfit: sql`pl.sales - pl.cogs`,
      },
    }),
  );

  // ---------------------------------------------------------------- routes

  const csv = (reply: FastifyReply, name: string, t: ReportTable) =>
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}.csv"`).send(tableToCsv(t));
  const guard = (ctx: RequestContext, ...permissions: string[]) => {
    requireRole(ctx, "owner", "admin", "staff");
    const t = requireTenant(ctx).id;
    for (const p of permissions) requirePermission(ctx, p);
    return t;
  };
  const cfg = (feature: string, permission: string | string[]) => ({ config: { feature, permission } });
  const q = (req: { query: unknown }) => (req.query ?? {}) as Record<string, string | undefined>;
  const voucherId = z.object({ id: z.string().uuid() });

  const module = defineModule({
    id: "valuation",
    routes: async (app: FastifyInstance) => {
      // ---- valuation method (owner / admin): weighted average or FIFO, from the start of an unlocked financial year
      app.get("/settings", cfg("inventory", "reports.view"), async (req) => {
        const t = guard(req.ctx, "reports.view");
        return d.inventory().costing.getSettings(t, await d.lockedThrough(t));
      });
      app.put("/settings", { config: { feature: "inventory" } }, async (req) => {
        const user = requireRole(req.ctx, "owner", "admin");
        const t = requireTenant(req.ctx).id;
        const body = (req.body ?? {}) as { method?: string; from?: string };
        req.auditSummary = `valuation method ${String(body.method)} from ${String(body.from)}`;
        return d.inventory().costing.setMethod(t, req.body as never, user.id, await d.lockedThrough(t));
      });

      // ---- stock valuation as of a date
      app.get("/stock", cfg("inventory", "reports.view"), async (req, reply) => {
        const t = guard(req.ctx, "reports.view");
        const query = q(req);
        if (query.format === "csv") return csv(reply, `stock-valuation-${query.asOf ?? todayIST(new Date())}`, (await table(t, "stock-valuation", query))!);
        return d.inventory().costing.valuation(t, { asOf: query.asOf, groupBy: query.groupBy as "item", locationId: query.locationId || null, q: query.q });
      });

      // ---- which items have a weight (the purchase form offers "by weight" only then)
      app.get("/item-weights", cfg("inventory.purchases", "inventory.purchases"), async (req) => {
        const t = guard(req.ctx, "inventory.purchases");
        const ids = (q(req).ids ?? "").split(",").filter((x) => z.string().uuid().safeParse(x).success).slice(0, 200);
        if (!ids.length) return { withWeight: [] };
        const r = rows<{ id: string }>(await db.execute(sql`SELECT id::text FROM catalog_variants WHERE tenant_id = ${t} AND weight_grams > 0 AND id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`));
        return { withWeight: r.map((x) => x.id) };
      });

      // ---- landed-cost vouchers (later freight / clearing bills)
      app.get("/landed-costs", cfg("inventory.purchases", "inventory.purchases"), async (req) => {
        const t = guard(req.ctx, "inventory.purchases");
        const purchaseId = z.string().uuid().optional().parse(q(req).purchaseId || undefined);
        return { items: await d.inventory().costing.listVouchers(t, purchaseId), kinds: CHARGE_KINDS };
      });
      app.post("/landed-costs", cfg("inventory.purchases", "inventory.purchases"), async (req) => {
        const t = guard(req.ctx, "inventory.purchases");
        if ((req.body as { paid?: boolean } | null)?.paid) requirePermission(req.ctx, "inventory.purchases.pay");
        return d.inventory().costing.createVoucher(t, req.body as never, req.ctx.user?.id ?? null);
      });
      app.post("/landed-costs/:id/cancel", cfg("inventory.purchases", "inventory.purchases"), async (req) => {
        const t = guard(req.ctx, "inventory.purchases");
        return d.inventory().costing.cancelVoucher(t, voucherId.parse(req.params).id, req.ctx.user?.id ?? null);
      });

      // ---- item-wise profit (cost prices: needs inventory.purchases too)
      app.get("/item-profit", cfg("inventory", ["reports.view", "inventory.purchases"]), async (req, reply) => {
        const t = guard(req.ctx, "reports.view", "inventory.purchases");
        const r = rangeQuery.parse(q(req));
        const g = profitQuery.parse(q(req));
        if (r.format === "csv") return csv(reply, `profit-by-${g.groupBy}-${r.from}-to-${r.to}`, (await table(t, "item-profit", q(req)))!);
        return profit(t, { from: r.from, to: r.to, groupBy: g.groupBy, branchId: r.branchId, lowMargin: g.lowMargin });
      });

      // ---- packaged sales reports
      app.get("/sales", cfg("invoices.reports", "reports.view"), async (req, reply) => {
        const t = guard(req.ctx, "reports.view");
        const r = rangeQuery.parse(q(req));
        const view = z.enum(SALES_VIEWS).default("staff").parse(q(req).view);
        if (r.format === "csv") return csv(reply, `sales-${view}-${r.from}-to-${r.to}`, (await table(t, `sales-${view}`, q(req)))!);
        return salesAnalysis(t, { from: r.from, to: r.to, view, branchId: r.branchId });
      });

      // ---- consolidated branch view (from bills and purchases, not the books)
      app.get("/branches", cfg("inventory", ["reports.view", "inventory.purchases"]), async (req, reply) => {
        const t = guard(req.ctx, "reports.view", "inventory.purchases");
        const r = rangeQuery.parse(q(req));
        if (r.format === "csv") return csv(reply, `branches-${r.from}-to-${r.to}`, (await table(t, "branches", q(req)))!);
        return branches(t, { from: r.from, to: r.to });
      });
    },
    // Builds the cost layers of shops with stock history in the background (once per shop).
    start: () => {
      setTimeout(() => {
        d.inventory()
          .costing.buildAll()
          .catch(() => undefined);
      }, 5_000).unref?.();
    },
  });

  return { module, profit, branches, sales: salesAnalysis, table };
}
