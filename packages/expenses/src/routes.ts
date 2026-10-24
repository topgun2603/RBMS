import { documented, requirePermission, requireRole, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { csvDisposition, expensesCsv } from "./csv";
import { EXPENSES_FEATURE, EXPENSES_PERMISSION } from "./ports";
import { EXPENSE_PAYMENT_METHODS, EXPENSE_STATUSES } from "./schema";
import { categoryInput, categoryPatch, expenseInput, expensePatch, listQuery } from "./service";
import type { ExpenseListQuery, ExpensesService } from "./service";

const idParam = z.object({ id: z.string().uuid() });
/** Expense routes only match UUID-shaped ids, so /summary, /categories and /reports never reach them. */
const ID = "/:id([0-9a-fA-F-]{36})";
const formatQuery = z.object({ format: z.enum(["json", "csv"]).default("json") });
const rangeQuery = z.object({ from: z.string().optional(), to: z.string().optional() });
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
  /** `DELETE /:id` cancels (kept for the record, left out of totals). */
  status: z.enum(EXPENSE_STATUSES),
  createdBy: z.string().uuid().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  categoryName: z.string(),
  /** amount - gstAmount. */
  taxable: paise,
  /** Claimable input tax credit (the GST when the vendor GSTIN is valid). */
  itc: paise,
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
export function expensesRoutes(service: ExpensesService) {
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

    // ---- expenses
    app.get("/", typed({ query: listQuery, response: expenseListSchema }), async (req, reply) => {
      const q = (req.query ?? {}) as Record<string, string | undefined>;
      const { format } = formatQuery.parse(q);
      const { format: _f, ...filters } = q;
      if (format !== "csv") return service.list(tenantOf(req), filters as ExpenseListQuery);
      const result = await service.list(tenantOf(req), { ...filters, limit: 500, offset: 0 } as ExpenseListQuery);
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", csvDisposition("expenses", q.from, q.to))
        .send(expensesCsv(result.items));
    });
    app.post("/", typed({ body: expenseInput, response: expenseSchema }), async (req) => service.create(tenantOf(req), req.body ?? {}, requireUser(req.ctx).id));
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
  };
}
