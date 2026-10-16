import { formatINR } from "@srirealtime/gst";
import { requireRole, requireTenant, requireUser } from "@srirealtime/core";
import type { CreditNoteInput, CreditNoteListQuery } from "./credit-notes";
import type { TillCashInput, TillCloseInput, TillListQuery, TillOpenInput } from "./till";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { FEATURES } from "./features";
import { csvBuilders, csvDisposition } from "./reports";
import {
  type CreditBookQuery,
  type CustomerInput,
  type InvoiceInput,
  type InvoiceListQuery,
  type InvoicesService,
  type ItemInput,
  type LedgerQuery,
  type ListQuery,
  type PaymentInput,
  type ReceiptInput,
  type ReportRange,
  type SendInput,
  type TopQuery,
} from "./service";

const idParam = z.object({ id: z.string().uuid() });
/** Bill routes only match UUID-shaped ids, so unknown paths (e.g. the old /khata) are 404s rather than auth errors. */
const BILL_ID = "/:id([0-9a-fA-F-]{36})";
const paymentParam = z.object({ id: z.string().uuid(), paymentId: z.string().uuid() });
const receiptParam = z.object({ id: z.string().uuid(), receiptId: z.string().uuid() });
const tokenParam = z.object({ token: z.string().min(1).max(128) });
const cancelBody = z.object({ reason: z.string().max(500).nullish() });
const issueBody = z.object({ loyaltyPoints: z.number().int().positive().optional() });
const formatQuery = z.object({ format: z.enum(["json", "csv"]).default("json") });
const gstCsvQuery = z.object({ section: z.enum(["hsn", "b2b", "b2cl", "b2cs", "cdnr", "cdnur"]).default("hsn") });
const registerQuery = z.object({ register: z.string().trim().min(1).max(40) });
/** Display name of the cashier (the session user has no name on the request context). */
const actorName = (b: Record<string, unknown>) => (typeof b.actorName === "string" && b.actorName.trim() ? b.actorName.trim().slice(0, 80) : null);
const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const query = (req: { query: unknown }) => (req.query ?? {}) as Record<string, string | undefined>;
const wantsCsv = (req: { query: unknown }) => formatQuery.parse(query(req)).format === "csv";

function sendCsv(reply: FastifyReply, csv: string, name: string, from?: string | null, to?: string | null) {
  return reply
    .header("content-type", "text/csv; charset=utf-8")
    .header("content-disposition", csvDisposition(name, from, to))
    .send(csv);
}

const feature = (key: string) => ({ config: { feature: key } });
const BASE = feature(FEATURES.base);
const WHATSAPP = feature(FEATURES.whatsapp);
const CREDIT_BOOK = feature(FEATURES.creditBook);
const REPORTS = feature(FEATURES.reports);
const GST_REPORTS = feature(FEATURES.gstReports);
const audited = (key: string, audit: { action: string; entity: string; idParam?: string }) => ({ config: { feature: key, audit } });

/**
 * Routes under /v1/invoices. Everything except the /public/* pages needs an owner, admin or staff member
 * of the current tenant. Every route declares its feature in `config.feature`; the API host enforces it.
 * Bodies are validated with zod inside the service. Report and ledger routes accept `format=csv`.
 */
export function invoicesRoutes(service: InvoicesService) {
  return async (app: FastifyInstance) => {
    // ---- public (no auth, no tenant header). The service checks the token's shop through the feature gate.
    app.get("/public/statement/:token", CREDIT_BOOK, async (req) => {
      const { token } = tokenParam.parse(req.params);
      return service.getPublicStatement(token, req.ctx?.tenant?.id ?? null);
    });
    app.get("/public/:token", BASE, async (req) => {
      const { token } = tokenParam.parse(req.params);
      return service.getPublic(token, req.ctx?.tenant?.id ?? null);
    });

    // ---- staff
    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
      });

      // customers
      staff.get("/customers", BASE, async (req) => service.listCustomers(requireTenant(req.ctx).id, req.query as ListQuery));
      staff.get("/customers/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.getCustomer(requireTenant(req.ctx).id, id);
      });
      staff.post("/customers", BASE, async (req) =>
        service.createCustomer(requireTenant(req.ctx).id, body(req) as CustomerInput),
      );
      staff.patch("/customers/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.updateCustomer(requireTenant(req.ctx).id, id, body(req) as Partial<CustomerInput>);
      });
      staff.delete("/customers/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteCustomer(requireTenant(req.ctx).id, id);
        return { ok: true };
      });

      // credit book
      staff.get("/credit-book", CREDIT_BOOK, async (req, reply) => {
        const csv = wantsCsv(req);
        const q = query(req);
        const result = await service.creditBook(requireTenant(req.ctx).id, (csv ? { ...q, limit: "500" } : q) as CreditBookQuery);
        return csv ? sendCsv(reply, csvBuilders.creditBook(result.items), "credit-book", q.filter ?? "all") : result;
      });
      staff.get("/customers/:id/ledger", CREDIT_BOOK, async (req, reply) => {
        const { id } = idParam.parse(req.params);
        const q = query(req);
        const result = await service.ledger(requireTenant(req.ctx).id, id, q as LedgerQuery);
        if (!wantsCsv(req)) return result;
        const last = result.entries[result.entries.length - 1];
        return sendCsv(reply, csvBuilders.ledger(result.entries), "ledger", q.from ?? result.entries[0]?.date, q.to ?? last?.date);
      });
      staff.post("/customers/:id/receipts", CREDIT_BOOK, async (req) => {
        const { id } = idParam.parse(req.params);
        const user = requireUser(req.ctx);
        return service.addReceipt(requireTenant(req.ctx).id, id, body(req) as ReceiptInput, user.id);
      });
      staff.delete("/customers/:id/receipts/:receiptId", CREDIT_BOOK, async (req) => {
        const { id, receiptId } = receiptParam.parse(req.params);
        await service.deleteReceipt(requireTenant(req.ctx).id, id, receiptId);
        return { ok: true };
      });
      staff.post("/customers/:id/statement/share", CREDIT_BOOK, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.shareStatement(requireTenant(req.ctx).id, id);
      });
      staff.post("/customers/:id/remind", WHATSAPP, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.remindCustomer(requireTenant(req.ctx).id, id, body(req) as SendInput);
      });

      // items
      staff.get("/items", BASE, async (req) => service.listItems(requireTenant(req.ctx).id, req.query as ListQuery));
      staff.get("/items/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.getItem(requireTenant(req.ctx).id, id);
      });
      staff.post("/items", BASE, async (req) => service.createItem(requireTenant(req.ctx).id, body(req) as ItemInput));
      staff.patch("/items/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.updateItem(requireTenant(req.ctx).id, id, body(req) as Partial<ItemInput>);
      });
      staff.delete("/items/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteItem(requireTenant(req.ctx).id, id);
        return { ok: true };
      });

      // reports
      staff.get("/reports/sales-trend", REPORTS, async (req, reply) => {
        const result = await service.salesTrend(requireTenant(req.ctx).id, query(req));
        if (!wantsCsv(req)) return result;
        return sendCsv(reply, csvBuilders.trend(result.items), "sales-trend", result.items[0]?.date, result.items.at(-1)?.date);
      });
      staff.get("/reports/sales-register", REPORTS, async (req, reply) => {
        const q = query(req) as ReportRange;
        const result = await service.salesRegister(requireTenant(req.ctx).id, q);
        return wantsCsv(req) ? sendCsv(reply, csvBuilders.salesRegister(result.items), "sales-register", q.from, q.to) : result;
      });
      staff.get("/reports/gst-summary", GST_REPORTS, async (req, reply) => {
        const q = query(req) as ReportRange;
        const result = await service.gstSummary(requireTenant(req.ctx).id, q);
        if (!wantsCsv(req)) return result;
        const { section } = gstCsvQuery.parse(query(req));
        return sendCsv(reply, csvBuilders.gst(result, section), `gst-${section}`, q.from, q.to);
      });
      staff.get("/reports/payments", REPORTS, async (req, reply) => {
        const q = query(req) as ReportRange;
        const result = await service.paymentsReport(requireTenant(req.ctx).id, q);
        return wantsCsv(req) ? sendCsv(reply, csvBuilders.payments(result.items), "payments", q.from, q.to) : result;
      });
      staff.get("/reports/ageing", REPORTS, async (req, reply) => {
        const result = await service.ageing(requireTenant(req.ctx).id, query(req));
        return wantsCsv(req) ? sendCsv(reply, csvBuilders.ageing(result.customers), "ageing", result.asOf) : result;
      });
      staff.get("/reports/top-items", REPORTS, async (req, reply) => {
        const q = query(req);
        const result = await service.topItems(requireTenant(req.ctx).id, q as unknown as TopQuery);
        return wantsCsv(req) ? sendCsv(reply, csvBuilders.topItems(result.items), "top-items", q.from, q.to) : result;
      });
      staff.get("/reports/top-customers", REPORTS, async (req, reply) => {
        const q = query(req);
        const result = await service.topCustomers(requireTenant(req.ctx).id, q as unknown as TopQuery);
        return wantsCsv(req) ? sendCsv(reply, csvBuilders.topCustomers(result.items), "top-customers", q.from, q.to) : result;
      });

      // credit notes (GST returns and value corrections against issued bills)
      staff.get("/credit-notes", BASE, async (req, reply) => {
        const q = query(req);
        const csv = wantsCsv(req);
        const result = await service.creditNotes.list(requireTenant(req.ctx).id, (csv ? { ...q, limit: "200" } : q) as CreditNoteListQuery);
        if (!csv) return result;
        return sendCsv(reply, csvBuilders.creditNotes(result.items), "credit-notes", q.from, q.to);
      });
      staff.get("/credit-notes/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.creditNotes.get(requireTenant(req.ctx).id, id);
      });
      staff.post("/credit-notes/:id/cancel", audited(FEATURES.base, { action: "invoices.credit_note.cancel", entity: "credit_note" }), async (req) => {
        const { id } = idParam.parse(req.params);
        const { reason } = cancelBody.parse(req.body ?? {});
        const user = requireUser(req.ctx);
        const res = await service.creditNotes.cancel(requireTenant(req.ctx).id, id, reason, user.id);
        req.auditSummary = `Credit note ${res.creditNote.number} cancelled`;
        return res;
      });
      staff.get(`${BILL_ID}/returnable`, BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.creditNotes.returnable(requireTenant(req.ctx).id, id);
      });
      staff.post(`${BILL_ID}/credit-notes`, audited(FEATURES.base, { action: "invoices.credit_note.issue", entity: "invoice" }), async (req) => {
        const { id } = idParam.parse(req.params);
        const user = requireUser(req.ctx);
        const res = await service.creditNotes.create(requireTenant(req.ctx).id, id, body(req) as CreditNoteInput, user.id);
        const cn = res.creditNote;
        req.auditSummary = `Credit note ${cn.number} for ${cn.invoiceNumber}: ${formatINR(cn.total)} (${cn.reason}, refund ${cn.refundMode}${cn.refundAmount ? ` ${formatINR(cn.refundAmount)}` : ""})`;
        return res;
      });

      // POS till sessions
      staff.get("/till/current", BASE, async (req) => {
        const { register } = registerQuery.parse(query(req));
        return { session: await service.till.current(requireTenant(req.ctx).id, { register, branchId: req.ctx.branch?.id ?? null }) };
      });
      staff.get("/till/sessions", REPORTS, async (req) => service.till.list(requireTenant(req.ctx).id, query(req) as TillListQuery));
      staff.post("/till/open", audited(FEATURES.base, { action: "invoices.till.open", entity: "till_session" }), async (req) => {
        const user = requireUser(req.ctx);
        const b = body(req);
        const session = await service.till.open(requireTenant(req.ctx).id, b as TillOpenInput, {
          branchId: req.ctx.branch?.id ?? null,
          actor: { id: user.id, name: actorName(b) },
        });
        req.auditSummary = `Till ${session.register} opened with ${formatINR(session.openingCash)}`;
        req.auditDetail = { entityId: session.id };
        return session;
      });
      staff.get("/till/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.till.get(requireTenant(req.ctx).id, id);
      });
      staff.get("/till/:id/x", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.till.report(requireTenant(req.ctx).id, id);
      });
      staff.post("/till/:id/cash", audited(FEATURES.base, { action: "invoices.till.cash", entity: "till_session" }), async (req) => {
        const { id } = idParam.parse(req.params);
        const user = requireUser(req.ctx);
        const b = body(req);
        const session = await service.till.cash(requireTenant(req.ctx).id, id, b as TillCashInput, { id: user.id, name: actorName(b) });
        const e = session.cashEntries.at(-1);
        if (e) req.auditSummary = `Cash ${e.amount > 0 ? "in" : "out"} ${formatINR(Math.abs(e.amount))}${e.reason ? `: ${e.reason}` : ""}`;
        return session;
      });
      staff.post("/till/:id/close", audited(FEATURES.base, { action: "invoices.till.close", entity: "till_session" }), async (req) => {
        const { id } = idParam.parse(req.params);
        const user = requireUser(req.ctx);
        const b = body(req);
        const res = await service.till.close(requireTenant(req.ctx).id, id, b as TillCloseInput, { id: user.id, name: actorName(b) });
        req.auditSummary = `Till ${res.session.register} closed: expected ${formatINR(res.session.expectedCash ?? 0)}, counted ${formatINR(res.session.countedCash ?? 0)}`;
        return res;
      });

      // invoices
      staff.get("/", BASE, async (req) => service.list(requireTenant(req.ctx).id, req.query as InvoiceListQuery));
      staff.get("/summary", BASE, async (req) => service.summary(requireTenant(req.ctx).id));
      staff.post("/", BASE, async (req) =>
        service.create(requireTenant(req.ctx), body(req) as InvoiceInput, { branchId: req.ctx.branch?.id ?? null }),
      );
      staff.get(BILL_ID, BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.get(requireTenant(req.ctx).id, id);
      });
      staff.patch(BILL_ID, BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.update(requireTenant(req.ctx), id, body(req) as Partial<InvoiceInput>);
      });
      staff.delete(BILL_ID, BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteDraft(requireTenant(req.ctx).id, id);
        return { ok: true };
      });
      staff.post(`${BILL_ID}/issue`, BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        const { loyaltyPoints } = issueBody.parse(body(req));
        return service.issue(requireTenant(req.ctx), id, {
          branchId: req.ctx.branch?.id ?? null,
          ...(loyaltyPoints !== undefined ? { loyaltyPoints } : {}),
        });
      });
      staff.post(`${BILL_ID}/cancel`, BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        const { reason } = cancelBody.parse(req.body ?? {});
        return service.cancel(requireTenant(req.ctx).id, id, reason);
      });
      staff.post(`${BILL_ID}/payments`, BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        const user = requireUser(req.ctx);
        return service.addPayment(requireTenant(req.ctx).id, id, body(req) as PaymentInput, user.id);
      });
      staff.delete(`${BILL_ID}/payments/:paymentId`, BASE, async (req) => {
        const { id, paymentId } = paymentParam.parse(req.params);
        return service.deletePayment(requireTenant(req.ctx).id, id, paymentId);
      });
      staff.post(`${BILL_ID}/share`, BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.share(requireTenant(req.ctx).id, id);
      });
      staff.post(`${BILL_ID}/send`, WHATSAPP, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.sendInvoice(requireTenant(req.ctx).id, id, body(req) as SendInput);
      });
    });
  };
}
