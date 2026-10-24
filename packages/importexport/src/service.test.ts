import { AppError, emptyContext, type RequestContext } from "@srirealtime/core";
import Fastify from "fastify";
import { ZodError } from "zod";
import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { createImportExport } from "./index";
import { boundaryOf, fileFromMultipart } from "./multipart";
import { customersExporter, productsImporter, type ProductImportRow } from "./specs";
import { MemoryImportJobStore } from "./store";
import { readXlsx, writeXlsx } from "./xlsx";
import type { QueuePort } from "./service";

const TENANT = "11111111-1111-4111-8111-111111111111";
const staffCtx: Partial<RequestContext> = {
  tenant: { id: TENANT, slug: "raja", planId: null, appId: null },
  user: { id: "22222222-2222-4222-8222-222222222222", sessionId: "s", platformRoles: [], tenantRoles: ["staff"] },
};

function setup(opts: { queue?: QueuePort; limits?: { maxBytes?: number; maxRows?: number }; failSku?: string } = {}) {
  const saved: { tenantId: string; rows: ProductImportRow[] }[] = [];
  const ie = createImportExport({ store: new MemoryImportJobStore(), queue: opts.queue, limits: opts.limits });
  ie.registry.registerImporter(
    productsImporter({
      async upsert(tenantId, rows) {
        saved.push({ tenantId, rows: rows.map((r) => r.data) });
        const bad = rows.filter((r) => r.data.sku === opts.failSku);
        return { created: rows.length - bad.length, updated: 0, errors: bad.map((r) => ({ row: r.row, message: "SKU already used" })) };
      },
    }),
  );
  ie.registry.registerExporter(
    customersExporter({
      async *rows() {
        yield { name: "Murugan", phone: "+919876543210", email: null, gstin: null, address: "5, Car St", stateCode: "33", balance: 150050 };
        yield { name: "=cmd|' /C calc'!A0", phone: null, email: null, gstin: null, address: null, stateCode: null, balance: null };
      },
    }),
  );
  return { ie, saved };
}

async function server(ie: ReturnType<typeof setup>["ie"], ctx: Partial<RequestContext> = staffCtx) {
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = { ...emptyContext(), ...ctx };
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: "invalid_input" } });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.status(status).send({ error: { code: "x", message: (err as Error).message } });
  });
  for (const m of ie.modules) await app.register(async (s) => m.routes!(s), { prefix: `/v1/${m.id}` });
  await app.ready();
  return app;
}

const CSV = [
  "Name,SKU,Price,GST %,Tax inclusive,Opening stock",
  "Silk Saree,SS-1,\"2,500.00\",5,yes,3",
  "Cotton Dhoti,CD-1,450.5,5%,no,",
  "Broken,BR-1,abc,15,maybe,",
].join("\r\n");

function multipart(fileName: string, contentType: string, data: Buffer | string) {
  const boundary = "----srikitBoundary7MA4YWxk";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nhello\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`),
    Buffer.isBuffer(data) ? data : Buffer.from(data),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("multipart parser", () => {
  it("extracts the file field and its name", () => {
    const { body, contentType } = multipart("பொருட்கள்.csv", "text/csv", "a,b\r\n1,2");
    expect(boundaryOf(contentType)).toBe("----srikitBoundary7MA4YWxk");
    const f = fileFromMultipart(body, contentType);
    expect(f.fileName).toBe("பொருட்கள்.csv");
    expect(f.data.toString()).toBe("a,b\r\n1,2");
    expect(() => fileFromMultipart(Buffer.from("junk"), contentType)).toThrow(/Malformed/);
  });
});

describe("import flow", () => {
  it("previews a raw CSV upload, commits valid rows inline, and reports status", async () => {
    const { ie, saved } = setup();
    const app = await server(ie);
    const prev = await app.inject({
      method: "POST",
      url: "/v1/import/catalog.products/preview",
      headers: { "content-type": "text/csv", "x-file-name": "products.csv" },
      payload: `﻿${CSV}`,
    });
    expect(prev.statusCode).toBe(200);
    const p = prev.json();
    expect(p.fileName).toBe("products.csv");
    expect(p.totals).toEqual({ rows: 3, valid: 2, invalid: 1 });
    expect(p.missing).toEqual([]);
    expect(p.columns.map((c: { mappedTo: string | null }) => c.mappedTo)).toEqual(["name", "sku", "price", "gst", "tax_inclusive", "opening_stock"]);
    expect(p.rows[0].data).toMatchObject({ name: "Silk Saree", price: 250000, gst: 5, tax_inclusive: true, opening_stock: 3 });
    expect(p.rows[2].row).toBe(4);
    expect(p.rows[2].errors).toEqual([
      "GST %: 15% is not a GST rate (use 0, 0.25, 3, 5, 12, 18 or 28)",
      'Price: "abc" is not an amount',
      'Tax inclusive: "maybe" should be yes or no',
    ]);

    // Not allowed to commit with invalid rows unless skipping them.
    const strict = await app.inject({ method: "POST", url: `/v1/import/${p.jobId}/commit`, payload: { skipInvalid: false } });
    expect(strict.statusCode).toBe(400);
    expect(strict.json().error.details.errors[0].row).toBe(4);

    const commit = await app.inject({ method: "POST", url: `/v1/import/${p.jobId}/commit`, payload: { skipInvalid: true } });
    expect(commit.statusCode).toBe(200);
    expect(commit.json()).toMatchObject({ status: "done", total: 3, processed: 2, created: 2, skipped: 1, failed: 0 });
    expect(commit.json().errors).toEqual([expect.objectContaining({ row: 4, message: expect.stringContaining("Price") })]);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.tenantId).toBe(TENANT);
    expect(saved[0]!.rows[1]).toMatchObject({ name: "Cotton Dhoti", sku: "CD-1", price: 45050, gst: 5, taxInclusive: false, unit: "pcs" });

    const again = await app.inject({ method: "POST", url: `/v1/import/${p.jobId}/commit`, payload: {} });
    expect(again.statusCode).toBe(409);
    const status = await app.inject({ url: `/v1/import/${p.jobId}` });
    expect(status.json().status).toBe("done");
    const list = await app.inject({ url: "/v1/import/jobs" });
    expect(list.json().total).toBe(1);
  });

  it("accepts multipart XLSX uploads, custom mappings, and reports port failures per row", async () => {
    const { ie } = setup({ failSku: "B-2" });
    const app = await server(ie);
    const xlsx = await writeXlsx({
      columns: [{ header: "Item" }, { header: "Code" }, { header: "Amount" }, { header: "Tax" }],
      rows: [
        ["Kurta", "A-1", 799, 0.05],
        ["Shawl", "B-2", "1,200", "12%"],
      ],
    });
    const { body, contentType } = multipart("stock.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsx);
    const prev = await app.inject({ method: "POST", url: "/v1/import/catalog.products/preview", headers: { "content-type": contentType }, payload: body });
    expect(prev.statusCode).toBe(200);
    const p = prev.json();
    expect(p.mapping).toMatchObject({ name: 0, sku: 1, price: null, gst: 3 });
    expect(p.missing).toEqual(["Price"]);
    expect(p.totals.invalid).toBe(2);

    const missing = await app.inject({ method: "POST", url: `/v1/import/${p.jobId}/commit`, payload: {} });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.message).toMatch(/Price/);

    const res = await app.inject({ method: "POST", url: `/v1/import/${p.jobId}/commit`, payload: { mapping: { price: "Amount", sku: "code" } } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "done", created: 1, failed: 1, errors: [{ row: 3, message: "SKU already used" }] });
  });

  it("runs commits through the queue when one is given", async () => {
    const handlers = new Map<string, (d: unknown) => Promise<void>>();
    const queued: unknown[] = [];
    const queue: QueuePort = {
      define: (name, h) => void handlers.set(name, h as (d: unknown) => Promise<void>),
      enqueue: async (name, data) => void queued.push({ name, data }),
    };
    const { ie } = setup({ queue });
    expect(handlers.has("importexport.commit")).toBe(true);
    const p = await ie.service.preview(TENANT, null, "catalog.products", { fileName: "p.csv", contentType: "text/csv", data: Buffer.from(CSV) });
    const st = await ie.service.commit(TENANT, p.jobId, {});
    expect(st.status).toBe("queued");
    expect(queued).toEqual([{ name: "importexport.commit", data: { tenantId: TENANT, jobId: p.jobId } }]);
    await handlers.get("importexport.commit")!({ tenantId: TENANT, jobId: p.jobId });
    expect((await ie.service.status(TENANT, p.jobId)).status).toBe("done");
    // Another tenant can't see the job.
    await expect(ie.service.status("33333333-3333-4333-8333-333333333333", p.jobId)).rejects.toThrow(/not found/);
  });

  it("enforces size and row limits and rejects junk", async () => {
    const { ie } = setup({ limits: { maxBytes: 200, maxRows: 2 } });
    const svc = ie.service;
    const up = (data: string | Buffer, fileName = "x.csv") => svc.preview(TENANT, null, "catalog.products", { fileName, contentType: null, data: Buffer.from(data) });
    await expect(up("Name\n" + "x".repeat(300))).rejects.toMatchObject({ status: 413, code: "file_too_large" });
    await expect(up("Name,Price,GST\na,1,5\nb,1,5\nc,1,5")).rejects.toMatchObject({ status: 413, code: "too_many_rows" });
    await expect(up("Name,Price,GST\na,1,5\nb,1,5")).resolves.toMatchObject({ totals: { rows: 2 } });
    await expect(up("")).rejects.toMatchObject({ status: 400 });
    await expect(up("Name,Price\n")).rejects.toThrow(/no data rows/);
    await expect(up("not a zip", "x.xlsx")).rejects.toThrow(/not a valid .xlsx/);
    await expect(up('Name\n"unclosed')).rejects.toThrow(/Unclosed quote/);

    const app = await server(ie);
    const big = await app.inject({ method: "POST", url: "/v1/import/catalog.products/preview", headers: { "content-type": "text/csv" }, payload: "N\n" + "y".repeat(600_000) });
    expect(big.statusCode).toBe(413);
    const json = await app.inject({ method: "POST", url: "/v1/import/catalog.products/preview", payload: { a: 1 } });
    expect(json.statusCode).toBe(400);
  });

  it("requires staff, and serves templates", async () => {
    const { ie } = setup();
    const anon = await server(ie, { tenant: staffCtx.tenant! });
    expect((await anon.inject({ url: "/v1/import/catalog.products/template.xlsx" })).statusCode).toBe(401);
    const app = await server(ie);
    const t = await app.inject({ url: "/v1/import/catalog.products/template.xlsx" });
    expect(t.statusCode).toBe(200);
    expect(t.headers["content-disposition"]).toBe('attachment; filename="catalog-products-template.xlsx"');
    const rows = await readXlsx(t.rawPayload);
    expect(rows[0]).toContain("Opening stock");
    expect(rows[1]![0]).toBe("Cotton Saree");
    const csv = await app.inject({ url: "/v1/import/catalog.products/template.csv" });
    expect(parseCsv(csv.body)[0]![0]).toBe("Name");
    const importers = await app.inject({ url: "/v1/import/importers" });
    expect(importers.json().items[0].key).toBe("catalog.products");
  });

  it("checks the importer's own permission with patterns", async () => {
    const { ie } = setup();
    const as = (permissions: string[]) => server(ie, { ...staffCtx, user: { ...staffCtx.user!, permissions } });
    const upload = (app: Awaited<ReturnType<typeof as>>) =>
      app.inject({ method: "POST", url: "/v1/import/catalog.products/preview", headers: { "content-type": "text/csv" }, payload: CSV });
    expect((await upload(await as(["importexport.*", "catalogue.*"]))).statusCode).toBe(200);
    const denied = await upload(await as(["importexport.*", "orders.*"]));
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toMatchObject({ code: "permission_denied", details: { permission: "catalogue.manage" } });
  });
});

describe("exports", () => {
  it("streams CSV with BOM, rupees and formula-injection guard", async () => {
    const { ie } = setup();
    const app = await server(ie);
    const res = await app.inject({ url: "/v1/export/invoices.customers.csv" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="invoices-customers.csv"');
    expect(res.body.startsWith("﻿Name,Phone,")).toBe(true);
    const rows = parseCsv(res.body);
    expect(rows[1]).toEqual(["Murugan", "'+919876543210", "", "", "5, Car St", "Tamil Nadu", "", "", "1500.50"]);
    expect(rows[2]![0]).toBe("'=cmd|' /C calc'!A0");
  });

  it("streams XLSX", async () => {
    const { ie } = setup();
    const app = await server(ie);
    const res = await app.inject({ url: "/v1/export/invoices.customers.xlsx" });
    expect(res.statusCode).toBe(200);
    const rows = await readXlsx(res.rawPayload);
    expect(rows[0]![0]).toBe("Name");
    expect(rows[1]).toContain("Murugan");
    expect(rows[1]).toContain("1500.50");
    expect((await app.inject({ url: "/v1/export/nope.csv" })).statusCode).toBe(404);
  });
});
