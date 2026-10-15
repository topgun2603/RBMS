import { Readable } from "node:stream";
import { AppError, badRequest, conflict, featureDisabled, notFound, type FeatureGatePort } from "@srirealtime/core";
import { rupees, type ExportColumn } from "./columns";
import { CsvError, csvLine, parseCsv } from "./csv";
import { autoMap, missingRequired, parseRows, resolveMapping, type DetectedColumn, type Mapping, type ParsedRow } from "./engine";
import type { ImportExportRegistry, ImporterDef } from "./registry";
import type { ImportJobStatus, ImportJobSummary } from "./schema";
import type { ImportJob, ImportJobStore } from "./store";
import { XlsxError, readXlsx, writeXlsx, xlsxStream, type XlsxValue } from "./xlsx";

export const COMMIT_JOB = "importexport.commit";

export interface LoggerPort {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}
export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };

/** Background queue (the jobs module's service satisfies it). */
export interface QueuePort {
  define<T>(name: string, handler: (data: T) => Promise<void>, opts?: { attempts?: number }): void;
  enqueue<T>(name: string, data: T, opts?: { delayMs?: number; jobId?: string }): Promise<void>;
}

export interface ImportExportLimits {
  /** Upload size limit in bytes (default 10 MB). */
  maxBytes: number;
  /** Data rows per file (default 20 000). */
  maxRows: number;
  /** Rows returned by preview (default 50). */
  previewRows: number;
  /** Row errors stored per job (default 1000). */
  maxErrors: number;
}

export const DEFAULT_LIMITS: ImportExportLimits = { maxBytes: 10 * 1024 * 1024, maxRows: 20_000, previewRows: 50, maxErrors: 1000 };

export interface UploadedFile {
  fileName: string | null;
  contentType: string | null;
  data: Buffer;
}

export interface PreviewResult {
  jobId: string;
  key: string;
  fileName: string | null;
  columns: DetectedColumn[];
  mapping: Mapping;
  /** Labels of required columns the file doesn't have. */
  missing: string[];
  rows: { row: number; data: Record<string, unknown>; errors: string[]; raw: string[] }[];
  totals: { rows: number; valid: number; invalid: number };
}

export interface JobStatus {
  jobId: string;
  key: string;
  status: ImportJobStatus;
  fileName: string | null;
  total: number;
  valid: number;
  invalid: number;
  processed: number;
  created: number;
  updated: number;
  failed: number;
  skipped: number;
  errors: { row: number; message: string }[];
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

const emptySummary = (): ImportJobSummary => ({ rows: 0, valid: 0, invalid: 0, processed: 0, created: 0, updated: 0, failed: 0, skipped: 0 });

const XLSX_TYPES = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];

/** csv or xlsx from the content type, the file name, then the bytes (xlsx is a zip: "PK\x03\x04"). */
export function detectFileType(file: UploadedFile): "csv" | "xlsx" {
  const ct = file.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  const name = file.fileName?.toLowerCase() ?? "";
  const zip = file.data.length >= 4 && file.data[0] === 0x50 && file.data[1] === 0x4b && file.data[2] === 0x03 && file.data[3] === 0x04;
  if (XLSX_TYPES.includes(ct) || name.endsWith(".xlsx")) {
    if (!zip) throw badRequest("This file is not a valid .xlsx workbook");
    return "xlsx";
  }
  if (name.endsWith(".xls") && !zip) throw badRequest("Old .xls files aren't supported; save as .xlsx or CSV");
  return zip ? "xlsx" : "csv";
}

/** UTF-8 (with or without BOM); falls back to Windows-1252 for files saved by old Excel versions. */
export function decodeText(data: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return new TextDecoder("windows-1252").decode(data);
  }
}

const exportCell = (col: ExportColumn<Record<string, unknown>>, row: Record<string, unknown>): XlsxValue => {
  const v = col.value ? col.value(row) : row[col.key];
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.join(", ");
  if (v instanceof Date || typeof v !== "object") return v as XlsxValue;
  return JSON.stringify(v);
};

async function* iterate<R>(src: AsyncIterable<R> | Iterable<R> | Promise<Iterable<R>>): AsyncGenerator<R> {
  const s = await src;
  for await (const r of s as AsyncIterable<R>) yield r;
}

export class ImportExportService {
  readonly limits: ImportExportLimits;

  constructor(
    readonly registry: ImportExportRegistry,
    private readonly deps: { store: ImportJobStore; queue?: QueuePort; features?: FeatureGatePort; log?: LoggerPort; limits?: Partial<ImportExportLimits> },
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...deps.limits };
    deps.queue?.define<{ tenantId: string; jobId: string }>(COMMIT_JOB, (d) => this.run(d.tenantId, d.jobId), { attempts: 1 });
  }

  private get log() {
    return this.deps.log ?? noopLogger;
  }

  private importer(key: string): ImporterDef<Record<string, unknown>> {
    const imp = this.registry.importer(key);
    if (!imp) throw notFound("Importer");
    return imp;
  }

  /** Checks the importer's own feature for tenant-less paths (commit/status use a generic route). */
  private async assertFeature(tenantId: string, feature: string | undefined) {
    if (!feature || !this.deps.features) return;
    if (!(await this.deps.features.isEnabled(tenantId, feature))) throw featureDisabled(feature, "dependency");
  }

  /** Reads an uploaded CSV/XLSX into a header row + data rows, enforcing the size and row limits. */
  async readTable(file: UploadedFile): Promise<{ headers: string[]; data: string[][]; type: "csv" | "xlsx" }> {
    if (!file.data.length) throw badRequest("The file is empty");
    if (file.data.length > this.limits.maxBytes) {
      throw new AppError(413, "file_too_large", `The file is larger than ${Math.round(this.limits.maxBytes / 1024 / 1024)} MB`);
    }
    const type = detectFileType(file);
    let table: string[][];
    try {
      table = type === "xlsx" ? await readXlsx(file.data, { maxRows: this.limits.maxRows + 1 }) : parseCsv(decodeText(file.data), { maxRows: this.limits.maxRows + 1 });
    } catch (err) {
      if (err instanceof CsvError || err instanceof XlsxError) {
        if (/Too many rows/.test(err.message)) throw new AppError(413, "too_many_rows", `The file has more than ${this.limits.maxRows} rows; split it into smaller files`);
        throw badRequest(err.message);
      }
      throw err;
    }
    const [headerRow, ...rest] = table;
    if (!headerRow?.some((h) => h.trim())) throw badRequest("The file has no header row");
    const headers = headerRow.map((h) => h.trim());
    const data = rest.map((r) => r.map((c) => c ?? "")).filter((r) => r.some((c) => c.trim() !== ""));
    if (!data.length) throw badRequest("The file has a header row but no data rows");
    return { headers, data, type };
  }

  private parseAll(imp: ImporterDef<Record<string, unknown>>, data: string[][], mapping: Mapping): ParsedRow[] {
    return parseRows(data, imp.columns, mapping, imp.validate);
  }

  async preview(tenantId: string, userId: string | null, key: string, file: UploadedFile): Promise<PreviewResult> {
    const imp = this.importer(key);
    const { headers, data, type } = await this.readTable(file);
    const { mapping, detected } = autoMap(headers, imp.columns);
    const parsed = this.parseAll(imp, data, mapping);
    const invalid = parsed.filter((r) => r.errors.length).length;
    const summary = { ...emptySummary(), rows: parsed.length, valid: parsed.length - invalid, invalid };
    const job = await this.deps.store.create({
      tenantId,
      key,
      fileName: file.fileName?.slice(0, 200) ?? null,
      fileType: type,
      fileSize: file.data.length,
      mapping,
      rows: { headers, data },
      summary,
      createdBy: userId,
    });
    return {
      jobId: job.id,
      key,
      fileName: job.fileName,
      columns: detected,
      mapping,
      missing: missingRequired(imp.columns, mapping).map((c) => c.label),
      rows: parsed.slice(0, this.limits.previewRows),
      totals: { rows: summary.rows, valid: summary.valid, invalid },
    };
  }

  /** Starts the import of a previewed job (via the queue when present, otherwise inline). */
  async commit(
    tenantId: string,
    jobId: string,
    opts: { mapping?: Record<string, string | number | null>; skipInvalid?: boolean } = {},
  ): Promise<JobStatus> {
    const job = await this.deps.store.get(tenantId, jobId);
    if (!job) throw notFound("Import job");
    const imp = this.importer(job.key);
    await this.assertFeature(tenantId, imp.feature);
    if (job.status !== "preview" || !job.rows) throw conflict("This import was already started");
    let mapping: Mapping;
    try {
      mapping = resolveMapping(job.rows.headers, imp.columns, opts.mapping, job.mapping);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    const missing = missingRequired(imp.columns, mapping);
    if (missing.length) throw badRequest(`Map the required columns: ${missing.map((c) => c.label).join(", ")}`, { missing: missing.map((c) => c.key) });
    const parsed = this.parseAll(imp, job.rows.data, mapping);
    const invalidRows = parsed.filter((r) => r.errors.length);
    const skipInvalid = opts.skipInvalid ?? true;
    if (invalidRows.length && !skipInvalid) {
      throw badRequest(`${invalidRows.length} row(s) have errors; fix them or import with skipInvalid`, {
        errors: invalidRows.slice(0, 50).map((r) => ({ row: r.row, message: r.errors.join("; ") })),
      });
    }
    if (invalidRows.length === parsed.length) throw badRequest("No valid rows to import");
    const summary = { ...emptySummary(), rows: parsed.length, valid: parsed.length - invalidRows.length, invalid: invalidRows.length };
    const ok = await this.deps.store.update(tenantId, jobId, { status: "queued", mapping, skipInvalid, summary }, ["preview"]);
    if (!ok) throw conflict("This import was already started");
    if (this.deps.queue) await this.deps.queue.enqueue(COMMIT_JOB, { tenantId, jobId }, { jobId: `import-${jobId}` });
    else await this.run(tenantId, jobId);
    return this.status(tenantId, jobId);
  }

  /** Runs a queued job. Never throws: failures are recorded on the job. */
  async run(tenantId: string, jobId: string): Promise<void> {
    const started = await this.deps.store.update(tenantId, jobId, { status: "running", startedAt: new Date() }, ["queued"]);
    if (!started) return;
    const job = await this.deps.store.get(tenantId, jobId);
    if (!job?.rows) return;
    const summary: ImportJobSummary = { ...job.summary, processed: 0, created: 0, updated: 0, failed: 0, skipped: 0 };
    const errors: { row: number; message: string }[] = [];
    const addError = (row: number, message: string) => {
      if (errors.length < this.limits.maxErrors) errors.push({ row, message });
    };
    try {
      const imp = this.importer(job.key);
      const parsed = this.parseAll(imp, job.rows.data, job.mapping);
      const valid = parsed.filter((r) => !r.errors.length);
      for (const r of parsed) {
        if (r.errors.length) {
          summary.skipped++;
          addError(r.row, r.errors.join("; "));
        }
      }
      const size = Math.max(1, imp.batchSize ?? 200);
      for (let i = 0; i < valid.length; i += size) {
        const batch = valid.slice(i, i + size).map((r) => ({ row: r.row, data: r.data }));
        try {
          const res = await imp.commit(tenantId, batch, { jobId, userId: job.createdBy });
          summary.created += res.created;
          summary.updated += res.updated;
          const failedRows = res.errors ?? [];
          summary.failed += failedRows.length;
          for (const e of failedRows) addError(e.row, e.message);
        } catch (err) {
          summary.failed += batch.length;
          const message = err instanceof AppError ? err.message : "Could not save these rows";
          if (!(err instanceof AppError)) this.log.error({ err, jobId, key: job.key }, "importexport: batch failed");
          for (const r of batch) addError(r.row, message);
        }
        summary.processed += batch.length;
        await this.deps.store.update(tenantId, jobId, { summary: { ...summary } });
      }
      errors.sort((a, b) => a.row - b.row);
      await this.deps.store.update(tenantId, jobId, { status: "done", summary, errors, rows: null, finishedAt: new Date() });
    } catch (err) {
      this.log.error({ err, jobId }, "importexport: job failed");
      addError(0, err instanceof AppError ? err.message : "The import failed unexpectedly");
      await this.deps.store.update(tenantId, jobId, { status: "failed", summary, errors, rows: null, finishedAt: new Date() });
    }
  }

  async status(tenantId: string, jobId: string): Promise<JobStatus> {
    const job = await this.deps.store.get(tenantId, jobId);
    if (!job) throw notFound("Import job");
    return toStatus(job);
  }

  async list(tenantId: string, opts: { key?: string; limit?: number; offset?: number } = {}) {
    const res = await this.deps.store.list(tenantId, { key: opts.key, limit: Math.min(100, opts.limit ?? 20), offset: opts.offset ?? 0 });
    return { items: res.items.map(toStatus), total: res.total };
  }

  /** Template workbook: headers, one example row, and a Help sheet. */
  async templateXlsx(key: string): Promise<Buffer> {
    const imp = this.importer(key);
    return writeXlsx({
      sheetName: imp.label.slice(0, 31) || "Data",
      columns: imp.columns.map((c) => ({ header: c.label, numFmt: "@" })),
      rows: [imp.columns.map((c) => c.example ?? "")],
      help: [
        ["Column", "Required", "What to enter", "Example"],
        ...imp.columns.map((c) => [c.label, c.required ? "Yes" : "No", c.help ?? "", c.example ?? ""]),
        [],
        ["Notes", "", `Keep the header row. Up to ${this.limits.maxRows.toLocaleString("en-IN")} rows per file. Amounts are in rupees (1,234.50).`, ""],
      ],
    });
  }

  templateCsv(key: string): string {
    const imp = this.importer(key);
    return `﻿${csvLine(imp.columns.map((c) => c.label))}${csvLine(imp.columns.map((c) => c.example ?? ""))}`;
  }

  /** Streams an export. */
  async export(
    tenantId: string,
    key: string,
    format: "csv" | "xlsx",
    query: Record<string, string | undefined>,
  ): Promise<{ stream: Readable; filename: string; contentType: string }> {
    const exp = this.registry.exporter(key);
    if (!exp) throw notFound("Exporter");
    await this.assertFeature(tenantId, exp.feature);
    const cols = exp.columns as ExportColumn<Record<string, unknown>>[];
    const base = (exp.filename ?? exp.key.replace(/\./g, "-")).replace(/[^\w.-]+/g, "_");
    const filename = `${base}.${format}`;
    const source = iterate(exp.rows(tenantId, query));
    if (format === "csv") {
      const lines = async function* () {
        yield `﻿${csvLine(cols.map((c) => c.label))}`;
        for await (const row of source) yield csvLine(cols.map((c) => exportCell(c, row)));
      };
      return { stream: Readable.from(lines()), filename, contentType: "text/csv; charset=utf-8" };
    }
    const x = xlsxStream(exp.label.slice(0, 31) || "Export", cols.map((c) => ({ header: c.label, numFmt: c.numFmt, width: c.width })));
    void (async () => {
      try {
        for await (const row of source) x.write(cols.map((c) => exportCell(c, row)));
        await x.end();
      } catch (err) {
        this.log.error({ err, key }, "importexport: export failed");
        x.stream.destroy(err as Error);
      }
    })();
    return { stream: x.stream, filename, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  }
}

function toStatus(job: ImportJob): JobStatus {
  const s = { ...emptySummary(), ...job.summary };
  return {
    jobId: job.id,
    key: job.key,
    status: job.status,
    fileName: job.fileName,
    total: s.rows,
    valid: s.valid,
    invalid: s.invalid,
    processed: s.processed,
    created: s.created,
    updated: s.updated,
    failed: s.failed,
    skipped: s.skipped,
    errors: job.errors ?? [],
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

export { rupees };
