/**
 * Proforma invoices, sale orders and delivery challans together (docs/sales-documents.md): the three services, what a
 * quotation turns into, what happens when a bill made from them is issued or cancelled, the "made from" links on a
 * bill, the public share page and the data the PDFs print.
 */
import { AppError, notFound, type TenantRef } from "@rbms/core";
import { amountInWordsINR, type LineTotals } from "@rbms/gst";
import { ChallansService, type ChallanSummary } from "./challans";
import { ProformasService, type Proforma, type ProformaSummary } from "./proformas";
import type { CustomerSnapshot, SellerProfile } from "./ports";
import { SaleOrdersService, type SaleOrder, type SaleOrderSummary } from "./sale-orders";
import { SalesDocsCore, type SalesDocsDeps } from "./sales-docs-base";
import { advanceFor, challanDisplayStatus, challanNet, proformaDisplayStatus } from "./sales-docs-calc";
import type { ChallanReason, ChallanRow, ChallanTransport, ProformaRow, SaleOrderRow, SalesDocKind } from "./schema-sales";
import type { Quotation } from "./quotations";
import { toLineInput } from "./service";

/** The data the PDF renderers print (structurally `SalesDocData` of @rbms/documents). */
export interface SalesDocData {
  kind: SalesDocKind;
  id: string;
  number: string;
  status: string;
  date: string;
  customer: CustomerSnapshot;
  seller: SellerProfile;
  placeOfSupply: string;
  interState: boolean;
  lines: LineTotals[];
  totals: ProformaRow["totals"];
  amountInWords: string;
  notes: string | null;
  terms: string | null;
  updatedAt: Date;
  /** Proforma. */
  validUntil?: string | null;
  deliveryText?: string | null;
  advancePercent?: number | null;
  advanceAmount?: number;
  advanceReceived?: number;
  quotationNumber?: string | null;
  /** Sale order. */
  promisedDate?: string | null;
  customerRef?: string | null;
  /** Ordered / delivered per line (sale order). */
  progress?: { description: string; unit: string | null; ordered: number; delivered: number }[];
  /** Challan. */
  reason?: ChallanReason;
  returnBy?: string | null;
  shipTo?: string | null;
  transport?: ChallanTransport;
  ewbNo?: string | null;
  ewbDate?: string | null;
  saleOrderNumber?: string | null;
  invoiceNumber?: string | null;
  /** Returned so far (challan). */
  returned?: { description: string; unit: string | null; qty: number }[];
}

export type SalesDocPublicSeller = Omit<SellerProfile, "autoReminders" | "reminderDays" | "sendPaymentReceipts" | "invoicePrefix" | "terms">;

/** What the customer sees at /d/:token (no ids, no internal notes beyond what the PDF prints). */
export interface PublicSalesDoc {
  kind: SalesDocKind;
  token: string;
  doc: Omit<SalesDocData, "id" | "seller" | "updatedAt"> & { seller: SalesDocPublicSeller };
  branding: { appName: string | null; logoUrl: string | null; css: string };
}

const publicSeller = ({ autoReminders: _a, reminderDays: _r, sendPaymentReceipts: _s, invoicePrefix: _i, terms: _t, ...rest }: SellerProfile): SalesDocPublicSeller => rest;

export class SalesDocsService {
  readonly core: SalesDocsCore;
  readonly proformas: ProformasService;
  readonly challans: ChallansService;
  readonly saleOrders: SaleOrdersService;

  constructor(deps: SalesDocsDeps) {
    this.core = new SalesDocsCore(deps);
    this.proformas = new ProformasService(this.core);
    this.challans = new ChallansService(this.core);
    this.saleOrders = new SaleOrdersService(this.core, this.challans);
    this.challans.onOrderChange = (tenantId, ids) => this.saleOrders.refresh(tenantId, ids);
  }

  settings(tenantId: string) {
    return this.core.settings(tenantId);
  }

  /** Figures for the lists' headers and the dashboard. */
  async summary(tenantId: string) {
    const [proformas, saleOrders, challans] = await Promise.all([
      this.proformas.summary(tenantId),
      this.saleOrders.summary(tenantId),
      this.challans.summary(tenantId),
    ]);
    return { proformas, saleOrders, challans };
  }

  // ---------------------------------------------------------------- quotations

  /**
   * A proforma or sale order from a quotation (its customer, lines, terms, advance %). Used by the quotation's
   * "Convert" (QuotationSalesDocsPort); the quotation then links to it.
   */
  async fromQuotation(
    tenant: TenantRef,
    quote: Quotation,
    kind: "proforma" | "sale_order",
    ctx: { userId?: string | null; branchId?: string | null },
  ): Promise<{ id: string; number: string }> {
    const base = {
      ...(quote.customerId ? { customerId: quote.customerId } : { customer: { name: quote.customer.name, phone: quote.customer.phone, email: quote.customer.email, gstin: quote.customer.gstin, address: quote.customer.address, stateCode: quote.customer.stateCode } }),
      placeOfSupply: quote.placeOfSupply,
      lines: quote.lines.map(toLineInput),
      notes: quote.notes,
      terms: quote.terms,
      advancePercent: quote.advancePercent,
    };
    const opts = { branchId: ctx.branchId ?? quote.branchId, userId: ctx.userId ?? null, quotation: { id: quote.id, number: quote.rev > 1 ? `${quote.number} (rev ${quote.rev})` : quote.number } };
    if (kind === "proforma") {
      const p = await this.proformas.create(tenant, { ...base, deliveryText: quote.deliveryText, issue: true }, opts);
      return { id: p.id, number: p.number };
    }
    const o = await this.saleOrders.create(tenant, base, opts);
    return { id: o.id, number: o.number };
  }

  /** Whether the proforma / sale order a quotation was converted into still stands (not cancelled). */
  async isLive(tenantId: string, kind: "proforma" | "sale_order", id: string): Promise<boolean> {
    if (kind === "proforma") {
      const p = await this.proformas.rowFor(tenantId, id);
      return Boolean(p) && p!.status !== "cancelled";
    }
    const o = await this.saleOrders.rowFor(tenantId, id);
    return Boolean(o) && o!.status !== "cancelled";
  }

  // ---------------------------------------------------------------- bill events

  /** A bill made from a proforma / sale order was issued (now or later from its draft): the advances go onto it. */
  async onInvoiceIssued(tenantId: string, invoiceId: string): Promise<number> {
    const [proformaIds, orderIds] = await Promise.all([this.proformas.idsForInvoice(tenantId, invoiceId), this.saleOrders.idsForInvoice(tenantId, invoiceId)]);
    const ids = [...proformaIds, ...orderIds];
    if (ids.length === 0) return 0;
    if (orderIds.length) await this.saleOrders.refresh(tenantId, orderIds);
    return this.core.deps.invoices.applyAdvances(tenantId, invoiceId, ids);
  }

  /** A bill was cancelled: its challans become billable again and its sale orders reopen what it billed. */
  async onInvoiceCancelled(tenantId: string, invoiceId: string, number: string | null): Promise<void> {
    const viaChallans = await this.challans.onInvoiceCancelled(tenantId, invoiceId, number);
    const direct = await this.saleOrders.idsForInvoice(tenantId, invoiceId);
    const ids = [...new Set([...viaChallans, ...direct])];
    if (ids.length) await this.saleOrders.refresh(tenantId, ids);
  }

  /** "Made from" on a bill: the proforma, sale orders and challans behind it. */
  async linked(tenantId: string, invoiceId: string): Promise<{ proforma: ProformaSummary | null; saleOrders: SaleOrderSummary[]; challans: ChallanSummary[] }> {
    const [proforma, saleOrders, challans] = await Promise.all([
      this.proformas.forInvoice(tenantId, invoiceId),
      this.saleOrders.forInvoice(tenantId, invoiceId),
      this.challans.forInvoice(tenantId, invoiceId),
    ]);
    return { proforma, saleOrders, challans };
  }

  // ---------------------------------------------------------------- documents

  private proformaDoc(r: ProformaRow, received: number): SalesDocData {
    return {
      kind: "proforma",
      id: r.id,
      number: r.number,
      status: proformaDisplayStatus(r, this.core.today()),
      date: r.date,
      customer: r.customer,
      seller: r.seller,
      placeOfSupply: r.placeOfSupply,
      interState: r.interState,
      lines: r.lines,
      totals: r.totals,
      amountInWords: amountInWordsINR(r.total),
      notes: r.notes,
      terms: r.terms,
      updatedAt: r.updatedAt,
      validUntil: r.validUntil,
      deliveryText: r.deliveryText,
      advancePercent: r.advancePercent,
      advanceAmount: advanceFor(r.total, r.advancePercent),
      advanceReceived: received,
      quotationNumber: r.quotationNumber,
    };
  }

  private async orderDoc(r: SaleOrderRow): Promise<SalesDocData> {
    const progress = await this.saleOrders.progressOf(r);
    const received = (await this.core.deps.invoices.advancesAgainst(r.tenantId, [r.id])).reduce((s, a) => s + a.amount, 0);
    return {
      kind: "sale_order",
      id: r.id,
      number: r.number,
      status: r.status,
      date: r.date,
      customer: r.customer,
      seller: r.seller,
      placeOfSupply: r.placeOfSupply,
      interState: r.interState,
      lines: r.lines,
      totals: r.totals,
      amountInWords: amountInWordsINR(r.total),
      notes: r.notes,
      terms: r.terms,
      updatedAt: r.updatedAt,
      promisedDate: r.promisedDate,
      customerRef: r.customerRef,
      advancePercent: r.advancePercent,
      advanceAmount: advanceFor(r.total, r.advancePercent),
      advanceReceived: received,
      quotationNumber: r.quotationNumber,
      progress: progress.map((p) => ({ description: p.description, unit: p.unit, ordered: p.ordered, delivered: p.delivered })),
    };
  }

  private async challanDoc(r: ChallanRow): Promise<SalesDocData> {
    const bills = await this.core.bills(r.tenantId, r.invoiceId ? [r.invoiceId] : []);
    const gone = r.status === "invoiced" && !SalesDocsCore.live(r.invoiceId ? bills.get(r.invoiceId) : undefined);
    const net = challanNet(r);
    const byKey = new Map(r.lines.map((l) => [l.key, l]));
    return {
      kind: "challan",
      id: r.id,
      number: r.number,
      status: challanDisplayStatus(r, gone),
      date: r.date,
      customer: r.customer,
      seller: r.seller,
      placeOfSupply: r.placeOfSupply,
      interState: r.interState,
      lines: r.lines,
      totals: r.totals,
      amountInWords: amountInWordsINR(r.total),
      notes: r.notes,
      terms: r.terms,
      updatedAt: r.updatedAt,
      reason: r.reason,
      returnBy: r.returnBy,
      shipTo: r.shipTo,
      transport: r.transport,
      ewbNo: r.ewbNo,
      ewbDate: r.ewbDate,
      saleOrderNumber: r.saleOrderNumber,
      invoiceNumber: gone ? null : r.invoiceNumber,
      returned: net.filter((n) => n.returned > 0).map((n) => ({ description: byKey.get(n.key)!.description, unit: byKey.get(n.key)!.unit ?? null, qty: n.returned })),
    };
  }

  /** PDF data of a document (staff). Null when unknown. */
  async docData(kind: SalesDocKind, tenantId: string, id: string): Promise<SalesDocData | null> {
    if (kind === "proforma") {
      const r = await this.proformas.rowFor(tenantId, id);
      return r ? this.proformaDoc(r, (await this.proformas.advanceTotals(tenantId, id)).received) : null;
    }
    if (kind === "sale_order") {
      const r = await this.saleOrders.rowFor(tenantId, id);
      return r ? this.orderDoc(r) : null;
    }
    const r = await this.challans.rowFor(tenantId, id);
    return r ? this.challanDoc(r) : null;
  }

  private async rowByToken(token: string, requestTenantId: string | null): Promise<{ kind: SalesDocKind; tenantId: string; data: SalesDocData } | null> {
    const p = await this.proformas.byToken(token, requestTenantId);
    if (p) return { kind: "proforma", tenantId: p.tenantId, data: this.proformaDoc(p, (await this.proformas.advanceTotals(p.tenantId, p.id)).received) };
    const o = await this.saleOrders.byToken(token, requestTenantId);
    if (o) return { kind: "sale_order", tenantId: o.tenantId, data: await this.orderDoc(o) };
    const c = await this.challans.byToken(token, requestTenantId);
    if (c) return { kind: "challan", tenantId: c.tenantId, data: await this.challanDoc(c) };
    return null;
  }

  /** PDF data behind a share link (customer); the shop's own terms of the bill are not printed. */
  async publicDocData(token: string): Promise<{ tenantId: string; doc: SalesDocData } | null> {
    try {
      const found = await this.rowByToken(token, null);
      return found ? { tenantId: found.tenantId, doc: { ...found.data, seller: { ...found.data.seller, terms: null } } } : null;
    } catch {
      return null;
    }
  }

  /** What the customer sees at /d/:token. */
  async getPublic(token: string, requestTenantId: string | null = null): Promise<PublicSalesDoc> {
    const found = await this.rowByToken(token, requestTenantId);
    if (!found) throw notFound("Document");
    const { id: _id, seller, updatedAt: _u, ...rest } = found.data;
    return { kind: found.kind, token, doc: { ...rest, seller: publicSeller(seller) }, branding: await this.core.publicBranding(found.tenantId) };
  }

  /** For routes that act on "this document" by kind. */
  static assertKind(kind: string): SalesDocKind {
    if (kind === "proforma" || kind === "sale_order" || kind === "challan") return kind;
    throw new AppError(404, "not_found", "Unknown document type");
  }
}

export type { Proforma, SaleOrder };
