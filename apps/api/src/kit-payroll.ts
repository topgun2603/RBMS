import type { AuditEvent } from "@rbms/core";
import type { Db } from "@rbms/db";
import { page, type DocumentRegistry } from "@rbms/documents";
import { createPayroll, payslipBodyHtml, payslipFilename, PAYSLIP_CSS, type PayslipDoc } from "@rbms/payroll";

/** What the payroll wiring needs from the host's services (structural, so kit.ts passes its own objects). */
export interface PayrollWiring {
  db: Db;
  documents: {
    registry: DocumentRegistry;
    service: { render(tenantId: string, typeKey: string, id: string, opts?: { locale?: string }): Promise<{ pdf: Buffer | Uint8Array; filename: string }> };
  };
  /** Team members (staff.service.listMembers). */
  members: (tenantId: string) => Promise<{ userId: string; name: string | null; phone: string | null; active: boolean }[]>;
  /** The member behind a POS PIN (pos.service.memberForPin); created later in kit.ts, so reached lazily. */
  memberForPin: (tenantId: string, pin: string) => Promise<{ userId: string; name: string | null } | null>;
  /** Nudges the books (accounting.service.kick). */
  booksChanged: (tenantId: string) => void;
  audit: { record(e: AuditEvent): Promise<void> };
  /** Shop name and address printed on payslips (billing profile). */
  shop: (tenantId: string) => Promise<{ name: string; address: string | null }>;
  now?: () => Date;
  log: { info(o: unknown, m?: string): void; warn(o: unknown, m?: string): void; error(o: unknown, m?: string): void };
}

/**
 * Staff attendance and payroll (docs/payroll.md): the payroll module wired to POS PINs (check-in), the team list (link a
 * login), the audit log, the books (accounting reads `bookSources`; see kit-accounting.ts) and the payslip PDF
 * (`GET /v1/documents/payslip/<lineId>.pdf?locale=en|ta`, permission `payroll.manage`; staff get their own through
 * `/v1/payroll/me/payslips/:id/pdf`).
 */
export function wirePayroll(w: PayrollWiring) {
  const payroll = createPayroll({
    db: w.db,
    pins: { memberForPin: (tenantId, pin) => w.memberForPin(tenantId, pin) },
    members: { list: (tenantId) => w.members(tenantId) },
    payslipPdf: { render: (tenantId, lineId, locale) => w.documents.service.render(tenantId, "payslip", lineId, { locale }) },
    books: { changed: (tenantId) => w.booksChanged(tenantId) },
    audit: w.audit,
    now: w.now,
    log: w.log,
  });

  w.documents.registry.register<PayslipDoc>({
    key: "payslip",
    paper: "A4",
    feature: "payroll.salary",
    permission: "payroll.manage",
    async load(tenantId, id) {
      const data = await payroll.service.payslipData(tenantId, id);
      if (!data) return null;
      return { ...data, shop: await w.shop(tenantId) };
    },
    render: (data, ctx) =>
      page({
        title: `${ctx.locale === "ta" ? "சம்பளச் சீட்டு" : "Payslip"} ${data.line.snapshot.name} ${data.run.month}`,
        paper: "A4",
        locale: ctx.locale,
        branding: ctx.branding,
        css: PAYSLIP_CSS,
        body: payslipBodyHtml(data, ctx.locale),
      }),
    filename: (data) => payslipFilename(data),
    version: (data) => `${new Date(data.line.updatedAt).toISOString()}|${data.payment?.date ?? ""}`,
  });

  return payroll;
}
