import { requirePermission, requireRole, requireTenant, requireUser, type RequestContext } from "@rbms/core";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { ACCOUNTING_FEATURE, ACCOUNTING_PERMISSION_KEYS as P, type AccountingPermission } from "./features";
import { tableToCsv } from "./reports-logic";
import type { AccountingService, EntryListQuery } from "./service";
import { backfillInput } from "./service";

const idParam = z.object({ id: z.string().uuid() });
const ID = "/:id([0-9a-fA-F-]{36})";
const formatQuery = z.object({ format: z.enum(["json", "csv"]).default("json") }).passthrough();
const bool = (v: unknown) => v === true || v === "true" || v === "1";

const REPORTS = ["trial-balance", "profit-loss", "balance-sheet", "gst-ledger", "ledger", "cash-book"] as const;

const cfg = (permission: AccountingPermission) => ({ config: { feature: ACCOUNTING_FEATURE, permission } });

function csv(reply: FastifyReply, name: string, body: string) {
  return reply
    .header("content-type", "text/csv; charset=utf-8")
    .header("content-disposition", `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}.csv"`)
    .send(body);
}

/**
 * Routes under /v1/accounting (feature `accounting`; permissions accounting.view / .post / .lock).
 * Reports take `format=csv`; the PDF versions are served by the documents module (`/v1/documents/accounting-report/<report>.pdf`).
 */
export function accountingRoutes(service: AccountingService) {
  return async (app: FastifyInstance) => {
    const guard = (ctx: RequestContext, permission: AccountingPermission) => {
      requireRole(ctx, "owner", "admin", "staff");
      requireTenant(ctx);
      requirePermission(ctx, permission);
      return requireTenant(ctx).id;
    };
    const q = (req: { query: unknown }) => (req.query ?? {}) as Record<string, string | undefined>;

    app.get("/overview", cfg(P.view), async (req) => service.overview(guard(req.ctx, P.view)));

    // ---- chart of accounts
    app.get("/accounts", cfg(P.view), async (req) => {
      const t = guard(req.ctx, P.view);
      const { balances, asOf } = q(req);
      return { items: await service.listAccounts(t, { balances: bool(balances), asOf }) };
    });
    app.post("/accounts", cfg(P.post), async (req) => service.createAccount(guard(req.ctx, P.post), (req.body ?? {}) as never));
    app.patch(`/accounts${ID}`, cfg(P.post), async (req) => {
      const t = guard(req.ctx, P.post);
      return service.updateAccount(t, idParam.parse(req.params).id, (req.body ?? {}) as never);
    });
    app.delete(`/accounts${ID}`, cfg(P.post), async (req) => {
      const t = guard(req.ctx, P.post);
      return service.deleteAccount(t, idParam.parse(req.params).id);
    });

    // ---- journal entries
    app.get("/journal-entries", cfg(P.view), async (req) => service.listEntries(guard(req.ctx, P.view), q(req) as EntryListQuery));
    app.get(`/journal-entries${ID}`, cfg(P.view), async (req) => {
      const t = guard(req.ctx, P.view);
      return service.getEntry(t, idParam.parse(req.params).id);
    });
    app.post("/journal-entries", cfg(P.post), async (req) => {
      const t = guard(req.ctx, P.post);
      return service.createEntry(t, (req.body ?? {}) as never, requireUser(req.ctx).id);
    });
    app.post(`/journal-entries${ID}/reverse`, cfg(P.post), async (req) => {
      const t = guard(req.ctx, P.post);
      return service.reverseEntry(t, idParam.parse(req.params).id, (req.body ?? {}) as never, requireUser(req.ctx).id);
    });

    // ---- reports (JSON, or CSV with format=csv)
    app.get("/reports/day-book", cfg(P.view), async (req, reply) => {
      const t = guard(req.ctx, P.view);
      const { format } = formatQuery.parse(req.query ?? {});
      if (format === "csv") return csv(reply, "day-book", tableToCsv(await service.reportTable(t, "day-book", q(req))));
      return service.listEntries(t, { sort: "date", ...(q(req) as EntryListQuery) });
    });
    for (const name of REPORTS) {
      app.get(`/reports/${name}`, cfg(P.view), async (req, reply) => {
        const t = guard(req.ctx, P.view);
        const { format } = formatQuery.parse(req.query ?? {});
        if (format === "csv") return csv(reply, name, tableToCsv(await service.reportTable(t, name, q(req))));
        const query = q(req);
        switch (name) {
          case "trial-balance":
            return service.trialBalance(t, query);
          case "profit-loss":
            return service.profitLoss(t, query);
          case "balance-sheet":
            return service.balanceSheet(t, query);
          case "gst-ledger":
            return service.gstLedger(t, query);
          case "cash-book":
            return service.cashBook(t, query);
          default:
            return service.accountLedger(t, { accountId: query.accountId ?? "", from: query.from, to: query.to, partyId: query.partyId });
        }
      });
    }

    // ---- reconciliation with the credit book and payables
    app.get("/reconcile", cfg(P.view), async (req) => service.reconcile(guard(req.ctx, P.view), q(req)));
    app.get("/reconcile/parties", cfg(P.view), async (req) => {
      const t = guard(req.ctx, P.view);
      return service.reconcileParties(t, { type: q(req).type === "supplier" ? "supplier" : "customer" });
    });

    // ---- settings and the period lock
    app.get("/settings", cfg(P.view), async (req) => service.getSettings(guard(req.ctx, P.view)));
    app.patch("/settings", cfg(P.post), async (req) => service.updateSettings(guard(req.ctx, P.post), (req.body ?? {}) as never));
    app.put("/settings/lock", cfg(P.lock), async (req) => service.setLock(guard(req.ctx, P.lock), (req.body ?? {}) as never, requireUser(req.ctx).id));

    // ---- posting from existing documents
    app.post("/backfill", cfg(P.post), async (req) => {
      const t = guard(req.ctx, P.post);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const query = q(req);
      return service.backfill(
        t,
        backfillInput.parse({ from: (body.from as string | undefined) ?? query.from ?? null, dryRun: body.dryRun ?? (query.dryRun !== undefined ? bool(query.dryRun) : undefined) }),
        requireUser(req.ctx).id,
      );
    });
    app.post("/sync", cfg(P.post), async (req) => service.sync(guard(req.ctx, P.post)));
  };
}
