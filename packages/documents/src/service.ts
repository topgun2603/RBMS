import { notFound } from "@srirealtime/core";
import type { PdfDriver } from "./driver";
import { invoiceFilename, quotationFilename, salesDocFilename } from "./builtins";
import { normalizeLocale } from "./labels";
import type { DocumentRegistry } from "./registry";
import { renderInvoice } from "./renderers/invoice";
import { renderQuotation } from "./renderers/quotation";
import { renderSalesDoc } from "./renderers/sales-doc";
import type { Branding, BrandingPort, DocLocale, InvoiceDocPort, LoggerPort, QuotationDocPort, SalesDocPort } from "./types";

export interface RenderedDocument {
  pdf: Buffer;
  filename: string;
}

export const DEFAULT_BRANDING: Branding = { appName: null, logoUrl: null, css: "", primary: "#0f766e" };

export function mergeBranding(b: Partial<Branding> | null | undefined): Branding {
  return {
    appName: b?.appName ?? null,
    logoUrl: b?.logoUrl ?? null,
    css: b?.css ?? "",
    primary: b?.primary ?? DEFAULT_BRANDING.primary,
  };
}

export class DocumentsService {
  constructor(
    readonly registry: DocumentRegistry,
    private readonly deps: {
      driver: PdfDriver;
      branding?: BrandingPort;
      invoices?: InvoiceDocPort;
      quotations?: QuotationDocPort;
      salesDocs?: SalesDocPort;
      log: LoggerPort;
      timeoutMs?: number;
    },
  ) {}

  async branding(tenantId: string | null | undefined): Promise<Branding> {
    if (!tenantId || !this.deps.branding) return DEFAULT_BRANDING;
    try {
      return mergeBranding(await this.deps.branding.get(tenantId));
    } catch (err) {
      this.deps.log.warn({ err, tenantId }, "documents: branding lookup failed");
      return DEFAULT_BRANDING;
    }
  }

  /** HTML of a document (useful for previews and tests). */
  async renderHtml(
    tenantId: string,
    typeKey: string,
    id: string,
    opts: { locale?: string; query?: Record<string, string | undefined> } = {},
  ): Promise<{ html: string; filename: string; paper: string }> {
    const type = this.registry.get(typeKey);
    if (!type) throw notFound("Document type");
    const locale: DocLocale = normalizeLocale(opts.locale);
    const data = await type.load(tenantId, id, { locale, query: opts.query ?? {} });
    if (!data) throw notFound("Document");
    const html = type.render(data, { locale, branding: await this.branding(tenantId) });
    return { html, filename: type.filename(data, locale), paper: type.paper };
  }

  async render(
    tenantId: string,
    typeKey: string,
    id: string,
    opts: { locale?: string; query?: Record<string, string | undefined> } = {},
  ): Promise<RenderedDocument> {
    const type = this.registry.get(typeKey);
    if (!type) throw notFound("Document type");
    const { html, filename } = await this.renderHtml(tenantId, typeKey, id, opts);
    const pdf = await this.deps.driver.render(html, { paper: type.paper, timeoutMs: this.deps.timeoutMs });
    return { pdf, filename };
  }

  /** PDF of a publicly shared invoice (share token). */
  async renderPublicInvoice(token: string, opts: { locale?: string } = {}): Promise<RenderedDocument> {
    const port = this.deps.invoices;
    if (!port) throw notFound("Invoice");
    const found = await port.publicInvoice(token);
    if (!found) throw notFound("Invoice");
    const locale = normalizeLocale(opts.locale);
    const branding = found.branding ? mergeBranding(found.branding) : await this.branding(found.tenantId);
    const html = renderInvoice(found.invoice, { locale, branding });
    const pdf = await this.deps.driver.render(html, { paper: "A4", timeoutMs: this.deps.timeoutMs });
    return { pdf, filename: invoiceFilename(found.invoice) };
  }

  /** PDF of a publicly shared quotation (share token). */
  async renderPublicQuotation(token: string, opts: { locale?: string } = {}): Promise<RenderedDocument> {
    const port = this.deps.quotations;
    if (!port) throw notFound("Quotation");
    const found = await port.publicQuotation(token);
    if (!found) throw notFound("Quotation");
    const locale = normalizeLocale(opts.locale);
    const branding = found.branding ? mergeBranding(found.branding) : await this.branding(found.tenantId);
    const html = renderQuotation(found.quotation, { locale, branding });
    const pdf = await this.deps.driver.render(html, { paper: "A4", timeoutMs: this.deps.timeoutMs });
    return { pdf, filename: quotationFilename(found.quotation) };
  }

  /** PDF of a publicly shared proforma invoice, sale order or delivery challan (share token). */
  async renderPublicSalesDoc(token: string, opts: { locale?: string } = {}): Promise<RenderedDocument> {
    const port = this.deps.salesDocs;
    if (!port) throw notFound("Document");
    const found = await port.publicDoc(token);
    if (!found) throw notFound("Document");
    const locale = normalizeLocale(opts.locale);
    const branding = found.branding ? mergeBranding(found.branding) : await this.branding(found.tenantId);
    const html = renderSalesDoc(found.doc, { locale, branding });
    const pdf = await this.deps.driver.render(html, { paper: "A4", timeoutMs: this.deps.timeoutMs });
    return { pdf, filename: salesDocFilename(found.doc) };
  }

  /** Renders arbitrary HTML (e.g. a type registered elsewhere) through the driver. */
  htmlToPdf(html: string, paper: "A4" | "80mm" | "58mm" | "A6" = "A4"): Promise<Buffer> {
    return this.deps.driver.render(html, { paper, timeoutMs: this.deps.timeoutMs });
  }
}
