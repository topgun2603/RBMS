/**
 * "Export all my data": a zip of CSV (and Excel for the smaller datasets) of everything the shop entered, built in the
 * background and kept for a few days behind a signed link. Datasets come from a port the API kit implements over the
 * services/tables; this module only zips and stores them.
 */
import { badRequest, notFound, type AuditEvent } from "@rbms/core";
import type { ExportColumn } from "./columns";
import { csvLine } from "./csv";
import type { LoggerPort, QueuePort } from "./service";
import type { ExportJobRow } from "./schema";
import type { ExportJobStore } from "./store";
import { buildTallyVouchersXml, TALLY_EXCEL_HEADERS, tallyExcelRows, type TallyVoucher } from "./tally";
import { xlsxStream, type XlsxValue } from "./xlsx";
import { makeZip, type ZipEntry } from "./zip";

export const EXPORT_ALL_JOB = "importexport.export-all";

export interface ExportDataset {
  /** File name stem, e.g. "invoices". */
  key: string;
  label: string;
  columns: ExportColumn<Record<string, unknown>>[];
  rows: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>;
}

export interface FullExportPort {
  /** Datasets the shop has access to (features/permissions already applied). */
  datasets(tenantId: string): Promise<ExportDataset[]>;
  /** Shop name for the README and Tally company. */
  company(tenantId: string): Promise<string | null>;
  /** Sales/purchase vouchers in a date range (inclusive, YYYY-MM-DD). */
  vouchers(tenantId: string, q: { kind: "sale" | "purchase"; from: string; to: string }): AsyncIterable<TallyVoucher>;
}

/** Object storage for the finished zip. */
export interface FilePort {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Time-limited download URL. */
  url(key: string, opts: { downloadName: string; expiresIn: number }): Promise<string>;
  delete(key: string): Promise<void>;
}

export interface AuditPortLike {
  record(e: AuditEvent): Promise<void>;
}

export interface FullExportLimits {
  /** Largest dataset (rows) that also gets an .xlsx (all get a CSV). */
  xlsxMaxRows: number;
  /** Rows per dataset in the zip. */
  maxRows: number;
  /** Days the download link keeps working. */
  keepDays: number;
}

export const DEFAULT_EXPORT_LIMITS: FullExportLimits = { xlsxMaxRows: 50_000, maxRows: 2_000_000, keepDays: 7 };

const cell = (col: ExportColumn<Record<string, unknown>>, row: Record<string, unknown>): XlsxValue => {
  const v = col.value ? col.value(row) : row[col.key];
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.join(", ");
  if (v instanceof Date || typeof v !== "object") return v as XlsxValue;
  return JSON.stringify(v);
};

async function* iterate<R>(src: AsyncIterable<R> | Iterable<R>): AsyncGenerator<R> {
  for await (const r of src as AsyncIterable<R>) yield r;
}

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string));
  return Buffer.concat(chunks);
}

export class FullExportService {
  readonly limits: FullExportLimits;

  constructor(
    private readonly deps: {
      store: ExportJobStore;
      port: FullExportPort;
      files: FilePort;
      queue?: QueuePort;
      audit?: AuditPortLike;
      log?: LoggerPort;
      limits?: Partial<FullExportLimits>;
    },
  ) {
    this.limits = { ...DEFAULT_EXPORT_LIMITS, ...deps.limits };
    deps.queue?.define<{ tenantId: string; jobId: string }>(EXPORT_ALL_JOB, (d) => this.run(d.tenantId, d.jobId), { attempts: 1 });
  }

  /** Starts an export (one at a time per shop). */
  async start(tenantId: string, userId: string | null, ctx: { ip?: string | null; userAgent?: string | null } = {}) {
    void this.purgeExpired([tenantId]).catch(() => undefined); // keeps old zips from piling up in storage
    const running = await this.deps.store.active(tenantId);
    if (running) return toView(running);
    const job = await this.deps.store.create(tenantId, userId);
    void this.deps.audit?.record({
      tenantId,
      actorUserId: userId,
      action: "data.export.requested",
      entityType: "export_job",
      entityId: job.id,
      summary: "Requested a full data export",
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    } as AuditEvent);
    if (this.deps.queue) await this.deps.queue.enqueue(EXPORT_ALL_JOB, { tenantId, jobId: job.id }, { jobId: `export-all-${job.id}` });
    else await this.run(tenantId, job.id);
    return toView((await this.deps.store.get(tenantId, job.id)) ?? job);
  }

  async run(tenantId: string, jobId: string): Promise<void> {
    const ok = await this.deps.store.update(tenantId, jobId, { status: "running", startedAt: new Date() }, ["queued"]);
    if (!ok) return;
    try {
      const { port } = this.deps;
      const [datasets, company] = await Promise.all([port.datasets(tenantId), port.company(tenantId)]);
      const entries: ZipEntry[] = [];
      const counts: Record<string, number> = {};
      for (const ds of datasets) {
        const cols = ds.columns;
        const csv: string[] = ["﻿" + csvLine(cols.map((c) => c.label))];
        const keepXlsx = this.limits.xlsxMaxRows;
        const xl = xlsxStream(ds.label.slice(0, 31) || ds.key, cols.map((c) => ({ header: c.label, numFmt: c.numFmt, width: c.width })));
        const xlDone = collect(xl.stream);
        let n = 0;
        let xlOk = true;
        for await (const row of iterate(ds.rows)) {
          if (++n > this.limits.maxRows) throw badRequest(`${ds.label} has too many rows to export`);
          csv.push(csvLine(cols.map((c) => cell(c, row))));
          if (n <= keepXlsx) xl.write(cols.map((c) => cell(c, row)));
          else xlOk = false;
        }
        await xl.end();
        const xlBuf = await xlDone;
        counts[ds.key] = n;
        entries.push({ name: `${ds.key}.csv`, data: Buffer.from(csv.join(""), "utf8") });
        if (xlOk && n > 0) entries.push({ name: `${ds.key}.xlsx`, data: xlBuf });
      }
      const now = new Date();
      entries.unshift({
        name: "README.txt",
        data: Buffer.from(
          [
            `Data export${company ? ` of ${company}` : ""}`,
            `Created ${now.toISOString()}`,
            "",
            "Each dataset is a CSV file (UTF-8, opens in Excel) and, for datasets up to " + this.limits.xlsxMaxRows + " rows, an Excel file.",
            "Amounts are in rupees. Dates are YYYY-MM-DD. invoice-lines.csv has one row per bill line.",
            "",
            ...datasets.map((d) => `${d.key}: ${d.label} (${counts[d.key] ?? 0} rows)`),
            "",
            "The link to this file stops working after " + this.limits.keepDays + " days; export again any time.",
          ].join("\r\n"),
          "utf8",
        ),
      });
      const zip = makeZip(entries);
      const fileName = `${(company ?? "shop").replace(/[^\w-]+/g, "_").slice(0, 40)}-data-${now.toISOString().slice(0, 10)}.zip`;
      const key = `exports/${tenantId}/${jobId}.zip`;
      await this.deps.files.put(key, zip, "application/zip");
      await this.deps.store.update(tenantId, jobId, {
        status: "done",
        fileKey: key,
        fileName,
        fileSize: zip.length,
        counts,
        finishedAt: new Date(),
        expiresAt: new Date(Date.now() + this.limits.keepDays * 86_400_000),
      });
    } catch (err) {
      this.deps.log?.error({ err, jobId }, "importexport: full export failed");
      await this.deps.store.update(tenantId, jobId, { status: "failed", error: "The export failed. Please try again.", finishedAt: new Date() });
    }
  }

  async get(tenantId: string, id: string) {
    const j = await this.deps.store.get(tenantId, id);
    if (!j) throw notFound("Export");
    return toView(j);
  }

  async list(tenantId: string) {
    return { items: (await this.deps.store.list(tenantId, 10)).map(toView) };
  }

  private async ready(tenantId: string, id: string) {
    const j = await this.deps.store.get(tenantId, id);
    if (!j) throw notFound("Export");
    if (j.status !== "done" || !j.fileKey) throw badRequest("This export is not ready");
    if (j.expiresAt && j.expiresAt.getTime() < Date.now()) {
      await this.deps.store.update(tenantId, id, { status: "expired" });
      throw badRequest("This export has expired; request a new export");
    }
    return j as ExportJobRow & { fileKey: string };
  }

  /** The finished zip itself (streamed through the API, so it works with any storage driver); audited. */
  async file(tenantId: string, id: string, userId: string | null, ctx: { ip?: string | null; userAgent?: string | null } = {}) {
    const j = await this.ready(tenantId, id);
    const data = await this.deps.files.get(j.fileKey);
    this.auditDownload(tenantId, id, userId, ctx);
    return { data, fileName: j.fileName ?? "data.zip" };
  }

  /** Signed link to the finished zip (object-storage drivers); the download is audited. */
  async download(tenantId: string, id: string, userId: string | null, ctx: { ip?: string | null; userAgent?: string | null } = {}) {
    const j = await this.ready(tenantId, id);
    const url = await this.deps.files.url(j.fileKey, { downloadName: j.fileName ?? "data.zip", expiresIn: 600 });
    this.auditDownload(tenantId, id, userId, ctx);
    return { url, fileName: j.fileName, expiresAt: j.expiresAt };
  }

  private auditDownload(tenantId: string, id: string, userId: string | null, ctx: { ip?: string | null; userAgent?: string | null }) {
    void this.deps.audit?.record({
      tenantId,
      actorUserId: userId,
      action: "data.export.downloaded",
      entityType: "export_job",
      entityId: id,
      summary: "Downloaded the full data export",
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    } as AuditEvent);
  }

  /** Removes finished zips past their expiry (call from a daily job). */
  async purgeExpired(tenantIds: string[]): Promise<number> {
    let n = 0;
    for (const t of tenantIds) {
      for (const j of await this.deps.store.list(t, 50)) {
        if (j.status === "done" && j.fileKey && j.expiresAt && j.expiresAt.getTime() < Date.now()) {
          await this.deps.files.delete(j.fileKey).catch(() => undefined);
          await this.deps.store.update(t, j.id, { status: "expired", fileKey: null });
          n++;
        }
      }
    }
    return n;
  }

  // ---- Tally-compatible voucher export

  async tallyXml(tenantId: string, q: { kind: "sale" | "purchase"; from: string; to: string }) {
    const company = await this.deps.port.company(tenantId);
    const vouchers: TallyVoucher[] = [];
    for await (const v of this.deps.port.vouchers(tenantId, q)) vouchers.push(v);
    return { xml: buildTallyVouchersXml(vouchers, company), count: vouchers.length, filename: `tally-${q.kind === "sale" ? "sales" : "purchase"}-vouchers-${q.from}-to-${q.to}.xml` };
  }

  async tallyXlsx(tenantId: string, q: { kind: "sale" | "purchase"; from: string; to: string }) {
    const vouchers: TallyVoucher[] = [];
    for await (const v of this.deps.port.vouchers(tenantId, q)) vouchers.push(v);
    const x = xlsxStream("Vouchers", TALLY_EXCEL_HEADERS.map((h) => ({ header: h })));
    const done = collect(x.stream);
    for (const r of tallyExcelRows(vouchers)) x.write(r);
    await x.end();
    return { data: await done, count: vouchers.length, filename: `tally-${q.kind === "sale" ? "sales" : "purchase"}-vouchers-${q.from}-to-${q.to}.xlsx` };
  }
}

export interface ExportJobView {
  id: string;
  status: ExportJobRow["status"];
  fileName: string | null;
  fileSize: number | null;
  counts: Record<string, number>;
  error: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  finishedAt: Date | null;
}

function toView(j: ExportJobRow): ExportJobView {
  const expired = j.status === "done" && j.expiresAt && j.expiresAt.getTime() < Date.now();
  return {
    id: j.id,
    status: expired ? "expired" : j.status,
    fileName: j.fileName,
    fileSize: j.fileSize,
    counts: j.counts ?? {},
    error: j.error,
    expiresAt: j.expiresAt,
    createdAt: j.createdAt,
    finishedAt: j.finishedAt,
  };
}
