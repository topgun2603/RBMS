import { requirePermission, requireRole, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { csvDisposition, expensesCsv } from "./csv";
import { EXPENSES_FEATURE, EXPENSES_PERMISSION } from "./ports";
import type { ExpenseListQuery, ExpensesService } from "./service";

const idParam = z.object({ id: z.string().uuid() });
/** Expense routes only match UUID-shaped ids, so /summary, /categories and /reports never reach them. */
const ID = "/:id([0-9a-fA-F-]{36})";
const formatQuery = z.object({ format: z.enum(["json", "csv"]).default("json") });
const rangeQuery = z.object({ from: z.string().optional(), to: z.string().optional() });
const OPTS = { config: { feature: EXPENSES_FEATURE, permission: EXPENSES_PERMISSION } };

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
    app.get("/categories", OPTS, async (req) => ({ items: await service.categories(tenantOf(req)) }));
    app.post("/categories", OPTS, async (req) => service.createCategory(tenantOf(req), req.body ?? {}));
    app.patch(`/categories${ID}`, OPTS, async (req) => {
      const { id } = idParam.parse(req.params);
      return service.updateCategory(tenantOf(req), id, req.body ?? {});
    });
    app.delete(`/categories${ID}`, OPTS, async (req) => {
      const { id } = idParam.parse(req.params);
      await service.deleteCategory(tenantOf(req), id);
      return { ok: true };
    });

    // ---- reports
    app.get("/summary", OPTS, async (req) => service.summary(tenantOf(req), rangeQuery.parse(req.query ?? {})));
    app.get("/reports/profit", OPTS, async (req) => service.profit(tenantOf(req), rangeQuery.parse(req.query ?? {})));

    // ---- expenses
    app.get("/", OPTS, async (req, reply) => {
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
    app.post("/", OPTS, async (req) => service.create(tenantOf(req), req.body ?? {}, requireUser(req.ctx).id));
    app.get(ID, OPTS, async (req) => {
      const { id } = idParam.parse(req.params);
      return service.get(tenantOf(req), id);
    });
    app.patch(ID, OPTS, async (req) => {
      const { id } = idParam.parse(req.params);
      return service.update(tenantOf(req), id, req.body ?? {});
    });
    app.delete(ID, OPTS, async (req) => {
      const { id } = idParam.parse(req.params);
      return service.cancel(tenantOf(req), id);
    });
  };
}
