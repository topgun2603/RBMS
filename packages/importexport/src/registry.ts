import type { ExportColumn, ImportColumn } from "./columns";
import type { RowValidator } from "./engine";

export interface CommitRow<T> {
  /** File row number (for error messages). */
  row: number;
  data: T;
}

export interface CommitOptions {
  jobId: string;
  userId: string | null;
}

export interface CommitResult {
  created: number;
  updated: number;
  /** Rows the port rejected, with reasons. */
  errors?: { row: number; message: string }[];
}

export interface ImporterDef<T = Record<string, unknown>> {
  /** e.g. "catalog.products" (URL segment). */
  key: string;
  label: string;
  /** Feature the routes declare (docs/features.md), e.g. "catalogue". `importexport` is always required too. */
  feature?: string;
  /** Permission key for the routes, e.g. "catalogue.manage". */
  permission?: string;
  columns: ImportColumn[];
  /** Cross-field checks after every column parsed; return message(s) to reject the row. */
  validate?: RowValidator<T>;
  /** Writes a batch of valid rows. Called once per batch (see `batchSize`). */
  commit(tenantId: string, rows: CommitRow<T>[], opts: CommitOptions): Promise<CommitResult>;
  /** Rows per commit call (default 200). */
  batchSize?: number;
}

export interface ExporterDef<R = Record<string, unknown>> {
  key: string;
  label: string;
  feature?: string;
  permission?: string;
  columns: ExportColumn<R>[];
  /** Rows to export; an async iterable lets large exports stream. */
  rows(tenantId: string, query: Record<string, string | undefined>): AsyncIterable<R> | Iterable<R> | Promise<Iterable<R>>;
  /** Base file name (default: key with dots → dashes). */
  filename?: string;
}

const KEY = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/;

export class ImportExportRegistry {
  private readonly importers = new Map<string, ImporterDef<any>>();
  private readonly exporters = new Map<string, ExporterDef<any>>();

  registerImporter<T>(def: ImporterDef<T>): void {
    if (!KEY.test(def.key) || def.key.length > 60) throw new Error(`Invalid importer key "${def.key}"`);
    if (this.importers.has(def.key)) throw new Error(`Importer "${def.key}" is already registered`);
    if (!def.columns.length) throw new Error(`Importer "${def.key}" has no columns`);
    const keys = new Set<string>();
    for (const c of def.columns) {
      if (keys.has(c.key)) throw new Error(`Importer "${def.key}" has duplicate column "${c.key}"`);
      keys.add(c.key);
    }
    this.importers.set(def.key, def);
  }

  registerExporter<R>(def: ExporterDef<R>): void {
    if (!KEY.test(def.key) || def.key.length > 60) throw new Error(`Invalid exporter key "${def.key}"`);
    if (this.exporters.has(def.key)) throw new Error(`Exporter "${def.key}" is already registered`);
    this.exporters.set(def.key, def);
  }

  importer(key: string): ImporterDef<Record<string, unknown>> | undefined {
    return this.importers.get(key);
  }

  exporter(key: string): ExporterDef<Record<string, unknown>> | undefined {
    return this.exporters.get(key);
  }

  listImporters() {
    return [...this.importers.values()].map((d) => ({
      key: d.key,
      label: d.label,
      feature: d.feature ?? null,
      columns: d.columns.map((c) => ({ key: c.key, label: c.label, required: !!c.required, example: c.example ?? null, help: c.help ?? null })),
    }));
  }

  listExporters() {
    return [...this.exporters.values()].map((d) => ({ key: d.key, label: d.label, feature: d.feature ?? null }));
  }
}
