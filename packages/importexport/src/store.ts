import { defineSort, facetCounts, listFilter, listQuerySchema, rangeOrder, runList, searchAny, splitList, type ListPage } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, count, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { IMPORT_JOB_STATUSES, importJobs, type ImportJobRows, type ImportJobStatus, type ImportJobSummary } from "./schema";

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

/**
 * `GET /v1/import/jobs` query (docs/CONVENTIONS.md → "Lists and tables"):
 * `?limit=20&offset=0&sort=-created&q=<file name>&status=done,failed&key=catalog.products,customers&from=&to=`.
 * `key` is the importer ("kind"); `from`/`to` are IST calendar days of the upload.
 */
export const importJobListQuerySchema = listQuerySchema({ defaultLimit: 20, maxLimit: 100 })
  .extend({
    key: z.preprocess(splitList, z.array(z.string().min(1).max(60)).max(50).optional()),
    status: listFilter.oneOf(IMPORT_JOB_STATUSES),
    from: listFilter.date(),
    to: listFilter.date(),
  })
  .superRefine(rangeOrder("from", "to"));
export type ImportJobListQuery = z.input<typeof importJobListQuerySchema>;
export type ImportJobListParams = z.output<typeof importJobListQuerySchema>;

/** Sort keys of the job list; newest upload first by default. */
export const IMPORT_JOB_SORT = defineSort(
  {
    created: importJobs.createdAt,
    file: sql`lower(${importJobs.fileName})`,
    kind: importJobs.key,
    status: importJobs.status,
  },
  { default: "-created", tieBreaker: importJobs.id },
);

const istDayStart = (day: string) => new Date(`${day}T00:00:00+05:30`);
const istDayEnd = (day: string) => new Date(istDayStart(day).getTime() + 86_400_000);

/** WHERE of the job list; without `status` for the status facet counts. */
export function importJobConditions(tenantId: string, p: ImportJobListParams, withStatus = true): SQL | undefined {
  return and(
    eq(importJobs.tenantId, tenantId),
    p.key?.length ? inArray(importJobs.key, p.key) : undefined,
    withStatus && p.status?.length ? inArray(importJobs.status, p.status) : undefined,
    p.from ? gte(importJobs.createdAt, istDayStart(p.from)) : undefined,
    p.to ? lt(importJobs.createdAt, istDayEnd(p.to)) : undefined,
    searchAny(p.q, [importJobs.fileName]),
  );
}

/** A page of jobs (without rows/errors) with `facets.status`. */
export type ImportJobListPage = ListPage<ImportJob>;

export type NewImportJob = Pick<ImportJob, "tenantId" | "key" | "fileName" | "fileType" | "fileSize" | "mapping" | "rows" | "summary" | "createdBy">;
export type ImportJobPatch = Partial<Pick<ImportJob, "status" | "mapping" | "rows" | "summary" | "errors" | "skipInvalid" | "startedAt" | "finishedAt">>;

/** Persistence for import jobs (Postgres in the app, memory in tests). */
export interface ImportJobStore {
  create(job: NewImportJob): Promise<ImportJob>;
  get(tenantId: string, id: string): Promise<ImportJob | null>;
  /** Applies the patch; with `expect`, only when the job is currently in one of those statuses. Returns whether it applied. */
  update(tenantId: string, id: string, patch: ImportJobPatch, expect?: ImportJobStatus[]): Promise<boolean>;
  /** Paged, sorted (IMPORT_JOB_SORT keys) and filtered; `rows` null and `errors` empty in the items. */
  list(tenantId: string, p: ImportJobListParams): Promise<ImportJobListPage>;
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

  async list(tenantId: string, p: ImportJobListParams): Promise<ImportJobListPage> {
    const order = IMPORT_JOB_SORT.orderBy(p.sort);
    const where = importJobConditions(tenantId, p);
    const [page, byStatus] = await Promise.all([
      runList(p, {
        rows: () =>
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
            .orderBy(...order)
            .limit(p.limit)
            .offset(p.offset),
        count: () => this.db.select({ total: count() }).from(importJobs).where(where),
        map: (i) => ({ ...i, rows: null, errors: [] }) as ImportJob,
      }),
      this.db
        .select({ key: importJobs.status, n: count() })
        .from(importJobs)
        .where(importJobConditions(tenantId, p, false))
        .groupBy(importJobs.status),
    ]);
    return { ...page, facets: { status: facetCounts(byStatus) } };
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

  async list(tenantId: string, p: ImportJobListParams): Promise<ImportJobListPage> {
    const sort = IMPORT_JOB_SORT.parse(p.sort);
    const q = p.q?.toLowerCase();
    const from = p.from ? istDayStart(p.from).getTime() : -Infinity;
    const to = p.to ? istDayEnd(p.to).getTime() : Infinity;
    const base = [...this.jobs.values()].filter(
      (j) =>
        j.tenantId === tenantId &&
        (!p.key?.length || p.key.includes(j.key)) &&
        j.createdAt.getTime() >= from &&
        j.createdAt.getTime() < to &&
        (!q || (j.fileName ?? "").toLowerCase().includes(q)),
    );
    const all = base.filter((j) => !p.status?.length || p.status.includes(j.status));
    const value = (j: ImportJob): string | number | null =>
      sort.key === "created" ? j.createdAt.getTime() : sort.key === "file" ? (j.fileName?.toLowerCase() ?? null) : sort.key === "kind" ? j.key : j.status;
    all.sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1; // nulls last
      const c = va < vb ? -1 : va > vb ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      return sort.desc ? -c : c;
    });
    const status: Record<string, number> = {};
    for (const j of base) status[j.status] = (status[j.status] ?? 0) + 1;
    return {
      items: all.slice(p.offset, p.offset + p.limit).map((j) => ({ ...structuredClone(j), rows: null })),
      total: all.length,
      limit: p.limit,
      offset: p.offset,
      facets: { status },
    };
  }
}
