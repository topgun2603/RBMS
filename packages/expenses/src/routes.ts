import { documented, requirePermission, requireRole, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { csvDisposition, expenseReportCsv, expensesCsv } from "./csv";
import type { RecurringExpenseInput, RecurringExpenseListQuery, RecurringExpensePatch, RecurringExpensesService } from "./recurring";
import { EXPENSES_FEATURE, EXPENSES_PERMISSION } from "./ports";
import { EXPENSE_PAYMENT_METHODS, EXPENSE_STATUSES } from "./schema";
import { categoryInput, categoryPatch, expenseInput, expensePatch, expenseRecordInput, listQuery } from "./service";
import type { ExpenseListQuery, ExpensesService } from "./service";

const idParam = z.object({ id: z.string().uuid() });
/** Expense routes only match UUID-shaped ids, so /summary, /categories and /reports never reach them. */
const ID = "/:id([0-9a-fA-F-]{36})";
const formatQuery = z.object({ format: z.enum(["json", "csv"]).default("json") });
const rangeQuery = z.object({ from: z.string().optional(), to: z.string().optional() });
const reportQuery = rangeQuery.extend({ groupBy: z.string().optional(), branchId: z.string().optional(), format: z.enum(["json", "csv"]).default("json") });
const OPTS = { config: { feature: EXPENSES_FEATURE, permission: EXPENSES_PERMISSION } };

// ---- response shapes for the API document and the mobile client (JSON: dates are ISO strings, money in paise)
const isoDateTime = z.string().datetime();
const paise = z.number().int();
/** A category row as stored (built-ins are seeded on first read and can't be deleted). */
export const expenseCategorySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  sort: z.number().int(),
  builtin: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export const expenseCategoryListSchema = z.object({ items: z.array(expenseCategorySchema) });
/** An expense (`ExpenseView`): the stored row plus its category name, taxable value and claimable ITC. */
export const expenseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  /** YYYY-MM-DD. */
  date: z.string(),
  categoryId: z.string().uuid(),
  /** Including GST. */
  amount: paise,
  gstRate: z.number(),
  /** GST inside `amount`. */
  gstAmount: paise,
  vendorName: z.string().nullable(),
  vendorGstin: z.string().nullable(),
  paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  receiptUrl: z.string().nullable(),
  /** Supplier (inventory) the bill is from. */
  supplierId: z.string().uuid().nullable(),
  /** null = shop-wide. */
  branchId: z.string().uuid().nullable(),
  /** Credit expenses: when the supplier is to be paid. */
  dueDate: z.string().nullable(),
  /** Credit expenses: paid through Payables. */
  amountPaid: paise,
  recurringId: z.string().uuid().nullable(),
  recurringRunId: z.string().uuid().nullable(),
  /** `DELETE /:id` cancels (kept for the record, left out of totals); `draft` = made by a recurring expense, to record. */
  status: z.enum(EXPENSE_STATUSES),
  createdBy: z.string().uuid().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  categoryName: z.string(),
  /** amount - gstAmount. */
  taxable: paise,
  /** Claimable input tax credit (the GST when the vendor GSTIN is valid). */
  itc: paise,
  /** Credit expenses: still to pay the supplier. */
  balance: paise,
});
export const expenseListSchema = z.object({
  items: z.array(expenseSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  /** Over every matching recorded expense (not just this page). */
  totals: z.object({ amount: paise, gst: paise, itc: paise }),
  /** `category` (ids), `paymentMethod` and `status` counts under the other filters. */
  facets: z.object({
    category: z.record(z.string(), z.number().int()),
    paymentMethod: z.record(z.string(), z.number().int()),
    status: z.record(z.string(), z.number().int()),
  }),
});
const bucketFields = { total: paise, gst: paise, itc: paise, count: z.number().int() };
/** Recorded expenses of a period (default: this month) by category (largest first) and by month (oldest first). */
export const expenseSummarySchema = z.object({
  from: z.string(),
  to: z.string(),
  ...bucketFields,
  byCategory: z.array(z.object({ ...bucketFields, categoryId: z.string().uuid(), name: z.string() })),
  /** `month`: "YYYY-MM". */
  byMonth: z.array(z.object({ ...bucketFields, month: z.string() })),
});
const okSchema = z.object({ ok: z.literal(true) });
/** An expenses route (feature and permission) with its API document shapes. */
const typed = (schema: Parameters<typeof documented>[0]) => documented(schema, OPTS.config);

/**
 * Routes under /v1/expenses: staff (owner/admin/staff) with `expenses.manage`; feature `expenses`.
 * `GET /` accepts `format=csv`. `DELETE /:id` cancels the expense.
 */
export function expensesRoutes(service: ExpensesService, recurring?: RecurringExpensesService) {
  return async (app: FastifyInstance) => {
    app.addHook("preHandler", async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      requireTenant(req.ctx);
      requirePermission(req.ctx, EXPENSES_PERMISSION);
    });
    const tenantOf = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;

    // ---- categories
    app.get("/categories", typed({ response: expenseCategoryListSchema }), async (req) => ({ items: await service.categories(tenantOf(req)) }));
    app.post("/categories", typed({ body: categoryInput, response: expenseCategorySchema }), async (req) => service.createCategory(tenantOf(req), req.body ?? {}));
    app.patch(`/categories${ID}`, typed({ body: categoryPatch, response: expenseCategorySchema }), async (req) => {
      const { id } = idParam.parse(req.params);
      return service.updateCategory(tenantOf(req), id, req.body ?? {});
    });
    app.delete(`/categories${ID}`, typed({ response: okSchema }), async (req) => {
      const { id } = idParam.parse(req.params);
      await service.deleteCategory(tenantOf(req), id);
      return { ok: true };
    });

    // ---- reports
    app.get("/summary", typed({ query: rangeQuery, response: expenseSummarySchema }), async (req) => service.summary(tenantOf(req), rangeQuery.parse(req.query ?? {})));
    app.get("/reports/profit", OPTS, async (req) => service.profit(tenantOf(req), rangeQuery.parse(req.query ?? {})));
    /** By category / supplier / branch / month (`groupBy`), `format=csv`. */
    app.get("/reports/expenses", OPTS, async (req, reply) => {
      const q = reportQuery.parse(req.query ?? {});
      const report = await service.report(tenantOf(req), q);
      if (q.format !== "csv") return report;
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", csvDisposition(`expenses-by-${report.groupBy}`, report.from, report.to))
        .send(expenseReportCsv(report));
    });

    // ---- expenses
    app.get("/", typed({ query: listQuery, response: expenseListSchema }), async (req, reply) => {
      const q = (req.query ?? {}) as Record<string, string | undefined>;
      const { format } = formatQuery.parse(q);
      const { format: _f, ...filters } = q;
      if (format !== "csv") return service.list(tenantOf(req), filters as ExpenseListQuery);
      const [result, branches] = await Promise.all([service.list(tenantOf(req), { ...filters, limit: 500, offset: 0 } as ExpenseListQuery), service.branchNames(tenantOf(req))]);
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", csvDisposition("expenses", q.from, q.to))
        .send(expensesCsv(result.items, (id) => (id ? (branches.get(id) ?? "") : "Shop-wide")));
    });
    app.post("/", typed({ body: expenseInput, response: expenseSchema }), async (req) =>
      service.create(tenantOf(req), req.body ?? {}, requireUser(req.ctx).id, { branchId: req.ctx.branch?.id ?? null }),
    );
    app.get(ID, typed({ response: expenseSchema }), async (req) => {
      const { id } = idParam.parse(req.params);
      return service.get(tenantOf(req), id);
    });
    app.patch(ID, typed({ body: expensePatch, response: expenseSchema }), async (req) => {
      const { id } = idParam.parse(req.params);
      return service.update(tenantOf(req), id, req.body ?? {});
    });
    app.delete(ID, typed({ response: expenseSchema }), async (req) => {
      const { id } = idParam.parse(req.params);
      return service.cancel(tenantOf(req), id);
    });
    /** Records a draft (made by a recurring expense), with the amount and any other field filled in. */
    app.post(`${ID}/record`, typed({ body: expenseRecordInput, response: expenseSchema }), async (req) => {
      const { id } = idParam.parse(req.params);
      return service.record(tenantOf(req), id, req.body ?? {});
    });

    // ---- recurring expenses (rent, electricity, subscriptions ...)
    if (!recurring) return;
    const audited = (action: string) => ({ config: { ...OPTS.config, audit: { action, entity: "expense_recurring" } } });
    app.get("/recurring", OPTS, async (req) => recurring.list(tenantOf(req), (req.query ?? {}) as RecurringExpenseListQuery));
    app.get("/recurring/summary", OPTS, async (req) => recurring.summary(tenantOf(req)));
    app.get("/recurring/preview", OPTS, async (req) => recurring.preview((req.query ?? {}) as Record<string, unknown>));
    app.post("/recurring", audited("expenses.recurring.create"), async (req) => {
      const r = await recurring.create(tenantOf(req), (req.body ?? {}) as RecurringExpenseInput, { userId: requireUser(req.ctx).id, branchId: req.ctx.branch?.id ?? null });
      req.auditSummary = `Recurring expense "${r.name}" set up (${r.frequency}, next ${r.nextRunDate ?? "none"})`;
      req.auditDetail = { entityId: r.id };
      return r;
    });
    app.get(`/recurring${ID}`, OPTS, async (req) => recurring.get(tenantOf(req), idParam.parse(req.params).id));
    app.patch(`/recurring${ID}`, audited("expenses.recurring.update"), async (req) => {
      const r = await recurring.update(tenantOf(req), idParam.parse(req.params).id, (req.body ?? {}) as RecurringExpensePatch);
      req.auditSummary = `Recurring expense "${r.name}" edited`;
      return r;
    });
    app.delete(`/recurring${ID}`, audited("expenses.recurring.delete"), async (req) => {
      await recurring.remove(tenantOf(req), idParam.parse(req.params).id);
      req.auditSummary = "Recurring expense deleted";
      return { ok: true };
    });
    for (const [path, action, run] of [
      ["pause", "expenses.recurring.pause", (t: string, id: string) => recurring.pause(t, id)],
      ["resume", "expenses.recurring.resume", (t: string, id: string) => recurring.resume(t, id)],
      ["skip", "expenses.recurring.skip", (t: string, id: string) => recurring.skipNext(t, id)],
      ["end", "expenses.recurring.end", (t: string, id: string) => recurring.end(t, id)],
    ] as const) {
      app.post(`/recurring${ID}/${path}`, audited(action), async (req) => {
        const r = await run(tenantOf(req), idParam.parse(req.params).id);
        req.auditSummary = `Recurring expense "${r.name}": ${path}${r.nextRunDate ? `, next ${r.nextRunDate}` : ""}`;
        return r;
      });
    }
    app.post(`/recurring${ID}/run`, audited("expenses.recurring.run"), async (req) => {
      const r = await recurring.runNow(tenantOf(req), idParam.parse(req.params).id, requireUser(req.ctx).id);
      req.auditSummary = `Recurring expense "${r.recurring.name}" made now: ${r.run.status}`;
      return r;
    });
  };
}
