import { AppError, emptyContext, type RequestContext } from "@srirealtime/core";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { createDocuments } from "./index";
import { DocumentRegistry, safeFilename } from "./registry";
import { sampleInvoice, sampleStatement } from "./test-fixtures";
import type { PdfDriver } from "./driver";

const TENANT = "11111111-1111-4111-8111-111111111111";

function fakeDriver() {
  const calls: { html: string; paper: string }[] = [];
  const driver: PdfDriver = {
    async render(html, opts) {
      calls.push({ html, paper: opts.paper });
      return Buffer.from("%PDF-1.4 fake");
    },
    async close() {},
  };
  return { driver, calls };
}

async function app(ctx: Partial<RequestContext>, deps: Parameters<typeof createDocuments>[0]) {
  const docs = createDocuments(deps);
  const a = Fastify();
  a.decorateRequest("ctx", null as never);
  a.addHook("onRequest", async (req) => {
    req.ctx = { ...emptyContext(), ...ctx };
  });
  const seen: unknown[] = [];
  a.addHook("onRoute", (r) => void seen.push(r.config));
  a.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code } });
    return reply.status(500).send({ error: { code: "internal", message: (err as Error).message } });
  });
  await a.register(async (s) => docs.module.routes!(s), { prefix: "/v1/documents" });
  await a.ready();
  return { a, docs, seen };
}

const staff: Partial<RequestContext> = {
  tenant: { id: TENANT, slug: "raja", planId: null, appId: null },
  user: { id: "u1", sessionId: "s", platformRoles: [], tenantRoles: ["staff"] },
};

describe("DocumentRegistry", () => {
  it("registers, rejects duplicates and bad keys, and overrides", () => {
    const r = new DocumentRegistry();
    const def = { key: "x", paper: "A4" as const, feature: "f", load: async () => ({}), render: () => "<html>", filename: () => "x.pdf" };
    r.register(def);
    expect(() => r.register(def)).toThrow(/already/);
    expect(() => r.register({ ...def, key: "Bad Key" })).toThrow(/Invalid/);
    r.override({ ...def, paper: "A6" });
    expect(r.get("x")?.paper).toBe("A6");
    expect(r.list()).toHaveLength(1);
  });

  it("makes safe file names", () => {
    expect(safeFilename("Invoice-INV/26-27/0001")).toBe("Invoice-INV-26-27-0001.pdf");
    expect(safeFilename('a"b\\c')).toBe("a-b-c.pdf");
    expect(safeFilename("முருகன்")).toBe("document.pdf");
  });

  it("registers built-ins only for the ports given", () => {
    const { driver } = fakeDriver();
    expect(createDocuments({ driver }).registry.list()).toHaveLength(0);
    const all = createDocuments({
      driver,
      invoices: { invoice: async () => null, publicInvoice: async () => null },
      statements: { statement: async () => null },
      orders: { order: async () => null },
      purchases: { purchase: async () => null },
      purchaseOrders: { purchaseOrder: async () => null },
    });
    expect(all.registry.list().map((t) => [t.key, t.paper, t.feature])).toEqual([
      ["invoice", "A4", "invoices"],
      ["invoice-thermal", "80mm", "invoices"],
      ["statement", "A4", "invoices.credit-book"],
      ["packing-slip", "A4", "orders"],
      ["shipping-label", "A6", "orders"],
      ["purchase", "A4", "inventory.purchases"],
      ["purchase-order", "A4", "inventory.purchases"],
    ]);
  });
});

describe("routes", () => {
  it("serves a staff invoice PDF inline with branding and locale", async () => {
    const { driver, calls } = fakeDriver();
    const { a, seen } = await app(staff, {
      driver,
      invoices: {
        invoice: async (tenantId, id) => (tenantId === TENANT && id === "abc" ? sampleInvoice() : null),
        publicInvoice: async () => null,
      },
      branding: { get: async () => ({ appName: "Raja <Silks>", primary: "#aa0000" }) },
    });
    const res = await a.inject({ url: "/v1/documents/invoice/abc.pdf?locale=ta" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe('inline; filename="Invoice-INV-26-27-0042.pdf"');
    expect(res.body.startsWith("%PDF")).toBe(true);
    expect(calls[0]!.paper).toBe("A4");
    expect(calls[0]!.html).toContain("Raja &lt;Silks&gt;");
    expect(calls[0]!.html).toContain("--primary:#aa0000");
    expect(calls[0]!.html).toContain("வரி விலைப்பட்டியல்");
    expect(seen).toContainEqual({ feature: "invoices" });
    expect((await a.inject({ url: "/v1/documents/invoice/missing.pdf" })).statusCode).toBe(404);
    expect((await a.inject({ url: "/v1/documents/invoice/abc.png" })).statusCode).toBe(404);
    expect((await a.inject({ url: "/v1/documents/invoice-thermal/abc.pdf" })).statusCode).toBe(200);
    expect(calls.at(-1)!.paper).toBe("80mm");
  });

  it("requires a staff member", async () => {
    const { driver } = fakeDriver();
    const port = { invoice: async () => sampleInvoice(), publicInvoice: async () => null };
    const anon = await app({ tenant: staff.tenant! }, { driver, invoices: port });
    expect((await anon.a.inject({ url: "/v1/documents/invoice/abc.pdf" })).statusCode).toBe(401);
    const member = await app({ ...staff, user: { ...staff.user!, tenantRoles: ["member"] } }, { driver, invoices: port });
    expect((await member.a.inject({ url: "/v1/documents/invoice/abc.pdf" })).statusCode).toBe(403);
  });

  it("passes statement ranges and serves public invoices by token", async () => {
    const { driver, calls } = fakeDriver();
    const ranges: unknown[] = [];
    const { a } = await app(
      { tenant: null, user: null },
      {
        driver,
        statements: {
          statement: async (_t, _id, range) => {
            ranges.push(range);
            return sampleStatement();
          },
        },
        invoices: {
          invoice: async () => null,
          publicInvoice: async (token) => (token === "tok_1" ? { tenantId: TENANT, invoice: sampleInvoice() } : null),
        },
      },
    );
    const pub = await a.inject({ url: "/v1/documents/public/invoice/tok_1.pdf" });
    expect(pub.statusCode).toBe(200);
    expect(pub.headers["content-type"]).toBe("application/pdf");
    expect(calls[0]!.html).toContain("INV/26-27/0042");
    expect((await a.inject({ url: "/v1/documents/public/invoice/nope.pdf" })).statusCode).toBe(404);
    // statement needs a tenant (anonymous here → 403)
    expect((await a.inject({ url: "/v1/documents/statement/c1.pdf" })).statusCode).toBe(403);

    const s = await app(staff, { driver, statements: { statement: async (_t, _id, range) => (ranges.push(range), sampleStatement()) } });
    const res = await s.a.inject({ url: "/v1/documents/statement/c1.pdf?from=2026-09-01&to=bad" });
    expect(res.statusCode).toBe(200);
    expect(ranges).toEqual([{ from: "2026-09-01" }]);
  });
});
