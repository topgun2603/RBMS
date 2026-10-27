import { badRequest, requirePermission, requireRole, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { AssetService, YearEndService } from "./assets";
import type { BankService } from "./bank";
import type { ColumnMapping } from "./bank-import";
import { ACCOUNTING_FEATURE, ACCOUNTING_PERMISSION_KEYS as P, type AccountingPermission } from "./features";
import type { SourcesPort } from "./ports";
import { tableToCsv } from "./reports-logic";
import type { TdsService } from "./tds";
import { financialYearOf, parseFy } from "./tds-rules";

const ID = "/:id([0-9a-fA-F-]{36})";
const idParam = z.object({ id: z.string().uuid() });
const cfg = (permission: AccountingPermission) => ({ config: { feature: ACCOUNTING_FEATURE, permission } });
const UPLOAD_TYPES = [
  "application/octet-stream",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
  "text/html",
  "text/tab-separated-values",
];
const MAX_UPLOAD = 8 * 1024 * 1024;

function csv(reply: FastifyReply, name: string, body: string) {
  return reply
    .header("content-type", "text/csv; charset=utf-8")
    .header("content-disposition", `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}.csv"`)
    .send(body);
}

export interface PartBServices {
  bank: BankService;
  tds: TdsService;
  assets: AssetService;
  yearEnd: YearEndService;
  sources: SourcesPort;
  shopName?: (tenantId: string) => Promise<string>;
  today: () => string;
}

/**
 * Part B routes under /v1/accounting (feature `accounting`): bank reconciliation and cheques (`accounting.bank` to
 * change), TDS/TCS (`accounting.tds`), fixed assets and depreciation (`accounting.post`), year-end close
 * (`accounting.lock`). Everything is readable with `accounting.view`.
 */
export function partBRoutes(s: PartBServices) {
  return async (app: FastifyInstance) => {
    const guard = (ctx: RequestContext, permission: AccountingPermission) => {
      requireRole(ctx, "owner", "admin", "staff");
      requireTenant(ctx);
      requirePermission(ctx, permission);
      return requireTenant(ctx).id;
    };
    const uid = (ctx: RequestContext) => requireUser(ctx).id;
    const q = (req: { query: unknown }) => (req.query ?? {}) as Record<string, string | undefined>;
    const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
    const shop = async (t: string) => (await s.shopName?.(t)) ?? "";

    // ================================================================ bank
    app.get("/bank/accounts", cfg(P.view), async (req) => s.bank.accounts(guard(req.ctx, P.view)));

    await app.register(async (up) => {
      up.addContentTypeParser(UPLOAD_TYPES, { parseAs: "buffer", bodyLimit: MAX_UPLOAD }, (_req, b, done) => done(null, b));
      const opts = (req: { query: unknown; headers: Record<string, unknown> }) => {
        const v = q(req);
        let mapping: ColumnMapping | undefined;
        if (v.mapping) {
          try {
            const m = JSON.parse(v.mapping) as Record<string, unknown>;
            mapping = Object.fromEntries(Object.entries(m).filter(([, x]) => typeof x === "number" && Number.isInteger(x) && (x as number) >= -1 && (x as number) < 200)) as ColumnMapping;
          } catch {
            throw badRequest("mapping must be JSON: {\"date\":0,\"narration\":1,...}");
          }
        }
        const headerRow = v.headerRow !== undefined && v.headerRow !== "" ? Number(v.headerRow) : undefined;
        if (headerRow !== undefined && (!Number.isInteger(headerRow) || headerRow < 0 || headerRow > 500)) throw badRequest("headerRow must be a row number from 0");
        return {
          fileName: (req.headers["x-file-name"] as string | undefined) ? decodeURIComponent(String(req.headers["x-file-name"])) : v.fileName,
          mapping,
          headerRow,
          dateOrder: v.dateOrder === "mdy" ? ("mdy" as const) : ("dmy" as const),
          negativeIs: v.negativeIs === "deposit" ? ("deposit" as const) : ("withdrawal" as const),
        };
      };
      const bytes = (b: unknown) => {
        if (Buffer.isBuffer(b)) return new Uint8Array(b);
        if (typeof b === "string") return new TextEncoder().encode(b);
        throw badRequest("Send the statement file as the request body");
      };
      const audit = { config: { feature: ACCOUNTING_FEATURE, permission: P.bank, audit: false as const } };
      up.post("/bank/import/preview", { ...audit, bodyLimit: MAX_UPLOAD }, async (req) => {
        const t = guard(req.ctx, P.bank);
        return s.bank.preview(t, z.string().uuid().parse(q(req).accountId), bytes(req.body), opts(req));
      });
      up.post("/bank/import", { ...cfg(P.bank), bodyLimit: MAX_UPLOAD }, async (req) => {
        const t = guard(req.ctx, P.bank);
        return s.bank.import(t, z.string().uuid().parse(q(req).accountId), bytes(req.body), opts(req), uid(req.ctx));
      });
    });

    app.get("/bank/statements", cfg(P.view), async (req) => s.bank.statements(guard(req.ctx, P.view), z.string().uuid().parse(q(req).accountId)));
    app.delete(`/bank/statements${ID}`, cfg(P.bank), async (req) => s.bank.deleteStatement(guard(req.ctx, P.bank), idParam.parse(req.params).id));
    app.get("/bank/lines", cfg(P.view), async (req) => {
      const v = q(req);
      return s.bank.lines(guard(req.ctx, P.view), { accountId: v.accountId ?? "", status: v.status, from: v.from, to: v.to, q: v.q, limit: Number(v.limit ?? 100), offset: Number(v.offset ?? 0) });
    });
    app.get("/bank/workspace", cfg(P.view), async (req) => {
      const v = q(req);
      return s.bank.workspace(guard(req.ctx, P.view), { accountId: v.accountId ?? "", from: v.from, to: v.to });
    });
    app.get("/bank/matches", cfg(P.view), async (req) => s.bank.matchedGroups(guard(req.ctx, P.view), z.string().uuid().parse(q(req).accountId), { limit: Number(q(req).limit ?? 50) }));
    app.post("/bank/match", cfg(P.bank), async (req) => s.bank.match(guard(req.ctx, P.bank), body(req) as never, uid(req.ctx)));
    app.post("/bank/auto-match", cfg(P.bank), async (req) => {
      const b = body(req);
      return s.bank.autoMatch(guard(req.ctx, P.bank), { accountId: z.string().uuid().parse(b.accountId), minConfidence: b.minConfidence as number | undefined }, uid(req.ctx));
    });
    app.delete(`/bank/matches${ID}`, cfg(P.bank), async (req) => s.bank.unmatch(guard(req.ctx, P.bank), idParam.parse(req.params).id, { userId: uid(req.ctx) }));
    app.post(`/bank/lines${ID}/entry`, cfg(P.bank), async (req) => s.bank.createEntry(guard(req.ctx, P.bank), idParam.parse(req.params).id, body(req) as never, uid(req.ctx)));
    app.delete(`/bank/lines${ID}/entry`, cfg(P.bank), async (req) => s.bank.cancelCreatedEntry(guard(req.ctx, P.bank), idParam.parse(req.params).id, uid(req.ctx)));
    app.post(`/bank/lines${ID}/exclude`, cfg(P.bank), async (req) => {
      const b = z.object({ excluded: z.boolean().default(true), note: z.string().trim().max(200).nullish() }).strict().parse(body(req));
      return s.bank.setExcluded(guard(req.ctx, P.bank), idParam.parse(req.params).id, b.excluded, b.note ?? null);
    });
    app.get("/bank/reconciliation", cfg(P.view), async (req, reply) => {
      const t = guard(req.ctx, P.view);
      const v = q(req);
      if (v.format === "csv") return csv(reply, `bank-reconciliation-${v.asOf ?? "today"}`, tableToCsv(await s.bank.reconciliationTable(t, v, await shop(t))));
      return s.bank.reconciliation(t, { accountId: v.accountId ?? "", asOf: v.asOf, bankBalance: v.bankBalance ?? null });
    });
    app.post("/bank/reconciliation/confirm", cfg(P.bank), async (req) => s.bank.confirm(guard(req.ctx, P.bank), body(req) as never, uid(req.ctx)));
    app.post("/bank/reconciliation/reopen", cfg(P.bank), async (req) => s.bank.reopen(guard(req.ctx, P.bank), body(req) as never));

    // ---- cheque register
    app.get("/cheques", cfg(P.view), async (req) => s.bank.cheques(guard(req.ctx, P.view), q(req)));
    app.post("/cheques", cfg(P.bank), async (req) => s.bank.createCheque(guard(req.ctx, P.bank), body(req) as never, uid(req.ctx)));
    app.patch(`/cheques${ID}`, cfg(P.bank), async (req) => s.bank.updateCheque(guard(req.ctx, P.bank), idParam.parse(req.params).id, body(req) as never));
    app.post(`/cheques${ID}/action`, cfg(P.bank), async (req) => s.bank.chequeAction(guard(req.ctx, P.bank), idParam.parse(req.params).id, body(req) as never, uid(req.ctx)));
    app.get(`/cheques${ID}/candidates`, cfg(P.view), async (req) => s.bank.chequeCandidates(guard(req.ctx, P.view), idParam.parse(req.params).id));

    // ================================================================ TDS / TCS
    app.get("/tds/settings", cfg(P.view), async (req) => s.tds.getSettings(guard(req.ctx, P.view)));
    app.patch("/tds/settings", cfg(P.tds), async (req) => s.tds.updateSettings(guard(req.ctx, P.tds), body(req) as never));
    app.get("/tds/parties", cfg(P.view), async (req) => {
      const v = q(req);
      const type = v.type === "customer" ? "customer" : "supplier";
      return s.tds.parties(guard(req.ctx, P.view), type, { search: v.q?.slice(0, 100), limit: Number(v.limit ?? 50) });
    });
    app.put("/tds/parties/:type(supplier|customer)/:id([0-9a-fA-F-]{36})", cfg(P.tds), async (req) => {
      const p = z.object({ type: z.enum(["supplier", "customer"]), id: z.string().uuid() }).parse(req.params);
      return s.tds.setParty(guard(req.ctx, P.tds), p.type, p.id, body(req) as never);
    });
    app.get("/tds/compute", cfg(P.view), async (req) => {
      const v = q(req);
      return s.tds.compute(guard(req.ctx, P.view), {
        section: v.section ?? "",
        partyType: v.partyType ?? "supplier",
        partyId: v.partyId && z.string().uuid().safeParse(v.partyId).success ? v.partyId : null,
        base: Number(v.base ?? 0),
        date: v.date,
        sourceType: v.sourceType,
        sourceId: v.sourceId ?? null,
        pan: v.pan ?? null,
      });
    });
    app.get("/tds/documents", cfg(P.view), async (req) => {
      const t = guard(req.ctx, P.view);
      const v = q(req);
      const fy = (v.fy && parseFy(v.fy)) || financialYearOf(s.today());
      if (v.type === "expense") {
        const items = (await s.sources.expenses(t))
          .filter((e) => e.status === "recorded" && e.date >= fy.from && e.date <= fy.to)
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 300)
          .map((e) => ({ id: e.id, date: e.date, label: `${e.categoryName}${e.vendorName ? ` - ${e.vendorName}` : ""}`, amount: e.amount, base: e.amount - e.itc, method: e.paymentMethod }));
        return { items };
      }
      const supplierId = v.supplierId && z.string().uuid().safeParse(v.supplierId).success ? v.supplierId : null;
      const items = (await s.sources.purchases(t))
        .filter((p) => p.status === "recorded" && !p.imported && (!supplierId || p.supplierId === supplierId) && p.date >= fy.from && p.date <= fy.to)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 300)
        .map((p) => ({ id: p.id, date: p.date, label: `${p.billNumber} - ${p.supplierName}`, supplierId: p.supplierId, amount: p.total, base: p.total - p.cgst - p.sgst - p.igst - p.roundOff }));
      return { items };
    });
    app.get("/tds/entries", cfg(P.view), async (req) => s.tds.entries(guard(req.ctx, P.view), q(req)));
    app.post("/tds/entries", cfg(P.tds), async (req) => s.tds.createEntry(guard(req.ctx, P.tds), body(req) as never, uid(req.ctx)));
    app.post(`/tds/entries${ID}/cancel`, cfg(P.tds), async (req) => s.tds.cancelEntry(guard(req.ctx, P.tds), idParam.parse(req.params).id, body(req) as never, uid(req.ctx)));
    app.get("/tds/candidates", cfg(P.view), async (req) => s.tds.candidates(guard(req.ctx, P.view), q(req)));
    app.get("/tds/challans", cfg(P.view), async (req) => s.tds.challans(guard(req.ctx, P.view), q(req)));
    app.post("/tds/challans", cfg(P.tds), async (req) => s.tds.createChallan(guard(req.ctx, P.tds), body(req) as never, uid(req.ctx)));
    app.post(`/tds/challans${ID}/cancel`, cfg(P.tds), async (req) => s.tds.cancelChallan(guard(req.ctx, P.tds), idParam.parse(req.params).id, body(req) as never, uid(req.ctx)));
    app.get("/tds/payable", cfg(P.view), async (req) => s.tds.payable(guard(req.ctx, P.view), q(req)));
    app.get("/tds/quarterly", cfg(P.view), async (req, reply) => {
      const t = guard(req.ctx, P.view);
      const data = await s.tds.quarterly(t, q(req));
      if (q(req).format === "csv") return csv(reply, `${data.form}-${data.quarter}`, tableToCsv(s.tds.quarterlyTable(data, await shop(t))));
      return data;
    });
    app.get("/tds/calendar", cfg(P.view), async (req) => s.tds.calendar(guard(req.ctx, P.view)));

    // ================================================================ fixed assets and depreciation
    app.get("/assets", cfg(P.view), async (req) => s.assets.list(guard(req.ctx, P.view), q(req)));
    app.get("/assets/schedule", cfg(P.view), async (req) => s.assets.schedule(guard(req.ctx, P.view), q(req)));
    app.post("/assets", cfg(P.post), async (req) => s.assets.create(guard(req.ctx, P.post), body(req) as never, uid(req.ctx)));
    app.get(`/assets${ID}`, cfg(P.view), async (req) => s.assets.get(guard(req.ctx, P.view), idParam.parse(req.params).id));
    app.patch(`/assets${ID}`, cfg(P.post), async (req) => s.assets.update(guard(req.ctx, P.post), idParam.parse(req.params).id, body(req) as never));
    app.post(`/assets${ID}/dispose`, cfg(P.post), async (req) => s.assets.dispose(guard(req.ctx, P.post), idParam.parse(req.params).id, body(req) as never, uid(req.ctx)));
    app.get("/depreciation/preview", cfg(P.view), async (req) => s.assets.preview(guard(req.ctx, P.view), q(req).upTo ?? ""));
    app.post("/depreciation/run", cfg(P.post), async (req) => s.assets.run(guard(req.ctx, P.post), body(req) as never, uid(req.ctx)));
    app.get("/depreciation/runs", cfg(P.view), async (req) => s.assets.runs(guard(req.ctx, P.view)));
    app.post(`/depreciation/runs${ID}/cancel`, cfg(P.post), async (req) => s.assets.cancelRun(guard(req.ctx, P.post), idParam.parse(req.params).id, uid(req.ctx)));

    // ================================================================ year-end close
    app.get("/year-end", cfg(P.view), async (req) => s.yearEnd.preview(guard(req.ctx, P.view), q(req)));
    app.post("/year-end/close", cfg(P.lock), async (req) => s.yearEnd.close(guard(req.ctx, P.lock), body(req) as never, uid(req.ctx)));
    app.post("/year-end/reopen", cfg(P.lock), async (req) => s.yearEnd.reopen(guard(req.ctx, P.lock), body(req) as never, uid(req.ctx)));
  };
}
