import type { ExportColumn, ImportColumn } from "./columns";
import type { ParsedRow, RowValidator } from "./engine";

export interface CommitRow<T> {
  /** File row number (for error messages). */
  row: number;
  data: T;
}

export interface CommitOptions {
  jobId: string;
  userId: string | null;
  /** Options chosen in the wizard (e.g. `carryDues`). */
  options: ImportOptions;
}

/** Wizard choices stored with the job. */
export interface ImportOptions {
  /**
   * Historical bills: false (default) = the unpaid part of an imported bill is treated as already inside the party's
   * opening balance and is NOT carried again; true = the unpaid part stays outstanding on the bill.
   */
  carryDues?: boolean;
}

/** A record an import created or linked, kept so the batch can be rolled back and re-imports skipped. */
export interface ImportRecordRef {
  /** "customer", "supplier", "product", "sale", "purchase". */
  entity: string;
  /** Stable external key (idempotency). */
  key: string;
  /** Our id of the record. */
  id: string;
  /** "created" can be rolled back; "linked" (matched an existing record) is left alone. */
  action: "created" | "linked";
  meta?: Record<string, unknown>;
}

export interface CommitResult {
  created: number;
  updated: number;
  /** Rows the port rejected, with reasons. */
  errors?: { row: number; message: string }[];
  /** Records created/linked (for rollback and idempotency). */
  records?: ImportRecordRef[];
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
  /** Largest file (data rows) for this importer; default is the service limit. */
  maxRows?: number;
  /**
   * Opt in to idempotent re-imports: each row maps to stable external key(s); rows whose key was already imported
   * (and not rolled back) are skipped instead of written again.
   */
  idempotent?: { entity: string; keys(data: Record<string, unknown>): string[] };
  /** Rows sharing this key are never split across commit batches (lines of one bill). */
  groupKey?: (data: Record<string, unknown>) => string;
  /** Adjusts the raw table before mapping (e.g. drops receipt/journal rows from a day book). */
  prepare?(headers: string[], data: string[][]): { headers: string[]; data: string[][]; ignored?: number };
  /** Cross-row checks after every row parsed; push messages onto `row.errors`. */
  validateSet?(rows: ParsedRow[]): void;
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

/** Undo of an import batch, implemented by the API kit over the services. */
export interface RollbackPort {
  rollback(tenantId: string, records: (ImportRecordRef & { batchId: string })[], opts: { userId: string | null }): Promise<RollbackResult>;
}

export interface RollbackResult {
  reverted: number;
  /** Records left in place, with the reason (e.g. a customer who already has newer bills). */
  kept: { entity: string; key: string; reason: string }[];
}

export class ImportExportRegistry {
  rollbackPort: RollbackPort | null = null;

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
      idempotent: !!d.idempotent,
      columns: d.columns.map((c) => ({ key: c.key, label: c.label, required: !!c.required, example: c.example ?? null, help: c.help ?? null })),
    }));
  }

  listExporters() {
    return [...this.exporters.values()].map((d) => ({ key: d.key, label: d.label, feature: d.feature ?? null }));
  }
}
