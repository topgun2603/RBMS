import type { Db } from "@srirealtime/db";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { importJobs, type ImportJobRows, type ImportJobStatus, type ImportJobSummary } from "./schema";

export interface ImportJob {
  id: string;
  tenantId: string;
  key: string;
  status: ImportJobStatus;
  fileName: string | null;
  fileType: "csv" | "xlsx" | null;
  fileSize: number | null;
  mapping: Record<string, number | null>;
  rows: ImportJobRows | null;
  summary: ImportJobSummary;
  errors: { row: number; message: string }[];
  skipInvalid: boolean;
  createdBy: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewImportJob = Pick<ImportJob, "tenantId" | "key" | "fileName" | "fileType" | "fileSize" | "mapping" | "rows" | "summary" | "createdBy">;
export type ImportJobPatch = Partial<Pick<ImportJob, "status" | "mapping" | "rows" | "summary" | "errors" | "skipInvalid" | "startedAt" | "finishedAt">>;

/** Persistence for import jobs (Postgres in the app, memory in tests). */
export interface ImportJobStore {
  create(job: NewImportJob): Promise<ImportJob>;
  get(tenantId: string, id: string): Promise<ImportJob | null>;
  /** Applies the patch; with `expect`, only when the job is currently in one of those statuses. Returns whether it applied. */
  update(tenantId: string, id: string, patch: ImportJobPatch, expect?: ImportJobStatus[]): Promise<boolean>;
  list(tenantId: string, opts: { key?: string; limit: number; offset: number }): Promise<{ items: ImportJob[]; total: number }>;
}

export class DrizzleImportJobStore implements ImportJobStore {
  constructor(private readonly db: Db) {}

  async create(job: NewImportJob): Promise<ImportJob> {
    const [row] = await this.db.insert(importJobs).values({ ...job, status: "preview" }).returning();
    return row as ImportJob;
  }

  async get(tenantId: string, id: string): Promise<ImportJob | null> {
    const [row] = await this.db
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.tenantId, tenantId), eq(importJobs.id, id)))
      .limit(1);
    return (row as ImportJob | undefined) ?? null;
  }

  async update(tenantId: string, id: string, patch: ImportJobPatch, expect?: ImportJobStatus[]): Promise<boolean> {
    const conds = [eq(importJobs.tenantId, tenantId), eq(importJobs.id, id)];
    if (expect?.length) conds.push(inArray(importJobs.status, expect));
    const rows = await this.db
      .update(importJobs)
      .set(patch)
      .where(and(...conds))
      .returning({ id: importJobs.id });
    return rows.length > 0;
  }

  async list(tenantId: string, opts: { key?: string; limit: number; offset: number }) {
    const where = opts.key ? and(eq(importJobs.tenantId, tenantId), eq(importJobs.key, opts.key)) : eq(importJobs.tenantId, tenantId);
    const [items, [total]] = await Promise.all([
      this.db
        .select({
          id: importJobs.id,
          tenantId: importJobs.tenantId,
          key: importJobs.key,
          status: importJobs.status,
          fileName: importJobs.fileName,
          fileType: importJobs.fileType,
          fileSize: importJobs.fileSize,
          mapping: importJobs.mapping,
          summary: importJobs.summary,
          skipInvalid: importJobs.skipInvalid,
          createdBy: importJobs.createdBy,
          startedAt: importJobs.startedAt,
          finishedAt: importJobs.finishedAt,
          createdAt: importJobs.createdAt,
          updatedAt: importJobs.updatedAt,
        })
        .from(importJobs)
        .where(where)
        .orderBy(desc(importJobs.createdAt))
        .limit(opts.limit)
        .offset(opts.offset),
      this.db.select({ n: count() }).from(importJobs).where(where),
    ]);
    return { items: items.map((i) => ({ ...i, rows: null, errors: [] }) as ImportJob), total: Number(total?.n ?? 0) };
  }
}

/** In-memory store for tests and demos. */
export class MemoryImportJobStore implements ImportJobStore {
  readonly jobs = new Map<string, ImportJob>();

  async create(job: NewImportJob): Promise<ImportJob> {
    const now = new Date();
    const full: ImportJob = { ...job, id: crypto.randomUUID(), status: "preview", errors: [], skipInvalid: true, startedAt: null, finishedAt: null, createdAt: now, updatedAt: now };
    this.jobs.set(full.id, structuredClone(full));
    return full;
  }

  async get(tenantId: string, id: string) {
    const j = this.jobs.get(id);
    return j && j.tenantId === tenantId ? structuredClone(j) : null;
  }

  async update(tenantId: string, id: string, patch: ImportJobPatch, expect?: ImportJobStatus[]) {
    const j = this.jobs.get(id);
    if (!j || j.tenantId !== tenantId) return false;
    if (expect?.length && !expect.includes(j.status)) return false;
    Object.assign(j, structuredClone(patch), { updatedAt: new Date() });
    return true;
  }

  async list(tenantId: string, opts: { key?: string; limit: number; offset: number }) {
    const all = [...this.jobs.values()]
      .filter((j) => j.tenantId === tenantId && (!opts.key || j.key === opts.key))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { items: all.slice(opts.offset, opts.offset + opts.limit).map((j) => ({ ...structuredClone(j), rows: null })), total: all.length };
  }
}
