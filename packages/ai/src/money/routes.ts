import { AppError, badRequest, hasPermission, notFound, requirePermission, requireRole, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RateLimiter } from "../assist/routes";
import type { AiRunner } from "../assist/hsn";
import { AI_FEATURE, AI_PERMISSION_KEYS, type AiSettings } from "../features";
import { buildCashflow, writeCashflow, type CashflowInput, type DueBill } from "./cashflow";
import { explain2b, GROUP_TITLE, groupMismatches, type MismatchGroup, type MismatchRow } from "./explain2b";
import { buildLoanPack, LOAN_DISCLAIMER, LOAN_SECTIONS, writeCover, type LoanPackInput } from "./loanpack";
import { packView, type PackStore } from "./packs";
import { explainRisk, scoreCredit, type RiskBand, type RiskInput, type RiskResult } from "./risk";

/**
 * Phase 5 part B routes, under /v1/ai/money (docs/ai.md "Phase 5 part B: money").
 *
 *   GET  /credit-risk                    band + score of every credit customer (badges)            invoices.credit-book
 *   GET  /credit-risk/:customerId        score, top 3 factors, suggested limit, hint                invoices.credit-book
 *   POST /credit-risk/:customerId/explain {lang}   one light-tier sentence (number-checked)        + ai.use
 *   GET  /cashflow                       the 30-day forecast facts (no AI)                          reports.view
 *   POST /cashflow/explain {lang}        plain note + 2 suggestions (AI with ai.use, else template) reports.view
 *   GET/PUT /cashflow/settings           opening balance, warning level                            reports.view / owner, admin
 *   GET  /loan-pack/consent              exactly what a pack includes                               owner, admin
 *   POST /loan-pack {consent:true, showNames, lang}   make a pack                                   owner, admin
 *   GET  /loan-pack, /loan-pack/:id      earlier packs                                              owner, admin
 *   POST /loan-pack/:id/share {days}, DELETE /loan-pack/:id/share                                   owner, admin
 *   GET  /public/loan-pack/:token.pdf    the expiring link (no sign-in)
 *   POST /gst-2b/:month/explain {lang}   explain the mismatch groups of an imported GSTR-2B       reports.view
 */

export const MONEY_PERMISSIONS = { creditBook: "invoices.credit-book", reports: "reports.view" } as const;

export interface RiskSubject {
  customerId: string;
  name: string;
  input: RiskInput;
}

export interface CashflowRaw extends Omit<CashflowInput, "dues"> {
  dues: (Omit<DueBill, "band" | "lateDays"> & { customerId: string | null })[];
}

export interface Reco2bData {
  month: string;
  imported: boolean;
  rows: MismatchRow[];
  totals: Partial<Record<MismatchGroup, { count: number; tax: number }>>;
}

export interface CashflowSettings {
  /** Paise in hand (cash + bank) on `asOf`; null = not entered. */
  openingBalance: number | null;
  asOf: string | null;
  /** When it was entered (ISO time): money moving after this is added to it. */
  asOfAt: string | null;
  /** Paise; the warning level. */
  minBalance: number;
}

export interface MoneyPorts {
  today(): string;
  now(): Date;
  aiSettings(tenantId: string): Promise<AiSettings>;
  risk: {
    all(tenantId: string): Promise<RiskSubject[]>;
    one(tenantId: string, customerId: string): Promise<RiskSubject | null>;
  };
  cashflow: {
    data(tenantId: string): Promise<CashflowRaw>;
    settings(tenantId: string): Promise<CashflowSettings>;
    saveSettings(tenantId: string, s: CashflowSettings): Promise<void>;
  };
  loan(tenantId: string, opts: { showNames: boolean }): Promise<LoanPackInput & { shopName: string }>;
  reco2b(tenantId: string, month: string): Promise<Reco2bData | null>;
  /** The PDF of a pack (documents renderer). */
  pdf(tenantId: string, packId: string, locale: "en" | "ta"): Promise<{ pdf: Buffer; filename: string }>;
}

export interface MoneyRouteDeps {
  ai: AiRunner;
  packs: PackStore;
  ports: MoneyPorts;
  limiter?: RateLimiter;
  /** How long a computed credit-risk list is reused (ms). */
  riskTtlMs?: number;
}

const lang = z.enum(["en", "ta"]);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const idParam = z.object({ id: z.string().uuid() });
const explainBody = z.object({ lang: lang.default("en") });
const settingsBody = z.object({
  openingBalance: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000).nullable(),
  minBalance: z.number().int().min(0).max(1_000_000_000_000).default(0),
});
const packBody = z.object({ consent: z.literal(true), showNames: z.boolean().default(false), lang: lang.default("en") });
const shareBody = z.object({ days: z.number().int().min(1).max(30).default(7) });

const use = { config: { feature: AI_FEATURE } };
const publicPdf = { config: { audit: false as const } };

const bandOf = (r: RiskResult): RiskBand => r.band;

export function moneyRoutes(d: MoneyRouteDeps) {
  const limiter = d.limiter ?? new RateLimiter();
  const ttl = d.riskTtlMs ?? 30_000;
  const cache = new Map<string, { at: number; list: { subject: RiskSubject; result: RiskResult }[] }>();

  const scoreAll = async (tenantId: string) => {
    const hit = cache.get(tenantId);
    if (hit && Date.now() - hit.at < ttl) return hit.list;
    const subjects = await d.ports.risk.all(tenantId);
    const list = subjects.map((s) => ({ subject: s, result: scoreCredit(s.input) }));
    cache.set(tenantId, { at: Date.now(), list });
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
    return list;
  };

  return async (app: FastifyInstance) => {
    const who = (req: { ctx: RequestContext }, route: string, max: number, ...permissions: string[]) => {
      requireUser(req.ctx);
      requireRole(req.ctx, "owner", "admin", "staff");
      const tenantId = requireTenant(req.ctx).id;
      const userId = req.ctx.user?.id ?? null;
      for (const p of permissions) requirePermission(req.ctx, p);
      limiter.check(`${tenantId}:${userId}:${route}`, max, 60_000);
      return { tenantId, userId, canAi: hasPermission(req.ctx, AI_PERMISSION_KEYS.use) };
    };
    const ownerOnly = (req: { ctx: RequestContext }, route: string, max: number) => {
      requireUser(req.ctx);
      requireRole(req.ctx, "owner", "admin");
      const tenantId = requireTenant(req.ctx).id;
      const userId = req.ctx.user?.id ?? null;
      limiter.check(`${tenantId}:${userId}:${route}`, max, 60_000);
      return { tenantId, userId, canAi: hasPermission(req.ctx, AI_PERMISSION_KEYS.use) };
    };
    const parse = <T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> => {
      const r = schema.safeParse(body ?? {});
      if (!r.success) throw badRequest(r.error.issues[0]?.message ?? "Invalid request");
      return r.data;
    };
    /** The helper's own switch (settings ai.features). Off = the helper is gone for this shop. */
    const switchOn = async (tenantId: string, key: string) => {
      const s = await d.ports.aiSettings(tenantId);
      if (s.features[key] === false) throw new AppError(403, "ai_feature_off", "This helper is switched off in Settings > AI.");
    };
    /** AI wording is attempted only for people who may spend credits; everyone else gets the template. */
    const runner = (canAi: boolean): AiRunner | null => (canAi ? d.ai : null);

    // ------------------------------------------------------------ credit risk
    app.get("/credit-risk", use, async (req) => {
      const { tenantId } = who(req, "risk-all", 30, MONEY_PERMISSIONS.creditBook);
      await switchOn(tenantId, "credit-risk");
      const list = await scoreAll(tenantId);
      return {
        // Only people who have bought on credit (customers who always pay at the counter are not credit customers).
        items: list.filter(({ result }) => result.metrics.creditBills > 0 || result.metrics.openAmount > 0).map(({ subject, result }) => ({
          customerId: subject.customerId,
          band: bandOf(result),
          score: result.score,
          enough: result.enough,
          openAmount: result.metrics.openAmount,
          overdueAmount: result.metrics.overdueAmount,
        })),
      };
    });

    app.get("/credit-risk/:customerId", use, async (req) => {
      const { tenantId } = who(req, "risk-one", 60, MONEY_PERMISSIONS.creditBook);
      await switchOn(tenantId, "credit-risk");
      const { customerId } = parse(z.object({ customerId: z.string().uuid() }), req.params);
      const subject = await d.ports.risk.one(tenantId, customerId);
      if (!subject) throw notFound("Customer");
      return { customerId, ...scoreCredit(subject.input) };
    });

    app.post("/credit-risk/:customerId/explain", use, async (req) => {
      const { tenantId, userId, canAi } = who(req, "risk-explain", 12, MONEY_PERMISSIONS.creditBook);
      await switchOn(tenantId, "credit-risk");
      const { customerId } = parse(z.object({ customerId: z.string().uuid() }), req.params);
      const b = parse(explainBody, req.body);
      const subject = await d.ports.risk.one(tenantId, customerId);
      if (!subject) throw notFound("Customer");
      const result = scoreCredit(subject.input);
      return explainRisk(runner(canAi), { tenantId, userId, result, lang: b.lang });
    });

    // ------------------------------------------------------------ cash-flow
    const forecast = async (tenantId: string) => {
      const raw = await d.ports.cashflow.data(tenantId);
      const risk = await scoreAll(tenantId).catch(() => []);
      const byCustomer = new Map(risk.map((x) => [x.subject.customerId, x.result]));
      const dues: DueBill[] = raw.dues.map((x) => {
        const r = x.customerId ? byCustomer.get(x.customerId) : undefined;
        const { customerId: _c, ...rest } = x;
        void _c;
        return { ...rest, band: r ? r.band : "new", lateDays: r && r.enough ? r.metrics.avgDaysLate : null };
      });
      return buildCashflow({ ...raw, dues });
    };

    app.get("/cashflow", use, async (req) => {
      const { tenantId } = who(req, "cashflow", 20, MONEY_PERMISSIONS.reports);
      await switchOn(tenantId, "cashflow-forecast");
      return forecast(tenantId);
    });

    app.post("/cashflow/explain", use, async (req) => {
      const { tenantId, userId, canAi } = who(req, "cashflow-explain", 8, MONEY_PERMISSIONS.reports);
      await switchOn(tenantId, "cashflow-forecast");
      const b = parse(explainBody, req.body);
      const facts = await forecast(tenantId);
      return writeCashflow(runner(canAi), { tenantId, userId, facts, lang: b.lang });
    });

    app.get("/cashflow/settings", use, async (req) => {
      const { tenantId } = who(req, "cashflow-settings", 30, MONEY_PERMISSIONS.reports);
      return d.ports.cashflow.settings(tenantId);
    });
    app.put("/cashflow/settings", use, async (req) => {
      const { tenantId } = ownerOnly(req, "cashflow-settings-save", 10);
      const b = parse(settingsBody, req.body);
      const next: CashflowSettings = { openingBalance: b.openingBalance, asOf: b.openingBalance === null ? null : d.ports.today(), asOfAt: b.openingBalance === null ? null : d.ports.now().toISOString(), minBalance: b.minBalance };
      await d.ports.cashflow.saveSettings(tenantId, next);
      return next;
    });

    // ------------------------------------------------------------ loan pack
    app.get("/loan-pack/consent", use, async (req) => {
      const { tenantId } = ownerOnly(req, "loan-consent", 30);
      await switchOn(tenantId, "loan-pack");
      return { sections: LOAN_SECTIONS, disclaimer: LOAN_DISCLAIMER, shared: false, notSent: true };
    });

    app.post("/loan-pack", use, async (req) => {
      const { tenantId, userId, canAi } = ownerOnly(req, "loan-make", 4);
      await switchOn(tenantId, "loan-pack");
      const b = parse(packBody, req.body);
      const input = await d.ports.loan(tenantId, { showNames: b.showNames });
      const facts = buildLoanPack(input);
      const cover = await writeCover(runner(canAi), { tenantId, userId, facts, shop: input.shopName });
      const row = await d.packs.create(tenantId, { facts, cover: { en: cover.en, ta: cover.ta, source: cover.source }, showNames: b.showNames, shopName: input.shopName, credits: cover.credits, userId });
      return { ...packView(row, d.ports.now()), coverFallbackReason: cover.fallbackReason };
    });

    app.get("/loan-pack", use, async (req) => {
      const { tenantId } = ownerOnly(req, "loan-list", 30);
      const rows = await d.packs.list(tenantId, 10);
      return { items: rows.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), showNames: r.showNames, shareActive: packView(r, d.ports.now()).share.active })) };
    });

    app.get("/loan-pack/:id", use, async (req) => {
      const { tenantId } = ownerOnly(req, "loan-get", 60);
      const { id } = parse(idParam, req.params);
      const row = await d.packs.get(tenantId, id);
      if (!row) throw notFound("Pack");
      return packView(row, d.ports.now());
    });

    app.post("/loan-pack/:id/share", use, async (req) => {
      const { tenantId } = ownerOnly(req, "loan-share", 10);
      const { id } = parse(idParam, req.params);
      const b = parse(shareBody, req.body);
      const row = await d.packs.share(tenantId, id, b.days);
      if (!row) throw notFound("Pack");
      const v = packView(row, d.ports.now());
      return { token: v.share.token, expiresAt: v.share.expiresAt, path: `/v1/ai/money/public/loan-pack/${v.share.token}.pdf` };
    });

    app.delete("/loan-pack/:id/share", use, async (req) => {
      const { tenantId } = ownerOnly(req, "loan-revoke", 20);
      const { id } = parse(idParam, req.params);
      const row = await d.packs.revoke(tenantId, id);
      if (!row) throw notFound("Pack");
      return { ok: true };
    });

    app.get("/public/loan-pack/:file", publicPdf, async (req, reply) => {
      const { file } = parse(z.object({ file: z.string().max(100) }), req.params);
      const m = /^([A-Za-z0-9_-]{20,64})\.pdf$/.exec(file);
      if (!m) throw notFound("Pack");
      const q = parse(z.object({ locale: lang.optional() }), req.query);
      const row = await d.packs.byToken(m[1]!);
      if (!row) throw new AppError(404, "link_expired", "This link has expired or was withdrawn.");
      const doc = await d.ports.pdf(row.tenantId, row.id, q.locale ?? "en");
      return reply
        .header("content-type", "application/pdf")
        .header("content-disposition", `inline; filename="${doc.filename.replace(/"/g, "")}"`)
        .header("cache-control", "private, no-store")
        .header("x-content-type-options", "nosniff")
        .header("x-robots-tag", "noindex")
        .send(doc.pdf);
    });

    // ------------------------------------------------------------ GSTR-2B explanations
    app.post("/gst-2b/:month/explain", use, async (req) => {
      const { tenantId, userId, canAi } = who(req, "gst2b-explain", 8, MONEY_PERMISSIONS.reports);
      await switchOn(tenantId, "gst-2b-explain");
      const { month: m } = parse(z.object({ month }), req.params);
      const b = parse(explainBody, req.body);
      const data = await d.ports.reco2b(tenantId, m);
      if (!data || !data.imported) throw new AppError(404, "gstr2b_not_imported", "Import the GSTR-2B file for this month first.");
      const groups = groupMismatches(data.rows, data.totals);
      const r = await explain2b(runner(canAi), { tenantId, userId, groups, lang: b.lang });
      const line = new Map(r.lines.map((l) => [l.group, l]));
      return {
        month: m,
        groups: groups.map((g) => ({ ...g, title: GROUP_TITLE[g.group], text: line.get(g.group)?.text ?? "", source: line.get(g.group)?.source ?? "template" })),
        aiNote: r.aiNote,
        runId: r.runId,
        credits: r.credits,
      };
    });
  };
}
