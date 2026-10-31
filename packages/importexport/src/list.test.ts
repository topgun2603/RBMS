import { AppError } from "@rbms/core";
import { createDb } from "@rbms/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { importJobs } from "./schema";
import { IMPORT_JOB_SORT, importJobConditions, importJobListQuerySchema, MemoryImportJobStore } from "./store";

// Never connects: only renders SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const where = (q: Record<string, unknown>, withStatus = true) =>
  db.select().from(importJobs).where(importJobConditions(T, importJobListQuerySchema.parse(q), withStatus)).toSQL();

describe("import job list query", () => {
  it("keeps the 20/100 limits and accepts comma lists", () => {
    expect(importJobListQuerySchema.parse({}).limit).toBe(20);
    expect(importJobListQuerySchema.parse({ limit: "100" }).limit).toBe(100);
    expect(() => importJobListQuerySchema.parse({ limit: "101" })).toThrow(ZodError);
    const p = importJobListQuerySchema.parse({ status: "done,failed", key: "catalog.products,customers" });
    expect(p.status).toEqual(["done", "failed"]);
    expect(p.key).toEqual(["catalog.products", "customers"]);
    expect(() => importJobListQuerySchema.parse({ status: "lost" })).toThrow(ZodError);
    expect(() => importJobListQuerySchema.parse({ from: "2026-10-02", to: "2026-10-01" })).toThrow(ZodError);
  });

  it("filters kind, status, IST days and the file name", () => {
    const q = where({ key: "customers", status: "done", from: "2026-10-01", to: "2026-10-01", q: "50%" });
    expect(q.sql).toContain('"import_jobs"."tenant_id" = $1');
    expect(q.sql).toContain('"import_jobs"."key" in ($');
    expect(q.sql).toContain('"import_jobs"."status" in ($');
    expect(q.sql).toContain('"import_jobs"."created_at" >= $');
    expect(q.sql).toContain('"import_jobs"."created_at" < $');
    expect(q.sql).toContain('"import_jobs"."file_name" ilike $');
    expect(q.params).toEqual([T, "customers", "done", "2026-09-30T18:30:00.000Z", "2026-10-01T18:30:00.000Z", "%50\\%%"]);
  });

  it("drops the status filter for the facet counts", () => {
    const q = where({ status: "done", key: "customers" }, false);
    expect(q.params).not.toContain("done");
    expect(q.params).toContain("customers");
  });

  it("sorts by the whitelisted fields only", () => {
    const render = (s?: string) => db.select().from(importJobs).orderBy(...IMPORT_JOB_SORT.orderBy(s)).toSQL().sql;
    expect(render()).toContain('order by "import_jobs"."created_at" desc nulls last, "import_jobs"."id" desc');
    expect(render("file")).toContain('lower("import_jobs"."file_name") asc nulls last');
    expect(render("-status")).toContain('"import_jobs"."status" desc nulls last');
    expect(() => render("rows")).toThrow(AppError);
    expect(IMPORT_JOB_SORT.keys).toEqual(["created", "file", "kind", "status"]);
  });
});

describe("memory store list", () => {
  const summary = { rows: 1, valid: 1, invalid: 0, processed: 0, created: 0, updated: 0, failed: 0, skipped: 0 };
  async function seed() {
    const store = new MemoryImportJobStore();
    const add = async (key: string, fileName: string | null, status: "preview" | "done" | "failed", at: string) => {
      const j = await store.create({ tenantId: T, key, fileName, fileType: "csv", fileSize: 1, mapping: {}, rows: null, summary, createdBy: null });
      await store.update(T, j.id, { status });
      store.jobs.get(j.id)!.createdAt = new Date(at);
    };
    await add("customers", "b.csv", "done", "2026-10-01T05:00:00Z");
    await add("catalog.products", "a.csv", "failed", "2026-10-02T05:00:00Z");
    await add("customers", null, "preview", "2026-10-03T05:00:00Z");
    await add("customers", "c.csv", "done", "2026-10-04T05:00:00Z");
    return store;
  }
  const list = async (q: Record<string, unknown>) => (await seed()).list(T, importJobListQuerySchema.parse(q));

  it("pages newest first with totals and status facets under the other filters", async () => {
    const r = await list({ limit: "2" });
    expect(r.items.map((j) => j.fileName)).toEqual(["c.csv", null]);
    expect(r).toMatchObject({ total: 4, limit: 2, offset: 0, facets: { status: { done: 2, failed: 1, preview: 1 } } });
    const f = await list({ status: "done,failed", key: "customers" });
    expect(f.items.map((j) => j.fileName)).toEqual(["c.csv", "b.csv"]);
    expect(f.facets?.status).toEqual({ done: 2, preview: 1 });
  });

  it("sorts by file name (nulls last), searches and filters days", async () => {
    expect((await list({ sort: "file" })).items.map((j) => j.fileName)).toEqual(["a.csv", "b.csv", "c.csv", null]);
    expect((await list({ sort: "-file" })).items.map((j) => j.fileName)).toEqual(["c.csv", "b.csv", "a.csv", null]);
    expect((await list({ q: "A.CS" })).items.map((j) => j.fileName)).toEqual(["a.csv"]);
    expect((await list({ from: "2026-10-02", to: "2026-10-03" })).total).toBe(2);
    await expect(list({ sort: "nope" })).rejects.toThrow(AppError);
  });
});
