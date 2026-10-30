import { aiMoney, type AiService, type AiSettings } from "@rbms/ai";
import type { SrModule } from "@rbms/core";
import type { Db } from "@rbms/db";
import type { DocumentRegistry, DocumentsService } from "@rbms/documents";
import type { Gstr2bService } from "@rbms/gstfiling";
import { isValidGstin, todayIST } from "@rbms/gst";
import type { InventoryService } from "@rbms/inventory";
import type { InvoicesService } from "@rbms/invoices";
import { gatherCashflow } from "./ai-money/cashflow-data";
import { gatherLoan } from "./ai-money/loan-data";
import { renderLoanPack, type LoanPackDoc } from "./ai-money/loan-doc";
import { gatherRisk } from "./ai-money/risk-data";

export interface AiMoneyKitDeps {
  db: Db;
  ai: AiService;
  invoices: Pick<InvoicesService, "ageing">;
  inventory: Pick<InventoryService, "stockReport" | "purchasing">;
  /** GSTR-2B reconciliation (read only: its summary and list). Null when the GST filing module is not mounted. */
  reco: () => Pick<Gstr2bService, "summary" | "list"> | null;
  documents: { registry: DocumentRegistry; service: Pick<DocumentsService, "render"> };
  /** The settings namespace "ai". */
  aiSettings: { get(scope: { tenantId: string }): Promise<unknown>; setTenant(tenantId: string, patch: never): Promise<unknown> };
  shopName: (tenantId: string) => Promise<string>;
  isEnabled: (tenantId: string, key: string) => Promise<boolean>;
  now?: () => Date;
}

const taxSum = (t: { igst: number; cgst: number; sgst: number; cess: number }) => t.igst + t.cgst + t.sgst + t.cess;

/**
 * Phase 5 part B wiring (docs/ai.md "Phase 5 part B: money"): credit risk score, cash-flow forecast, loan readiness pack and
 * GSTR-2B explanations. The SQL lives in ai-money/*.ts; the rules and wording live in packages/ai/src/money.
 */
export function createAiMoneyKit(d: AiMoneyKitDeps) {
  const now = d.now ?? (() => new Date());
  const today = () => todayIST(now());
  const readAi = async (tenantId: string) => (await d.aiSettings.get({ tenantId })) as AiSettings;

  const cashSettings = async (tenantId: string): Promise<aiMoney.CashflowSettings> => {
    const c = (await readAi(tenantId)).cashflow;
    return { openingBalance: c?.openingBalance ?? null, asOf: c?.asOf ?? null, asOfAt: c?.asOfAt ?? null, minBalance: c?.minBalance ?? 0 };
  };

  const ports: aiMoney.MoneyPorts = {
    today,
    now,
    aiSettings: readAi,
    risk: {
      all: (tenantId) => gatherRisk(d.db, tenantId, today()),
      one: async (tenantId, customerId) => (await gatherRisk(d.db, tenantId, today(), customerId))[0] ?? null,
    },
    cashflow: {
      data: async (tenantId) => gatherCashflow(d.db, tenantId, today(), await cashSettings(tenantId)),
      settings: cashSettings,
      saveSettings: async (tenantId, s) => {
        await d.aiSettings.setTenant(tenantId, { cashflow: s } as never);
      },
    },
    async loan(tenantId, opts) {
      const input = await gatherLoan(
        d.db,
        {
          ageing: async (t) => d.invoices.ageing(t),
          payables: async (t) => ((await d.isEnabled(t, "inventory.purchases").catch(() => false)) ? d.inventory.purchasing.payablesSummary(t) : null),
          stockValue: async (t) => ((await d.isEnabled(t, "inventory").catch(() => false)) ? (await d.inventory.stockReport(t)).totals.stockValue : null),
        },
        tenantId,
        today(),
        await cashSettings(tenantId),
        opts.showNames,
      );
      return { ...input, shopName: await d.shopName(tenantId) };
    },
    async reco2b(tenantId, month) {
      const reco = d.reco();
      if (!reco) return null;
      const s = await reco.summary(tenantId, month);
      if (!s.imported) return { month, imported: false, rows: [], totals: {} };
      const list = await reco.list(tenantId, month, { status: "fuzzy,amount_mismatch,missing_in_books", limit: 500 });
      const label = (r: { supplierName: string | null; supplierGstin: string }) => r.supplierName?.trim() || (r.supplierGstin ? `GSTIN ending ${r.supplierGstin.slice(-4)}` : "Supplier");
      const rows: aiMoney.MismatchRow[] = list.items
        .filter((r) => r.status === "fuzzy" || r.status === "amount_mismatch" || r.status === "missing_in_books")
        .map((r) => ({ group: r.status as aiMoney.MismatchGroup, supplier: label(r), number: r.docNumber, tax: taxSum(r.tax), date: r.docDate, diff: r.diff as Record<string, [unknown, unknown]> }));
      const missing = s.missingIn2b.map((m) => ({ group: "missing_in_2b" as const, supplier: m.party?.trim() || "Supplier", number: m.number, tax: taxSum(m.tax), date: m.date, gstinInvalid: !isValidGstin(m.gstin ?? "") }));
      const all = [...rows, ...missing];
      const totals: aiMoney.Reco2bData["totals"] = {};
      for (const g of aiMoney.MISMATCH_GROUPS) {
        const mine = all.filter((r) => r.group === g);
        const count = g === "missing_in_2b" ? (s.counts.missing_in_2b ?? mine.length) : (list.facets.status[g] ?? mine.length);
        if (count > 0) totals[g] = { count, tax: mine.reduce((a, r) => a + r.tax, 0) };
      }
      return { month, imported: true, rows: all, totals };
    },
    async pdf(tenantId, packId, locale) {
      const r = await d.documents.service.render(tenantId, "loan-pack", packId, { locale });
      return { pdf: r.pdf, filename: r.filename };
    },
  };

  const money = aiMoney.createAiMoney({ db: d.db, ai: d.ai, ports, now });

  // The PDF type. Staff route /v1/documents/loan-pack/<id>.pdf is for owners and admins (nobody holds this permission key
  // directly, so the documents route falls back to the owner / admin check).
  d.documents.registry.register<LoanPackDoc>({
    key: "loan-pack",
    paper: "A4",
    feature: "ai",
    permission: "ai.loan-pack",
    async load(tenantId, id) {
      const row = await money.packs.get(tenantId, id);
      if (!row) return null;
      return { id: row.id, createdAt: row.createdAt.toISOString(), shopName: row.shopName ?? "", showNames: row.showNames, facts: row.facts, cover: row.cover };
    },
    render: (data, ctx) => renderLoanPack(data, ctx),
    filename: (data) => `loan-summary-${data.createdAt.slice(0, 10)}.pdf`,
    version: (data) => data.createdAt,
  });

  return { module: money.module as SrModule, packs: money.packs, ports };
}
