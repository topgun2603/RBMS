import { z } from "zod";
import { neutralise } from "../assist/safety";
import { maskPhone, maskText } from "../masking";
import type { AiTool } from "../types";
import { FESTIVALS, PERIOD_PRESETS, addDays, checkRange, daysBetween, festivalRange, presetRange, type Festival, type PeriodPreset } from "./periods";
import type { AskPorts, DateRange } from "./ports";

// ------------------------------------------------------------------ evidence (what the tools returned)

export type CellKind = "money" | "int" | "num" | "text" | "date" | "percent";
export interface TableColumn {
  key: string;
  label: string;
  labelTa: string;
  kind: CellKind;
}
/** A table the UI renders straight from tool data: the model never writes these numbers. Money cells are rupees. */
export interface TableBlock {
  id: string;
  title: string;
  titleTa: string;
  columns: TableColumn[];
  rows: Record<string, string | number | null>[];
}
export interface Evidence {
  tool: string;
  args: Record<string, unknown>;
  /** The JSON the model saw (rupees, not paise). */
  data: unknown;
  tables: TableBlock[];
}

export interface AskToolContext {
  tenantId: string;
  ports: AskPorts;
  /** Today's IST date (ports.today() when omitted). */
  today?: string;
  /** Receives each tool's result (for the number check and for the tables under the answer). */
  sink?: Evidence[];
}

/** Rupees from paise, two decimals. */
export const rs = (paise: number) => Math.round(paise) / 100;

const MAX_LIST = 50;
const col = (key: string, label: string, labelTa: string, kind: CellKind): TableColumn => ({ key, label, labelTa, kind });

/** A name from shop data goes to the model as plain text: control characters out, short, and anything that reads like an instruction replaced. */
export function safeName(s: string | null | undefined, max = 60): string {
  const clean = (s ?? "")
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  if (!clean) return "(no name)";
  return neutralise(clean).suspicious ? "[name hidden]" : clean;
}

const limitField = z.coerce.number().int().min(1).max(MAX_LIST);
const dateStrZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const rangeProps = {
  period: {
    type: "string",
    description: `The period, in IST: one of ${PERIOD_PRESETS.join(", ")}; or exact dates as "YYYY-MM-DD..YYYY-MM-DD" (first day..last day, at most 366 days).`,
  },
};
const obj = (properties: Record<string, unknown>, required: string[] = []): AiTool["inputSchema"] => {
  // Strict tools allow few optional parameters in total, so the period (always needed) is a required field.
  const req = "period" in properties && !required.includes("period") ? ["period", ...required] : required;
  return { type: "object", properties, ...(req.length ? { required: req } : {}), additionalProperties: false } as AiTool["inputSchema"];
};

const DATES = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;
/** Resolves `period` (a preset or "from..to"; plain from/to also work) into a checked range. Throws a message the model can act on. */
export function rangeOf(input: Record<string, unknown>, today: string): DateRange {
  const period = typeof input.period === "string" ? input.period.trim() : undefined;
  if (period) {
    if ((PERIOD_PRESETS as readonly string[]).includes(period)) {
      const r = presetRange(period as PeriodPreset, today);
      return { from: r.from, to: r.to };
    }
    const m = DATES.exec(period);
    if (!m) throw new Error(`period must be one of ${PERIOD_PRESETS.join(", ")} or dates as YYYY-MM-DD..YYYY-MM-DD.`);
    const r = checkRange(m[1], m[2]);
    if ("error" in r) throw new Error(r.error);
    return r;
  }
  const r = checkRange(input.from, input.to);
  if ("error" in r) throw new Error(r.error);
  return r;
}

const NOT_AVAILABLE = (what: string) => ({ available: false, reason: `${what} is not switched on for this shop, so there is no data to read.` });

/** Monday of the week containing `date` (YYYY-MM-DD). */
function weekStart(date: string): string {
  const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

/**
 * The read-only tools of "Ask your shop". Each validates its input, reads through a port for THIS tenant only (the
 * tenant is closed over: the model cannot choose one) and returns compact JSON in rupees. Nothing writes.
 */
export function buildAskTools(ctx: AskToolContext): AiTool[] {
  const { tenantId, ports } = ctx;
  const today = ctx.today ?? ports.today();
  const sink = ctx.sink;
  const record = (tool: string, args: Record<string, unknown>, data: unknown, tables: TableBlock[] = []) => {
    sink?.push({ tool, args, data, tables });
    // A last safety net: phone numbers and e-mails never reach the model unmasked, whatever a port returned.
    return JSON.parse(maskText(JSON.stringify(data))) as object;
  };
  const dateTitle = (r: DateRange) => `${r.from} to ${r.to}`;
  const dateTitleTa = (r: DateRange) => `${r.from} முதல் ${r.to} வரை`;

  return [
    {
      name: "resolve_period",
      description:
        "Turns named periods or festivals into exact IST dates. Use it for festivals (Deepavali, Pongal, Tamil New Year) and whenever you are unsure of a week, month, quarter or financial year boundary. Pass several periods at once to compare them. Today's date is in the user message.",
      inputSchema: obj(
        {
          periods: {
            type: "array",
            description: "One to four periods, each a preset or a festival with a year.",
            items: obj({
              preset: { type: "string", enum: [...PERIOD_PRESETS] },
              festival: { type: "string", enum: [...FESTIVALS], description: "With year. Gives the 7 days before the festival plus the festival day (Pongal: Bhogi to Kaanum Pongal)." },
              year: { type: "integer", description: "Calendar year of the festival." },
            }),
          },
        },
        ["periods"],
      ),
      async run(input) {
        const p = z
          .object({ periods: z.array(z.object({ preset: z.enum(PERIOD_PRESETS).optional(), festival: z.enum(FESTIVALS).optional(), year: z.coerce.number().int().min(2000).max(2100).optional() })).min(1).max(4) })
          .safeParse(input);
        if (!p.success) throw new Error("Give 1 to 4 periods, each a preset or a festival with a year.");
        const out = p.data.periods.map((x) => {
          if (x.festival) return x.year ? festivalRange(x.festival as Festival, x.year, today) : { error: "A festival needs a year." };
          if (x.preset) return presetRange(x.preset as PeriodPreset, today);
          return { error: "Give a preset or a festival." };
        });
        return record("resolve_period", input, { today, periods: out });
      },
    },
    {
      name: "sales_summary",
      description:
        "Sales for a period: number of bills, taxable value, GST, total billed (net of returns/credit notes), amount received so far, and the breakdown by day, week or month. Optionally for one branch.",
      inputSchema: obj({
        ...rangeProps,
        group: { type: "string", enum: ["day", "week", "month"], description: "How to group the breakdown. Default day for up to 31 days, else month." },
        branch_id: { type: "string", description: "Only for shops with branches." },
      }),
      async run(input) {
        const range = rangeOf(input, today);
        const branchId = typeof input.branch_id === "string" && /^[0-9a-f-]{36}$/i.test(input.branch_id) ? input.branch_id : undefined;
        const r = await ports.sales(tenantId, { ...range, ...(branchId ? { branchId } : {}) });
        if (!r) return record("sales_summary", input, NOT_AVAILABLE("Billing reports"));
        const span = daysBetween(range.from, range.to) + 1;
        const group = input.group === "day" || input.group === "week" || input.group === "month" ? input.group : span <= 31 ? "day" : "month";
        const buckets = new Map<string, { bills: number; total: number }>();
        for (const d of r.byDay) {
          const key = group === "day" ? d.date : group === "month" ? d.date.slice(0, 7) : weekStart(d.date);
          const b = buckets.get(key) ?? { bills: 0, total: 0 };
          b.bills += d.bills;
          b.total += d.total;
          buckets.set(key, b);
        }
        const rows = [...buckets.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([period, v]) => ({ period, bills: v.bills, total: rs(v.total) }));
        const trimmed = rows.slice(-MAX_LIST);
        const data = {
          from: range.from,
          to: range.to,
          bills: r.bills,
          credit_notes: r.creditNotes,
          taxable: rs(r.taxable),
          gst: rs(r.tax),
          total_billed: rs(r.total),
          received_so_far: rs(r.paid),
          group_by: group,
          breakdown: trimmed,
          ...(rows.length > trimmed.length ? { breakdown_note: `only the latest ${MAX_LIST} of ${rows.length} rows` } : {}),
        };
        const periodLabel = group === "day" ? ["Day", "நாள்"] : group === "week" ? ["Week from", "வாரம் தொடக்கம்"] : ["Month", "மாதம்"];
        return record("sales_summary", input, data, [
          {
            id: "sales",
            title: `Sales ${dateTitle(range)}`,
            titleTa: `விற்பனை ${dateTitleTa(range)}`,
            columns: [col("bills", "Bills", "பில்கள்", "int"), col("taxable", "Taxable value", "வரிக்கு முந்தைய மதிப்பு", "money"), col("gst", "GST", "GST", "money"), col("total", "Total billed", "மொத்த பில் தொகை", "money"), col("received", "Received", "பெற்றது", "money")],
            rows: [{ bills: r.bills, taxable: rs(r.taxable), gst: rs(r.tax), total: rs(r.total), received: rs(r.paid) }],
          },
          ...(trimmed.length > 1
            ? [
                {
                  id: "sales-breakdown",
                  title: `By ${group}`,
                  titleTa: group === "day" ? "நாள் வாரியாக" : group === "week" ? "வாரம் வாரியாக" : "மாதம் வாரியாக",
                  columns: [col("period", periodLabel[0]!, periodLabel[1]!, "text"), col("bills", "Bills", "பில்கள்", "int"), col("total", "Total", "மொத்தம்", "money")],
                  rows: trimmed,
                } satisfies TableBlock,
              ]
            : []),
        ]);
      },
    },
    {
      name: "payments_received",
      description: "Money received in a period by method (cash, UPI, card, bank...), including payments on bills and customer receipts.",
      inputSchema: obj({ ...rangeProps }),
      async run(input) {
        const range = rangeOf(input, today);
        const r = await ports.payments(tenantId, range);
        if (!r) return record("payments_received", input, NOT_AVAILABLE("Billing reports"));
        const total = r.byMethod.reduce((n, m) => n + m.amount, 0);
        const rows = r.byMethod.map((m) => ({ method: m.method, amount: rs(m.amount), payments: m.count }));
        return record("payments_received", input, { from: range.from, to: range.to, total_received: rs(total), by_method: rows }, [
          {
            id: "payments",
            title: `Money received ${dateTitle(range)}`,
            titleTa: `பெற்ற பணம் ${dateTitleTa(range)}`,
            columns: [col("method", "Method", "முறை", "text"), col("amount", "Amount", "தொகை", "money"), col("payments", "Payments", "பரிவர்த்தனைகள்", "int")],
            rows,
          },
        ]);
      },
    },
    {
      name: "top_items",
      description: "Best selling items by taxable value in a period (quantity and value). For stock that sells slowly or not at all use slow_or_dead_stock.",
      inputSchema: obj({ ...rangeProps, limit: { type: "integer", description: "1 to 50, default 10." } }),
      async run(input) {
        const range = rangeOf(input, today);
        const limit = limitField.default(10).parse(input.limit ?? 10);
        const r = await ports.topItems(tenantId, range, limit);
        if (!r) return record("top_items", input, NOT_AVAILABLE("Billing reports"));
        const rows = r.map((x, i) => ({ rank: i + 1, item: safeName(x.name, 80), qty: x.qty, unit: x.unit, taxable_value: rs(x.taxable) }));
        return record("top_items", input, { from: range.from, to: range.to, items: rows }, [
          {
            id: "top-items",
            title: `Top items ${dateTitle(range)}`,
            titleTa: `அதிகம் விற்ற பொருட்கள் ${dateTitleTa(range)}`,
            columns: [col("rank", "#", "#", "int"), col("item", "Item", "பொருள்", "text"), col("qty", "Qty", "அளவு", "num"), col("unit", "Unit", "அலகு", "text"), col("taxable_value", "Value", "மதிப்பு", "money")],
            rows,
          },
        ]);
      },
    },
    {
      name: "top_customers",
      description: "Saved customers who bought the most in a period (walk-in sales are not included). Names only, no phone numbers.",
      inputSchema: obj({ ...rangeProps, limit: { type: "integer", description: "1 to 50, default 10." } }),
      async run(input) {
        const range = rangeOf(input, today);
        const limit = limitField.default(10).parse(input.limit ?? 10);
        const r = await ports.topCustomers(tenantId, range, limit);
        if (!r) return record("top_customers", input, NOT_AVAILABLE("Billing reports"));
        const rows = r.map((x, i) => ({ rank: i + 1, customer: safeName(x.name), bills: x.bills, total: rs(x.total) }));
        return record("top_customers", input, { from: range.from, to: range.to, customers: rows }, [
          {
            id: "top-customers",
            title: `Top customers ${dateTitle(range)}`,
            titleTa: `அதிகம் வாங்கிய வாடிக்கையாளர்கள் ${dateTitleTa(range)}`,
            columns: [col("rank", "#", "#", "int"), col("customer", "Customer", "வாடிக்கையாளர்", "text"), col("bills", "Bills", "பில்கள்", "int"), col("total", "Total", "மொத்தம்", "money")],
            rows,
          },
        ]);
      },
    },
    {
      name: "receivables_ageing",
      description:
        "Dues the shop is waiting to collect, grouped by how late they are (not yet due, 1-30, 31-60, 61-90, over 90 days past due), with the biggest customers. Optionally as of an earlier date.",
      inputSchema: obj({ as_of: { type: "string", description: "YYYY-MM-DD, default today." }, limit: { type: "integer", description: "Customers to list, 1 to 50, default 10." } }),
      async run(input) {
        const limit = limitField.default(10).parse(input.limit ?? 10);
        const asOf = input.as_of === undefined ? undefined : dateStrZ.parse(input.as_of);
        const r = await ports.ageing(tenantId, { ...(asOf ? { asOf } : {}), limit });
        if (!r) return record("receivables_ageing", input, NOT_AVAILABLE("Billing reports"));
        const buckets = r.buckets.map((b) => ({ bucket: b.key, amount: rs(b.amount), bills: b.count }));
        const customers = r.customers.slice(0, limit).map((c) => ({
          customer: safeName(c.name),
          not_yet_due: rs(c.current),
          days_1_30: rs(c.d1_30),
          days_31_60: rs(c.d31_60),
          days_61_90: rs(c.d61_90),
          over_90: rs(c.d90_plus),
          total: rs(c.total),
        }));
        const total = r.buckets.reduce((n, b) => n + b.amount, 0);
        return record("receivables_ageing", input, { as_of: r.asOf, total_receivable: rs(total), customers_with_dues: r.totalCustomers, buckets, customers }, [
          {
            id: "ageing-buckets",
            title: `Dues by age (as of ${r.asOf})`,
            titleTa: `நிலுவை வயது வாரியாக (${r.asOf} நிலவரம்)`,
            columns: [col("bucket", "Days past due", "தாமத நாட்கள்", "text"), col("amount", "Amount", "தொகை", "money"), col("bills", "Bills", "பில்கள்", "int")],
            rows: buckets,
          },
          {
            id: "ageing-customers",
            title: "Biggest dues",
            titleTa: "பெரிய நிலுவைகள்",
            columns: [col("customer", "Customer", "வாடிக்கையாளர்", "text"), col("not_yet_due", "Not yet due", "கெடு வராதது", "money"), col("days_1_30", "1-30", "1-30", "money"), col("days_31_60", "31-60", "31-60", "money"), col("days_61_90", "61-90", "61-90", "money"), col("over_90", "90+", "90+", "money"), col("total", "Total", "மொத்தம்", "money")],
            rows: customers,
          },
        ]);
      },
    },
    {
      name: "customers_owing",
      description:
        "Customers who owe the shop money (the credit book), biggest first. Filter by a minimum balance in rupees and/or a minimum number of days the oldest unpaid bill is past its due date. Phone numbers come back masked (last 4 digits only).",
      inputSchema: obj({
        min_amount: { type: "number", description: "Only customers owing at least this many rupees." },
        min_days_overdue: { type: "integer", description: "Only customers whose oldest unpaid bill is at least this many days past due." },
        limit: { type: "integer", description: "1 to 50, default 20." },
      }),
      async run(input) {
        const p = z
          .object({ min_amount: z.coerce.number().min(0).max(1e9).optional(), min_days_overdue: z.coerce.number().int().min(0).max(5000).optional(), limit: limitField.default(20) })
          .safeParse(input);
        if (!p.success) throw new Error("min_amount is rupees (a number), min_days_overdue whole days, limit 1 to 50.");
        const r = await ports.creditBook(tenantId, { limit: 500 });
        if (!r) return record("customers_owing", input, NOT_AVAILABLE("The credit book"));
        const all = r.items
          .map((c) => ({
            customer: safeName(c.name),
            phone: c.phone ? maskPhone(c.phone) : null,
            owes: rs(c.balance),
            overdue_amount: rs(c.overdue),
            oldest_due_date: c.oldestDue,
            days_overdue: c.oldestDue && c.oldestDue < today ? daysBetween(c.oldestDue, today) : 0,
          }))
          .filter((c) => c.owes > 0)
          .filter((c) => (p.data.min_amount === undefined ? true : c.owes >= p.data.min_amount))
          .filter((c) => (p.data.min_days_overdue === undefined ? true : c.days_overdue >= p.data.min_days_overdue));
        const rows = all.slice(0, p.data.limit);
        const matchingTotal = Math.round(all.reduce((n, c) => n + c.owes, 0) * 100) / 100;
        return record(
          "customers_owing",
          input,
          { as_of: today, total_receivable_all_customers: rs(r.totals.receivable), customers_with_dues_all: r.totals.customersWithDues, matching_customers: all.length, matching_total: matchingTotal, customers: rows },
          [
            {
              id: "owing",
              title: "Customers who owe",
              titleTa: "பணம் தர வேண்டிய வாடிக்கையாளர்கள்",
              columns: [col("customer", "Customer", "வாடிக்கையாளர்", "text"), col("phone", "Phone", "தொலைபேசி", "text"), col("owes", "Owes", "தர வேண்டியது", "money"), col("oldest_due_date", "Oldest due", "பழைய கெடு", "date"), col("days_overdue", "Days late", "தாமத நாட்கள்", "int")],
              rows,
            },
          ],
        );
      },
    },
    {
      name: "low_stock",
      description: "Items at or below their reorder level (status low) or out of stock (status out), with the stock summary (stock value at cost, counts).",
      inputSchema: obj({ status: { type: "string", enum: ["low", "out"], description: "Default low." }, limit: { type: "integer", description: "1 to 50, default 20." } }),
      async run(input) {
        const status = input.status === "out" ? "out" : "low";
        const limit = limitField.default(20).parse(input.limit ?? 20);
        const r = await ports.stock(tenantId, { status, limit });
        if (!r) return record("low_stock", input, NOT_AVAILABLE("Stock tracking"));
        const rows = r.items.map((i) => ({ item: safeName(i.name, 80), in_stock: i.qty, unit: i.unit, reorder_level: i.reorderLevel, stock_value: rs(i.value) }));
        return record(
          "low_stock",
          input,
          { status, tracked_items: r.totals.items, items_low: r.totals.lowCount, items_out: r.totals.outCount, total_stock_value_at_cost: rs(r.totals.stockValue), items: rows },
          [
            {
              id: "low-stock",
              title: status === "out" ? "Out of stock" : "Low stock",
              titleTa: status === "out" ? "இருப்பு இல்லாதவை" : "குறைந்த இருப்பு",
              columns: [col("item", "Item", "பொருள்", "text"), col("in_stock", "In stock", "இருப்பு", "num"), col("unit", "Unit", "அலகு", "text"), col("reorder_level", "Reorder at", "மீண்டும் வாங்க", "num")],
              rows,
            },
          ],
        );
      },
    },
    {
      name: "slow_or_dead_stock",
      description:
        "Items that are on the shelf but sell slowly or not at all: tracked items with stock, least sold in the last N days first, with quantity sold, stock value at cost and the last sale date. Use only_unsold=true for dead stock (nothing sold in the window).",
      inputSchema: obj({
        days: { type: "integer", description: "Look-back window in days, 7 to 365, default 60." },
        only_unsold: { type: "boolean", description: "Only items with zero sales in the window." },
        limit: { type: "integer", description: "1 to 50, default 15." },
      }),
      async run(input) {
        const days = z.coerce.number().int().min(7).max(365).default(60).parse(input.days ?? 60);
        const limit = limitField.default(15).parse(input.limit ?? 15);
        const onlyUnsold = input.only_unsold === true;
        const r = await ports.slowStock(tenantId, { days, limit, onlyUnsold });
        if (!r) return record("slow_or_dead_stock", input, NOT_AVAILABLE("Stock tracking"));
        const rows = r.items.map((i) => ({ item: safeName(i.name, 80), in_stock: i.qty, unit: i.unit, stock_value: rs(i.value), sold_in_window: i.soldQty, last_sold: i.lastSold }));
        return record("slow_or_dead_stock", input, { window_days: days, as_of: r.asOf, items_on_shelf: r.totalOnShelf, only_unsold: onlyUnsold, items: rows }, [
          {
            id: "slow-stock",
            title: onlyUnsold ? `No sales in ${days} days` : `Slowest sellers (${days} days)`,
            titleTa: onlyUnsold ? `${days} நாட்களில் விற்பனை இல்லை` : `மெதுவாக விற்பவை (${days} நாட்கள்)`,
            columns: [col("item", "Item", "பொருள்", "text"), col("in_stock", "In stock", "இருப்பு", "num"), col("stock_value", "Stock value", "இருப்பு மதிப்பு", "money"), col("sold_in_window", "Sold", "விற்றது", "num"), col("last_sold", "Last sold", "கடைசி விற்பனை", "date")],
            rows,
          },
        ]);
      },
    },
    {
      name: "expiry",
      description:
        "Stock (medicine or batch-tracked) that is expired or expires within N days: totals for expired and expiring and the batches that expire first. Pharmacy shops read their medicine batches.",
      inputSchema: obj({ within_days: { type: "integer", description: "1 to 365, default 90." }, limit: { type: "integer", description: "1 to 50, default 15." } }),
      async run(input) {
        const withinDays = z.coerce.number().int().min(1).max(365).default(90).parse(input.within_days ?? 90);
        const limit = limitField.default(15).parse(input.limit ?? 15);
        const r = await ports.expiry(tenantId, { withinDays, limit });
        if (!r) return record("expiry", input, NOT_AVAILABLE("Batch and expiry tracking"));
        const rows = r.items.map((i) => ({ item: safeName(i.item, 80), batch: safeName(i.batchNo, 30), expiry: i.expiry, days_left: i.daysLeft, qty: i.qty }));
        return record(
          "expiry",
          input,
          {
            as_of: today,
            within_days: withinDays,
            source: r.source,
            expired: { batches: r.expired.batches, qty: r.expired.qty, value_at_cost: rs(r.expired.value) },
            expiring_soon: { batches: r.expiring.batches, qty: r.expiring.qty, value_at_cost: rs(r.expiring.value) },
            earliest_batches: rows,
          },
          [
            {
              id: "expiry",
              title: `Expiring within ${withinDays} days`,
              titleTa: `${withinDays} நாட்களுக்குள் காலாவதி`,
              columns: [col("item", "Item", "பொருள்", "text"), col("batch", "Batch", "பேட்ச்", "text"), col("expiry", "Expiry", "காலாவதி", "date"), col("days_left", "Days left", "மீதமுள்ள நாட்கள்", "int"), col("qty", "Qty", "அளவு", "num")],
              rows,
            },
          ],
        );
      },
    },
    {
      name: "purchases_summary",
      description: "Purchases from suppliers in a period: bills, taxable value, input tax credit (GST paid) and total, plus the biggest suppliers.",
      inputSchema: obj({ ...rangeProps }),
      async run(input) {
        const range = rangeOf(input, today);
        const r = await ports.purchases(tenantId, range);
        if (!r) return record("purchases_summary", input, NOT_AVAILABLE("Purchases"));
        const suppliers = r.bySupplier.slice(0, 10).map((s) => ({ supplier: safeName(s.name), bills: s.bills, total: rs(s.total) }));
        return record("purchases_summary", input, { from: range.from, to: range.to, bills: r.bills, taxable: rs(r.taxable), gst_input_credit: rs(r.itc), total: rs(r.total), top_suppliers: suppliers }, [
          {
            id: "purchases",
            title: `Purchases ${dateTitle(range)}`,
            titleTa: `கொள்முதல் ${dateTitleTa(range)}`,
            columns: [col("supplier", "Supplier", "சப்ளையர்", "text"), col("bills", "Bills", "பில்கள்", "int"), col("total", "Total", "மொத்தம்", "money")],
            rows: suppliers,
          },
        ]);
      },
    },
    {
      name: "supplier_dues",
      description: "What the shop owes suppliers today: total payable, overdue, due in the next 7 days, and the suppliers owed the most.",
      inputSchema: obj({ limit: { type: "integer", description: "1 to 50, default 10." } }),
      async run(input) {
        const limit = limitField.default(10).parse(input.limit ?? 10);
        const r = await ports.payables(tenantId, { limit });
        if (!r) return record("supplier_dues", input, NOT_AVAILABLE("Purchases"));
        const rows = r.suppliers.slice(0, limit).map((s) => ({ supplier: safeName(s.name), owed: rs(s.total), overdue: rs(s.overdue) }));
        return record("supplier_dues", input, { as_of: r.asOf, total_payable: rs(r.payable), overdue: rs(r.overdue), due_in_7_days: rs(r.dueSoon), suppliers: rows }, [
          {
            id: "payables",
            title: "Owed to suppliers",
            titleTa: "சப்ளையர்களுக்கு தர வேண்டியது",
            columns: [col("supplier", "Supplier", "சப்ளையர்", "text"), col("owed", "Owed", "தர வேண்டியது", "money"), col("overdue", "Overdue", "தாமதமானது", "money")],
            rows,
          },
        ]);
      },
    },
    {
      name: "expenses_summary",
      description: "Expenses recorded in a period: total, GST in them and the split by category.",
      inputSchema: obj({ ...rangeProps }),
      async run(input) {
        const range = rangeOf(input, today);
        const r = await ports.expenses(tenantId, range);
        if (!r) return record("expenses_summary", input, NOT_AVAILABLE("Expenses"));
        const rows = r.byCategory.slice(0, MAX_LIST).map((c) => ({ category: safeName(c.name), total: rs(c.total), entries: c.count }));
        return record("expenses_summary", input, { from: range.from, to: range.to, total: rs(r.total), gst_in_expenses: rs(r.gst), entries: r.count, by_category: rows }, [
          {
            id: "expenses",
            title: `Expenses ${dateTitle(range)}`,
            titleTa: `செலவுகள் ${dateTitleTa(range)}`,
            columns: [col("category", "Category", "வகை", "text"), col("total", "Total", "மொத்தம்", "money"), col("entries", "Entries", "பதிவுகள்", "int")],
            rows,
          },
        ]);
      },
    },
    {
      name: "profit",
      description:
        "The profit figures the app computes for a period: sales (taxable) minus purchases (taxable) = gross profit; minus expenses = net profit; plus the GST position. This is a simple view (purchases made in the period, not cost of goods sold), so say so when you report it.",
      inputSchema: obj({ ...rangeProps }),
      async run(input) {
        const range = rangeOf(input, today);
        const r = await ports.profit(tenantId, range);
        if (!r) return record("profit", input, NOT_AVAILABLE("The profit report"));
        const data = {
          from: range.from,
          to: range.to,
          sales_taxable: rs(r.salesTaxable),
          purchases_taxable: rs(r.purchasesTaxable),
          gross_profit: rs(r.grossProfit),
          expenses_total: rs(r.expensesTotal),
          expenses_gst_credit: rs(r.expensesItc),
          net_profit: rs(r.netProfit),
          gst_collected: rs(r.gstOutput),
          gst_input_credit: rs(r.gstItc),
          gst_payable: rs(r.gstPayable),
        };
        return record("profit", input, { ...data, basis: "sales minus purchases made in the period (not cost of goods sold), minus expenses" }, [
          {
            id: "profit",
            title: `Profit view ${dateTitle(range)}`,
            titleTa: `லாப நிலை ${dateTitleTa(range)}`,
            columns: [col("sales_taxable", "Sales", "விற்பனை", "money"), col("purchases_taxable", "Purchases", "கொள்முதல்", "money"), col("gross_profit", "Gross profit", "மொத்த லாபம்", "money"), col("expenses_total", "Expenses", "செலவுகள்", "money"), col("net_profit", "Net profit", "நிகர லாபம்", "money")],
            rows: [data],
          },
        ]);
      },
    },
    {
      name: "gst_summary",
      description:
        "GST figures for a period from the GST report: invoices, credit notes, taxable value, CGST, SGST, IGST, totals, the split by rate, and how many entries fall in each GSTR-1 section (B2B, B2CL, B2CS, credit notes). Figures only; never advice on filing.",
      inputSchema: obj({ ...rangeProps }),
      async run(input) {
        const range = rangeOf(input, today);
        const r = await ports.gst(tenantId, range);
        if (!r) return record("gst_summary", input, NOT_AVAILABLE("GST reports"));
        const byRate = r.byRate.map((x) => ({ rate_percent: x.rate, taxable: rs(x.taxable), cgst: rs(x.cgst), sgst: rs(x.sgst), igst: rs(x.igst) }));
        return record(
          "gst_summary",
          input,
          {
            from: range.from,
            to: range.to,
            invoices: r.invoices,
            credit_notes: r.creditNotes,
            taxable: rs(r.taxable),
            cgst: rs(r.cgst),
            sgst: rs(r.sgst),
            igst: rs(r.igst),
            total_gst: rs(r.cgst + r.sgst + r.igst),
            total_with_gst: rs(r.total),
            nil_rated: rs(r.nilRated),
            by_rate: byRate,
            gstr1_sections: r.sections,
          },
          [
            {
              id: "gst",
              title: `GST ${dateTitle(range)}`,
              titleTa: `GST ${dateTitleTa(range)}`,
              columns: [col("rate_percent", "Rate %", "விகிதம் %", "num"), col("taxable", "Taxable", "வரிக்குரிய மதிப்பு", "money"), col("cgst", "CGST", "CGST", "money"), col("sgst", "SGST", "SGST", "money"), col("igst", "IGST", "IGST", "money")],
              rows: byRate,
            },
          ],
        );
      },
    },
    {
      name: "sales_by_staff",
      description: "Sales per team member (who issued the bills) in a period: bills and total billed.",
      inputSchema: obj({ ...rangeProps }),
      async run(input) {
        const range = rangeOf(input, today);
        const r = await ports.salesByStaff(tenantId, range);
        if (!r) return record("sales_by_staff", input, NOT_AVAILABLE("Staff-wise sales"));
        const rows = r.slice(0, MAX_LIST).map((s) => ({ staff: safeName(s.name), bills: s.bills, total: rs(s.total) }));
        return record("sales_by_staff", input, { from: range.from, to: range.to, staff: rows }, [
          {
            id: "staff",
            title: `Sales by team member ${dateTitle(range)}`,
            titleTa: `ஊழியர் வாரியான விற்பனை ${dateTitleTa(range)}`,
            columns: [col("staff", "Team member", "ஊழியர்", "text"), col("bills", "Bills", "பில்கள்", "int"), col("total", "Total", "மொத்தம்", "money")],
            rows,
          },
        ]);
      },
    },
    {
      name: "sales_by_branch",
      description: "Sales per branch in a period (only for shops that use branches).",
      inputSchema: obj({ ...rangeProps }),
      async run(input) {
        const range = rangeOf(input, today);
        const r = await ports.salesByBranch(tenantId, range);
        if (!r) return record("sales_by_branch", input, NOT_AVAILABLE("Branches"));
        const rows = r.slice(0, MAX_LIST).map((s) => ({ branch: safeName(s.name), bills: s.bills, total: rs(s.total) }));
        return record("sales_by_branch", input, { from: range.from, to: range.to, branches: rows }, [
          {
            id: "branches",
            title: `Sales by branch ${dateTitle(range)}`,
            titleTa: `கிளை வாரியான விற்பனை ${dateTitleTa(range)}`,
            columns: [col("branch", "Branch", "கிளை", "text"), col("bills", "Bills", "பில்கள்", "int"), col("total", "Total", "மொத்தம்", "money")],
            rows,
          },
        ]);
      },
    },
  ];
}

export const ASK_TOOL_NAMES = [
  "resolve_period",
  "sales_summary",
  "payments_received",
  "top_items",
  "top_customers",
  "receivables_ageing",
  "customers_owing",
  "low_stock",
  "slow_or_dead_stock",
  "expiry",
  "purchases_summary",
  "supplier_dues",
  "expenses_summary",
  "profit",
  "gst_summary",
  "sales_by_staff",
  "sales_by_branch",
] as const;
