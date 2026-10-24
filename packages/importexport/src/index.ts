import { defineModule, type FeatureDef, type FeatureGatePort, type SrModule } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { ImportExportRegistry } from "./registry";
import { IMPORTEXPORT_FEATURE, IMPORTEXPORT_PERMISSION, exportRoutes, importRoutes } from "./routes";
import { exportJobs, importJobs, importRecords } from "./schema";
import { ImportExportService, type ImportExportLimits, type LoggerPort, type QueuePort } from "./service";
import { FullExportService, type AuditPortLike, type FilePort, type FullExportLimits, type FullExportPort } from "./fullexport";
import {
  DrizzleExportJobStore,
  DrizzleImportJobStore,
  DrizzleImportRecordStore,
  MemoryExportJobStore,
  type ExportJobStore,
  type ImportJobStore,
  type ImportRecordStore,
} from "./store";

export interface ImportExportDeps {
  /** Required unless `store` is given. */
  db?: Db;
  store?: ImportJobStore;
  /** When present, commits run as the "importexport.commit" job; otherwise inline in the request. */
  queue?: QueuePort;
  /** Lets commit/export check the importer's own feature (those routes can't declare it statically). */
  features?: FeatureGatePort;
  limits?: Partial<ImportExportLimits>;
  log?: LoggerPort;
  records?: ImportRecordStore;
  /** "Export all my data" + Tally export; omit to leave those routes out. */
  fullExport?: { port: FullExportPort; files: FilePort; store?: ExportJobStore; audit?: AuditPortLike; limits?: Partial<FullExportLimits> };
}

export const IMPORTEXPORT_FEATURES: FeatureDef[] = [
  {
    key: IMPORTEXPORT_FEATURE,
    module: "importexport",
    label: "Import & export",
    description: "Bring products, customers, suppliers and stock in from Excel/CSV, and export them.",
  },
];

/** Permission definitions (structurally core's PermissionDef). */
export const IMPORTEXPORT_PERMISSIONS = [
  {
    key: IMPORTEXPORT_PERMISSION,
    module: "importexport",
    label: "Import and export data",
    description: "Upload CSV/Excel files to import records, and download exports.",
  },
];

/**
 * Import/export engine. Register importers/exporters on `registry` (see ./specs for ready-made ones) **before**
 * the host mounts the routes. Two modules: `importModule` (id "import", owns the table and the feature)
 * mounted at /v1/import and `exportModule` (id "export") at /v1/export.
 */
export function createImportExport(deps: ImportExportDeps) {
  const store = deps.store ?? (deps.db ? new DrizzleImportJobStore(deps.db) : null);
  if (!store) throw new Error("createImportExport needs db or store");
  const registry = new ImportExportRegistry();
  const records = deps.records ?? (deps.db ? new DrizzleImportRecordStore(deps.db) : undefined);
  const service = new ImportExportService(registry, { store, records, queue: deps.queue, features: deps.features, log: deps.log, limits: deps.limits });
  const fe = deps.fullExport;
  const fullExport = fe
    ? new FullExportService({
        store: fe.store ?? (deps.db ? new DrizzleExportJobStore(deps.db) : new MemoryExportJobStore()),
        port: fe.port,
        files: fe.files,
        queue: deps.queue,
        audit: fe.audit,
        log: deps.log,
        limits: fe.limits,
      })
    : undefined;
  // Built as a variable so the `permissions` field (added to SrModule by core's staff work) type-checks either way.
  const importDef = {
    id: "import",
    tables: { importJobs, importRecords, exportJobs },
    routes: importRoutes(service),
    features: IMPORTEXPORT_FEATURES,
    permissions: IMPORTEXPORT_PERMISSIONS,
  };
  const importModule: SrModule = defineModule(importDef);
  const exportModule: SrModule = defineModule({ id: "export", routes: exportRoutes(service, fullExport) });
  return { service, fullExport, registry, importModule, exportModule, modules: [importModule, exportModule] };
}

export * from "./schema";
export * from "./columns";
export * from "./csv";
export * from "./engine";
export * from "./registry";
export * from "./specs";
export * from "./history";
export * from "./vendors";
export * from "./tally";
export * from "./fullexport";
export { makeZip, crc32, type ZipEntry } from "./zip";
export { parseXml, findAll, XmlError, type XmlNode } from "./xml";
export { readXlsx, writeXlsx, xlsxStream, cellText, XlsxError, type SheetColumn, type WorkbookInput, type XlsxValue } from "./xlsx";
export { fileFromMultipart, parseMultipart, boundaryOf, MultipartError, type MultipartFile } from "./multipart";
export {
  ImportExportService,
  COMMIT_JOB,
  DEFAULT_LIMITS,
  detectFileType,
  decodeText,
  type ImportExportLimits,
  type JobStatus,
  type PreviewResult,
  type UploadedFile,
  type QueuePort,
  type LoggerPort,
} from "./service";
export {
  DrizzleImportJobStore,
  DrizzleImportRecordStore,
  DrizzleExportJobStore,
  MemoryExportJobStore,
  MemoryImportRecordStore,
  IMPORT_JOB_SORT,
  importJobConditions,
  importJobListQuerySchema,
  MemoryImportJobStore,
  type ImportJob,
  type ImportJobListPage,
  type ImportJobListQuery,
  type ImportJobStore,
  type ImportRecordStore,
  type ExportJobStore,
} from "./store";
export { importRoutes, exportRoutes, IMPORTEXPORT_FEATURE, IMPORTEXPORT_PERMISSION, UPLOAD_CONTENT_TYPES } from "./routes";
