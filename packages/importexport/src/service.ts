import { Readable } from "node:stream";
import { AppError, badRequest, conflict, featureDisabled, notFound, type FeatureGatePort, type ListPage } from "@srirealtime/core";
import { rupees, type ExportColumn } from "./columns";
import { tallyXmlTable } from "./tally";
import { VENDORS, detectVendor, findHeaderRow, isFooterRow, vendorById, withVendor, type VendorId } from "./vendors";
import { XmlError, looksLikeXml } from "./xml";
import { CsvError, csvLine, parseCsvLines } from "./csv";
import { autoMap, missingRequired, parseRows, resolveMapping, type DetectedColumn, type Mapping, type ParsedRow } from "./engine";
import type { ImportExportRegistry, ImportOptions, ImporterDef } from "./registry";
import type { ImportJobError, ImportJobStatus, ImportJobSummary } from "./schema";
import { IMPORT_JOB_SORT, MemoryImportRecordStore, importJobListQuerySchema, type ImportJob, type ImportJobListQuery, type ImportJobStore, type ImportRecordStore } from "./store";
import { XlsxError, readXlsxLines, writeXlsx, xlsxStream, type XlsxValue } from "./xlsx";

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
  /** Source software used for the aliases (chosen or detected). */
  source: VendorId;
  /** Source guessed from the headers, when it differs from the one asked for. */
  detectedSource: VendorId | null;
  /** Rows dropped before mapping (receipts, journals, report totals). */
  ignoredRows: number;
  /** Valid rows whose records were imported before (skipped on commit). */
  alreadyImported: number;
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
  errors: ImportJobError[];
  source: string | null;
  options: Record<string, unknown>;
  ignoredRows: number;
  rollback: ImportJob["rollback"];
  rolledBackAt: Date | null;
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
    private readonly deps: { store: ImportJobStore; records?: ImportRecordStore; queue?: QueuePort; features?: FeatureGatePort; log?: LoggerPort; limits?: Partial<ImportExportLimits> },
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

  private get records(): ImportRecordStore {
    return (this.deps.records ??= new MemoryImportRecordStore());
  }

  /**
   * Reads an uploaded CSV/XLSX (or Tally XML for importers that have an XML form) into a header row + data rows,
   * enforcing the size and row limits. With `imp`, title rows above the header are skipped, report footers dropped
   * and the importer's `prepare` hook applied.
   */
  async readTable(
    file: UploadedFile,
    imp?: ImporterDef<Record<string, unknown>>,
    vendor?: VendorId,
  ): Promise<{ headers: string[]; data: string[][]; lineNos?: number[]; type: "csv" | "xlsx" | "xml"; ignored: number }> {
    if (!file.data.length) throw badRequest("The file is empty");
    if (file.data.length > this.limits.maxBytes) {
      throw new AppError(413, "file_too_large", `The file is larger than ${Math.round(this.limits.maxBytes / 1024 / 1024)} MB`);
    }
    const maxRows = imp?.maxRows ?? this.limits.maxRows;
    const isZip = file.data.length >= 4 && file.data[0] === 0x50 && file.data[1] === 0x4b;
    let type: "csv" | "xlsx" | "xml";
    let table: string[][];
    let tableLines: number[] | undefined;
    if (!isZip && looksLikeXml(file.data)) {
      type = "xml";
      let t;
      try {
        t = imp ? tallyXmlTable(file.data, imp.key) : null;
      } catch (err) {
        if (err instanceof XmlError) throw badRequest(`Could not read the XML file: ${err.message}`);
        throw err;
      }
      if (!t) throw badRequest("XML files can be imported for Tally exports (ledgers, stock items, sales and purchase vouchers) only");
      if (!t.data.length) throw badRequest("No matching records found in the XML file. Check that you exported the right masters or vouchers from Tally");
      if (t.data.length > maxRows) throw new AppError(413, "too_many_rows", `The file has more than ${maxRows} rows; split it into smaller files`);
      table = [t.headers, ...t.data];
    } else {
      type = detectFileType(file);
      try {
        const t = type === "xlsx" ? await readXlsxLines(file.data, { maxRows: maxRows + 60 }) : parseCsvLines(decodeText(file.data), { maxRows: maxRows + 60 });
        table = t.rows;
        tableLines = t.lines;
      } catch (err) {
        if (err instanceof CsvError || err instanceof XlsxError) {
          if (/Too many rows/.test(err.message)) throw new AppError(413, "too_many_rows", `The file has more than ${maxRows} rows; split it into smaller files`);
          throw badRequest(err.message);
        }
        throw err;
      }
    }
    const headerAt = imp && type !== "xml" ? findHeaderRow(table, withVendor(imp.columns, vendor)) : 0;
    const headerRow = table[headerAt];
    if (!headerRow?.some((h) => h.trim())) throw badRequest("The file has no header row");
    let headers = headerRow.map((h) => h.trim());
    // Each data row remembers its real row number in the file (title block above the header, skipped blank rows).
    let data: string[][] = [];
    let lineNos: number[] | undefined = tableLines ? [] : undefined;
    table.slice(headerAt + 1).forEach((r, i) => {
      const cells = r.map((c) => c ?? "");
      if (!cells.some((c) => c.trim() !== "") || (imp?.idempotent && isFooterRow(cells))) return;
      data.push(cells);
      lineNos?.push(tableLines![headerAt + 1 + i]!);
    });
    let ignored = 0;
    if (imp?.prepare) {
      const before = new Map(data.map((r, i) => [r, i] as const));
      const p = imp.prepare(headers, data);
      headers = p.headers;
      const kept = lineNos ? p.data.map((r) => before.get(r)) : [];
      const original = lineNos;
      lineNos = original && kept.every((k) => k !== undefined) ? kept.map((k) => original[k!]!) : undefined;
      data = p.data;
      ignored = p.ignored ?? 0;
    }
    if (data.length > maxRows) throw new AppError(413, "too_many_rows", `The file has more than ${maxRows} rows; split it into smaller files`);
    if (!data.length) throw badRequest(ignored ? "The file has no sales/purchase rows (receipts, journals and returns are skipped)" : "The file has a header row but no data rows");
    return { headers, data, ...(lineNos ? { lineNos } : {}), type, ignored };
  }

  private parseAll(imp: ImporterDef<Record<string, unknown>>, data: string[][], mapping: Mapping, lineNos?: number[]): ParsedRow[] {
    const parsed = parseRows(data, imp.columns, mapping, imp.validate, lineNos?.length === data.length ? lineNos : 2);
    imp.validateSet?.(parsed);
    return parsed;
  }

  /** Valid rows whose external keys were imported before (row number -> batch). */
  private async alreadyImported(tenantId: string, imp: ImporterDef<Record<string, unknown>>, rows: ParsedRow[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    if (!imp.idempotent) return out;
    const keysOf = new Map<number, string[]>();
    const all = new Set<string>();
    for (const r of rows) {
      if (r.errors.length) continue;
      const ks = imp.idempotent.keys(r.data);
      keysOf.set(r.row, ks);
      ks.forEach((k) => all.add(k));
    }
    const existing = await this.records.existing(tenantId, imp.idempotent.entity, [...all]);
    for (const [row, ks] of keysOf) {
      // A row is "already imported" when all its keys are (a "both" party needs both records).
      if (ks.length && ks.every((k) => existing.has(k))) out.set(row, existing.get(ks[0]!)!);
    }
    return out;
  }

  async preview(tenantId: string, userId: string | null, key: string, file: UploadedFile, opts: { source?: string } = {}): Promise<PreviewResult> {
    const imp = this.importer(key);
    const asked = opts.source && opts.source !== "auto" ? vendorById(opts.source)?.id : undefined;
    if (opts.source && opts.source !== "auto" && !asked) throw badRequest(`Unknown source "${opts.source}"`, { allowed: VENDORS.map((v) => v.id) });
    const { headers, data, lineNos, type, ignored } = await this.readTable(file, imp, asked);
    const detected = detectVendor(headers);
    const source: VendorId = asked ?? detected ?? (type === "xml" ? "tally" : "generic");
    const { mapping, detected: cols } = autoMap(headers, withVendor(imp.columns, source));
    const parsed = this.parseAll(imp, data, mapping, lineNos);
    const already = await this.alreadyImported(tenantId, imp, parsed);
    const invalid = parsed.filter((r) => r.errors.length).length;
    const summary = { ...emptySummary(), rows: parsed.length, valid: parsed.length - invalid, invalid };
    const job = await this.deps.store.create({
      tenantId,
      key,
      fileName: file.fileName?.slice(0, 200) ?? null,
      fileType: type === "xml" ? "csv" : type,
      fileSize: file.data.length,
      mapping,
      rows: { headers, data, ...(lineNos ? { lineNos } : {}) },
      summary,
      createdBy: userId,
      source,
      ignoredRows: ignored,
    });
    return {
      jobId: job.id,
      key,
      fileName: job.fileName,
      columns: cols,
      mapping,
      missing: missingRequired(imp.columns, mapping).map((c) => c.label),
      rows: parsed.slice(0, this.limits.previewRows),
      totals: { rows: summary.rows, valid: summary.valid, invalid },
      source,
      detectedSource: detected && detected !== source ? detected : null,
      ignoredRows: ignored,
      alreadyImported: already.size,
    };
  }

  /** Starts the import of a previewed job (via the queue when present, otherwise inline). */
  async commit(
    tenantId: string,
    jobId: string,
    opts: { mapping?: Record<string, string | number | null>; skipInvalid?: boolean; options?: ImportOptions } = {},
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
    const parsed = this.parseAll(imp, job.rows.data, mapping, job.rows.lineNos);
    const invalidRows = parsed.filter((r) => r.errors.length);
    const skipInvalid = opts.skipInvalid ?? true;
    if (invalidRows.length && !skipInvalid) {
      throw badRequest(`${invalidRows.length} row(s) have errors; fix them or import with skipInvalid`, {
        errors: invalidRows.slice(0, 50).map((r) => ({ row: r.row, message: r.errors.join("; ") })),
      });
    }
    if (invalidRows.length === parsed.length) throw badRequest("No valid rows to import");
    const summary = { ...emptySummary(), rows: parsed.length, valid: parsed.length - invalidRows.length, invalid: invalidRows.length };
    const ok = await this.deps.store.update(tenantId, jobId, { status: "queued", mapping, skipInvalid, summary, options: { ...(opts.options ?? {}) } }, ["preview"]);
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
    const errors: ImportJobError[] = [];
    const rawOf = new Map<number, string[]>();
    const lineNos = job.rows.lineNos?.length === job.rows.data.length ? job.rows.lineNos : null;
    job.rows.data.forEach((cells, i) => rawOf.set(lineNos ? lineNos[i]! : 2 + i, cells));
    // Once finished only the headings stay (for the errors CSV); the cells are dropped.
    const headingsOnly = { headers: job.rows.headers, data: [] as string[][] };
    const addError = (row: number, message: string) => {
      if (errors.length < this.limits.maxErrors) errors.push({ row, message, ...(rawOf.has(row) ? { raw: rawOf.get(row) } : {}) });
    };
    try {
      const imp = this.importer(job.key);
      const parsed = this.parseAll(imp, job.rows.data, job.mapping, job.rows.lineNos);
      let valid = parsed.filter((r) => !r.errors.length);
      for (const r of parsed) {
        if (r.errors.length) {
          summary.skipped++;
          addError(r.row, r.errors.join("; "));
        }
      }
      // Idempotency: records imported before are skipped, not written again.
      const already = await this.alreadyImported(tenantId, imp, valid);
      if (already.size) {
        valid = valid.filter((r) => {
          if (!already.has(r.row)) return true;
          summary.skipped++;
          addError(r.row, "Already imported earlier; skipped");
          return false;
        });
      }
      // Rows of one group (the lines of a bill) stay in one batch.
      const groups: (typeof valid)[] = [];
      if (imp.groupKey) {
        const byKey = new Map<string, typeof valid>();
        for (const r of valid) {
          const k = imp.groupKey(r.data);
          const g = byKey.get(k);
          if (g) g.push(r);
          else {
            const ng = [r];
            byKey.set(k, ng);
            groups.push(ng);
          }
        }
      } else for (const r of valid) groups.push([r]);
      const size = Math.max(1, imp.batchSize ?? 200);
      const batches: (typeof valid)[] = [];
      let cur: typeof valid = [];
      for (const g of groups) {
        if (cur.length && cur.length + g.length > size) {
          batches.push(cur);
          cur = [];
        }
        cur.push(...g);
      }
      if (cur.length) batches.push(cur);
      const options = (job.options ?? {}) as ImportOptions;
      for (const rows of batches) {
        const batch = rows.map((r) => ({ row: r.row, data: r.data }));
        try {
          const res = await imp.commit(tenantId, batch, { jobId, userId: job.createdBy, options });
          summary.created += res.created;
          summary.updated += res.updated;
          const failedRows = res.errors ?? [];
          summary.failed += failedRows.length;
          for (const e of failedRows) addError(e.row, e.message);
          if (res.records?.length) await this.records.add(tenantId, jobId, res.records);
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
      await this.deps.store.update(tenantId, jobId, { status: "done", summary, errors, rows: headingsOnly, finishedAt: new Date() });
    } catch (err) {
      this.log.error({ err, jobId }, "importexport: job failed");
      addError(0, err instanceof AppError ? err.message : "The import failed unexpectedly");
      await this.deps.store.update(tenantId, jobId, { status: "failed", summary, errors, rows: headingsOnly, finishedAt: new Date() });
    }
  }

  /**
   * Undoes an import batch: removes what it created (bills, new parties, new products) through the registry's
   * rollback port; records that cannot be removed safely (e.g. a customer with newer bills) stay and are reported.
   * Re-importing the same file works afterwards.
   */
  async rollback(tenantId: string, jobId: string, userId: string | null): Promise<JobStatus> {
    const job = await this.deps.store.get(tenantId, jobId);
    if (!job) throw notFound("Import job");
    if (job.status === "rolled_back") throw conflict("This import was already rolled back");
    if (job.status !== "done") throw conflict("Only a finished import can be rolled back");
    const port = this.registry.rollbackPort;
    if (!port) throw badRequest("Rollback is not available");
    const imp = this.importer(job.key);
    await this.assertFeature(tenantId, imp.feature);
    // Claim the job first so two clicks cannot undo twice.
    const claimed = await this.deps.store.update(tenantId, jobId, { status: "rolled_back", rolledBackAt: new Date(), rolledBackBy: userId }, ["done"]);
    if (!claimed) throw conflict("This import was already rolled back");
    try {
      const records = await this.records.forBatch(tenantId, jobId);
      const result = await port.rollback(tenantId, records, { userId });
      await this.records.removeBatch(tenantId, jobId);
      await this.deps.store.update(tenantId, jobId, { rollback: result });
    } catch (err) {
      await this.deps.store.update(tenantId, jobId, { status: "done", rolledBackAt: null, rolledBackBy: null });
      throw err;
    }
    return this.status(tenantId, jobId);
  }

  /** Row-level error report of a job as CSV (row, problem, then the original cells). */
  async errorsCsv(tenantId: string, jobId: string): Promise<{ csv: string; filename: string }> {
    const job = await this.deps.store.get(tenantId, jobId);
    if (!job) throw notFound("Import job");
    const width = job.errors.reduce((m, e) => Math.max(m, e.raw?.length ?? 0), 0);
    // The file's own column headings (kept on the job); "Column N" only for old jobs that have none.
    const headings = job.rows?.headers ?? [];
    const lines = [csvLine(["Row", "Problem", ...Array.from({ length: width }, (_, i) => headings[i]?.trim() || `Column ${i + 1}`)])];
    for (const e of job.errors) lines.push(csvLine([e.row, e.message, ...(e.raw ?? [])]));
    const base = (job.fileName ?? job.key).replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_");
    return { csv: "\ufeff" + lines.join(""), filename: `${base}-errors.csv` };
  }

  /** The supported source software with what to export from each. */
  sources() {
    return VENDORS.map((v) => ({ id: v.id, label: v.label, labelTa: v.labelTa, verified: v.verified, formats: v.formats, exports: v.exports, notes: v.notes }));
  }

  async status(tenantId: string, jobId: string): Promise<JobStatus> {
    const job = await this.deps.store.get(tenantId, jobId);
    if (!job) throw notFound("Import job");
    return toStatus(job);
  }

  /**
   * Job history: paged, sorted (IMPORT_JOB_SORT, default `-created`) and filtered (`importJobListQuerySchema`), with
   * `facets.status`. Bad params → ZodError, unknown sort → 400.
   */
  async list(tenantId: string, query: ImportJobListQuery = {}): Promise<ListPage<JobStatus>> {
    const p = importJobListQuerySchema.parse(query);
    IMPORT_JOB_SORT.parse(p.sort);
    const res = await this.deps.store.list(tenantId, p);
    return { ...res, items: res.items.map(toStatus) };
  }

  /** Template workbook: headers, one example row, and a Help sheet. */
  async templateXlsx(key: string, source?: string): Promise<Buffer> {
    const imp = this.importer(key);
    const vendor = source ? vendorById(source) : undefined;
    return writeXlsx({
      sheetName: imp.label.slice(0, 31) || "Data",
      columns: imp.columns.map((c) => ({ header: c.label, numFmt: "@" })),
      rows: [imp.columns.map((c) => c.example ?? "")],
      help: [
        ["Column", "Required", "What to enter", "Example"],
        ...imp.columns.map((c) => [c.label, c.required ? "Yes" : "No", c.help ?? "", c.example ?? ""]),
        [],
        ...(vendor && vendor.id !== "generic"
          ? [
              ["From " + vendor.label, "", vendor.exports[key] ?? "Export the matching report to Excel and upload it, or paste its columns under these headers.", ""],
              ["", "", vendor.notes, ""],
            ]
          : []),
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
    source: job.source ?? null,
    options: job.options ?? {},
    ignoredRows: job.ignoredRows ?? 0,
    rollback: job.rollback ?? null,
    rolledBackAt: job.rolledBackAt ?? null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

export { rupees };
