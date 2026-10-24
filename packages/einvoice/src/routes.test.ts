import { AppError, emptyContext, type RequestContext } from "@srirealtime/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createEInvoice } from "./index";
import { einvoiceRoutes } from "./routes";
import type { EInvoiceService } from "./service";

const TENANT = "11111111-1111-4111-8111-111111111111";
const INV = "22222222-2222-4222-8222-222222222222";

function stubService() {
  return {
    getAccount: vi.fn(async () => ({ configured: false })),
    putAccount: vi.fn(async () => ({ configured: true })),
    deleteAccount: vi.fn(async () => {}),
    status: vi.fn(async () => ({ invoiceId: INV, einvoice: null, ewb: null, history: [] })),
    preview: vi.fn(async () => ({ ok: true, issues: [], payload: {} })),
    generateIrn: vi.fn(async () => ({ alreadyGenerated: false, record: { docNo: "INV/1" }, warnings: [] })),
    cancelIrn: vi.fn(async () => ({ docNo: "INV/1", cancelReason: "1" })),
    generateEwb: vi.fn(async () => ({ alreadyGenerated: false, record: { docNo: "INV/1", ewbNo: "1" } })),
    cancelEwb: vi.fn(async () => ({ ewbNo: "1" })),
    gstr1: vi.fn(async () => ({ json: { gstin: "X", fp: "102026" }, warnings: ["w"], counts: {}, filename: "GSTR1_X_102026.json" })),
  };
}

async function build(service: ReturnType<typeof stubService>, ctx: Partial<RequestContext>) {
  const app = Fastify();
  const configs: Record<string, unknown> = {};
  app.addHook("onRoute", (r) => {
    configs[`${r.method} ${r.url}`] = r.config;
  });
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = { ...emptyContext(), ...ctx };
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code } });
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: "invalid_input" } });
    return reply.status(500).send({ error: { code: "other" } });
  });
  await app.register(async (s) => einvoiceRoutes(service as unknown as EInvoiceService)(s), { prefix: "/v1/einvoice" });
  await app.ready();
  return { app, configs };
}

const tenant = { id: TENANT, slug: "shop", planId: null, appId: null };
const as = (roles: string[], permissions?: string[]): Partial<RequestContext> => ({
  tenant,
  user: { id: "u1", sessionId: "s1", platformRoles: [], tenantRoles: roles, permissions },
});

describe("einvoice routes", () => {
  it("declare features and the permission", async () => {
    const { configs } = await build(stubService(), as(["owner"]));
    expect(configs["POST /v1/einvoice/invoices/:invoiceId/irn"]).toMatchObject({ feature: "gst-einvoice", permission: "einvoice.manage", audit: { action: "einvoice.irn.generate" } });
    expect(configs["POST /v1/einvoice/invoices/:invoiceId/irn/cancel"]).toMatchObject({ feature: "gst-einvoice", permission: "einvoice.manage" });
    expect(configs["POST /v1/einvoice/invoices/:invoiceId/ewb"]).toMatchObject({ feature: "gst-ewaybill", permission: "einvoice.manage" });
    expect(configs["POST /v1/einvoice/invoices/:invoiceId/ewb/cancel"]).toMatchObject({ feature: "gst-ewaybill" });
    expect(configs["GET /v1/einvoice/gstr1.json"]).toMatchObject({ feature: "invoices.gst-reports", permission: "reports.view" });
    expect(configs["GET /v1/einvoice/invoices/:invoiceId"]).toEqual({ feature: "gst-einvoice" });
    expect(configs["PUT /v1/einvoice/account"]).toMatchObject({ permission: "einvoice.manage" });
  });

  it("staff need einvoice.manage for writes; reading status is open to staff", async () => {
    const service = stubService();
    const { app } = await build(service, as(["staff"], []));
    expect((await app.inject({ method: "POST", url: `/v1/einvoice/invoices/${INV}/irn` })).json()).toEqual({ error: { code: "permission_denied" } });
    expect((await app.inject({ method: "GET", url: `/v1/einvoice/invoices/${INV}` })).statusCode).toBe(200);
    const { app: allowed } = await build(service, as(["staff"], ["einvoice.manage"]));
    expect((await allowed.inject({ method: "POST", url: `/v1/einvoice/invoices/${INV}/irn` })).statusCode).toBe(200);
    expect(service.generateIrn).toHaveBeenCalledWith(TENANT, INV);
  });

  it("members and anonymous users are refused; ids are validated", async () => {
    expect((await (await build(stubService(), as(["member"]))).app.inject({ method: "GET", url: `/v1/einvoice/invoices/${INV}` })).statusCode).toBe(403);
    expect((await (await build(stubService(), { tenant })).app.inject({ method: "GET", url: `/v1/einvoice/invoices/${INV}` })).statusCode).toBe(401);
    expect((await (await build(stubService(), as(["owner"]))).app.inject({ method: "GET", url: "/v1/einvoice/invoices/nope" })).statusCode).toBe(400);
  });

  it("passes bodies through", async () => {
    const service = stubService();
    const { app } = await build(service, as(["owner"]));
    await app.inject({ method: "POST", url: `/v1/einvoice/invoices/${INV}/irn/cancel`, payload: { reason: 2, remark: "x" } });
    expect(service.cancelIrn).toHaveBeenCalledWith(TENANT, INV, { reason: 2, remark: "x" });
    await app.inject({ method: "POST", url: `/v1/einvoice/invoices/${INV}/ewb`, payload: { distance: 10, vehicleNo: "TN01AB1234" } });
    expect(service.generateEwb).toHaveBeenCalledWith(TENANT, INV, { distance: 10, vehicleNo: "TN01AB1234" });
  });

  it("gstr1.json downloads the file", async () => {
    const service = stubService();
    const { app } = await build(service, as(["owner"]));
    const r = await app.inject({ method: "GET", url: "/v1/einvoice/gstr1.json?period=102026" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-disposition"]).toBe('attachment; filename="GSTR1_X_102026.json"');
    expect(r.headers["x-gstr1-warnings"]).toBe("1");
    expect(r.json()).toEqual({ gstin: "X", fp: "102026" });
    expect((await app.inject({ method: "GET", url: "/v1/einvoice/gstr1.json?period=2026-10" })).statusCode).toBe(400);
  });

  it("createEInvoice declares the module", () => {
    const { module } = createEInvoice({
      db: {} as never,
      config: { encryptionKey: "k", allowMock: true },
      invoices: { getInvoice: async () => null, listForPeriod: async () => [] },
    });
    expect(module.id).toBe("einvoice");
    expect(Object.keys(module.tables!)).toEqual(["einvoiceAccounts", "einvoiceRecords"]);
    expect(module.features!.map((f) => [f.key, f.dependsOn ?? []])).toEqual([
      ["gst-einvoice", []],
      ["gst-ewaybill", ["gst-einvoice"]],
    ]);
    expect(module.permissions!.map((p) => p.key)).toEqual(["einvoice.manage"]);
  });
});
