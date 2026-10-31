import { emptyContext, type RequestContext } from "@rbms/core";
import type { Db } from "@rbms/db";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { normalizeSeller } from "./logic";
import type { BranchSellerInfo, LoyaltyRedeemPort } from "./ports";
import { invoicesRoutes } from "./routes";
import { InvoicesService, mergeBranchSeller, type InvoicesDeps } from "./service";

const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "sri", planId: "pro", appId: "BL" };
const branchId = "55555555-5555-4555-8555-555555555555";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const branchInfo = (patch: Partial<BranchSellerInfo> = {}): BranchSellerInfo => ({
  branchId,
  isDefault: false,
  gstin: null,
  stateCode: null,
  address: null,
  city: null,
  pincode: null,
  phone: null,
  invoicePrefix: null,
  stockLocationId: null,
  ...patch,
});

describe("mergeBranchSeller", () => {
  const profile = normalizeSeller({
    legalName: "Sri Silks",
    gstin: "33AAACR5055K1ZE",
    stateCode: "33",
    address: "1 Main Rd",
    city: "Chennai",
    pincode: "600001",
    phone: "044 1234",
    invoicePrefix: "SRI",
  });

  it("returns the profile without a branch", () => {
    expect(mergeBranchSeller(profile, null)).toBe(profile);
  });

  it("overrides only the branch's non-null fields", () => {
    const m = mergeBranchSeller(profile, branchInfo({ address: "5 Temple St", city: "Madurai", invoicePrefix: "mdu" }));
    expect(m.address).toBe("5 Temple St");
    expect(m.city).toBe("Madurai");
    expect(m.invoicePrefix).toBe("MDU");
    expect(m.gstin).toBe("33AAACR5055K1ZE");
    expect(m.stateCode).toBe("33");
    expect(m.pincode).toBe("600001");
    expect(m.legalName).toBe("Sri Silks");
  });

  it("takes the branch GSTIN and its state (from the GSTIN when the branch has no state code)", () => {
    const m = mergeBranchSeller(profile, branchInfo({ gstin: "29aagcb7383j1z4" }));
    expect(m.gstin).toBe("29AAGCB7383J1Z4");
    expect(m.stateCode).toBe("29");
    expect(mergeBranchSeller(profile, branchInfo({ stateCode: "32" })).stateCode).toBe("32");
  });
});

// ------------------------------------------------------------------ issue with loyalty / branches (no database)

function setup(deps: Partial<InvoicesDeps> = {}, tx: () => Promise<unknown> = async () => Promise.reject(new Error("tx failed"))) {
  const db = { transaction: vi.fn(tx) } as unknown as Db;
  const entitlements = { consume: vi.fn(async () => 1), release: vi.fn(async () => undefined) };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new InvoicesService({
    db,
    seller: { get: async () => ({ legalName: "Sri Silks", stateCode: "33", invoicePrefix: "SRI" }) },
    branding: { get: async () => ({ appName: null, logoUrl: null, css: "" }) },
    publicBaseUrl: "https://bill.example.com",
    entitlements,
    log,
    ...deps,
  });
  return { service, db, entitlements, log };
}

const line = { description: "Silk saree", qty: 1, rate: 100_000, gstRate: 5 as const };
const draftInput = (patch: Record<string, unknown> = {}) => ({
  date: "2026-10-15",
  customer: { name: "Ravi", phone: "98765 43210" },
  lines: [line],
  ...patch,
});

describe("loyalty points on a bill", () => {
  it("only applies points when the bill is issued", async () => {
    const { service, db } = setup();
    await expect(service.create(tenant, draftInput({ loyaltyPoints: 100 }))).rejects.toMatchObject({ status: 400, code: "loyalty_on_issue" });
    await expect(service.create(tenant, draftInput({ loyaltyPoints: 0, issue: true }))).rejects.toBeInstanceOf(ZodError);
    await expect(service.create(tenant, draftInput({ loyaltyPoints: 1.5, issue: true }))).rejects.toBeInstanceOf(ZodError);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("needs the loyalty port and a customer phone", async () => {
    await expect(setup().service.create(tenant, draftInput({ loyaltyPoints: 100, issue: true }))).rejects.toMatchObject({
      status: 400,
      code: "loyalty_unavailable",
    });
    const loyalty: LoyaltyRedeemPort = { redeem: vi.fn(), reverse: vi.fn() };
    const { service, entitlements } = setup({ loyalty });
    await expect(
      service.create(tenant, draftInput({ loyaltyPoints: 100, issue: true, customer: { name: "Ravi" } })),
    ).rejects.toMatchObject({ status: 400, code: "loyalty_phone_required" });
    expect(loyalty.redeem).not.toHaveBeenCalled();
    expect(entitlements.consume).not.toHaveBeenCalled();
  });

  it("redeems against the grand total before the transaction and gives the points back when the issue fails", async () => {
    const loyalty = {
      redeem: vi.fn(async () => ({ points: 100, discount: 10_000 })),
      reverse: vi.fn(async () => ({})),
    };
    const { service, entitlements } = setup({ loyalty });
    await expect(service.create(tenant, draftInput({ loyaltyPoints: 100, issue: true }))).rejects.toThrow("tx failed");
    // ₹1,000 + 5% GST = ₹1,050.
    expect(loyalty.redeem).toHaveBeenCalledWith(tenant.id, {
      phone: "+919876543210",
      name: "Ravi",
      points: 100,
      invoiceId: expect.stringMatching(UUID),
      orderAmount: 105_000,
    });
    const invoiceId = (loyalty.redeem.mock.calls[0] as unknown as [string, { invoiceId: string }])[1].invoiceId;
    expect(loyalty.reverse).toHaveBeenCalledWith(tenant.id, invoiceId);
    expect(entitlements.consume).toHaveBeenCalledTimes(1);
    expect(entitlements.release).toHaveBeenCalledTimes(1);
  });

  it("does not reverse when the redemption itself is refused, and logs a failed reverse", async () => {
    const refused = { redeem: vi.fn(async () => Promise.reject(Object.assign(new Error("no"), { status: 409 }))), reverse: vi.fn() };
    const a = setup({ loyalty: refused });
    await expect(a.service.create(tenant, draftInput({ loyaltyPoints: 100, issue: true }))).rejects.toMatchObject({ status: 409 });
    expect(refused.reverse).not.toHaveBeenCalled();
    expect(a.entitlements.release).toHaveBeenCalledTimes(1);

    const broken = {
      redeem: vi.fn(async () => ({ points: 100, discount: 10_000 })),
      reverse: vi.fn(async () => Promise.reject(new Error("loyalty down"))),
    };
    const b = setup({ loyalty: broken });
    await expect(b.service.create(tenant, draftInput({ loyaltyPoints: 100, issue: true }))).rejects.toThrow("tx failed");
    expect(b.log.error).toHaveBeenCalled();
  });
});

describe("branch seller on issue", () => {
  it("computes the bill with the branch's state and asks the branches port", async () => {
    const branches = { seller: vi.fn(async () => branchInfo({ gstin: "29AAGCB7383J1Z4", invoicePrefix: "BLR" })) };
    const loyalty = { redeem: vi.fn(async () => ({ points: 10, discount: 0 })), reverse: vi.fn(async () => ({})) };
    const { service } = setup({ branches, loyalty });
    // Customer in Karnataka (29): intra-state for the Bengaluru branch, inter-state for the Chennai profile.
    await expect(
      service.create(tenant, draftInput({ loyaltyPoints: 10, issue: true, customer: { name: "Ravi", phone: "9876543210", stateCode: "29" } }), {
        branchId,
      }),
    ).rejects.toThrow("tx failed");
    expect(branches.seller).toHaveBeenCalledWith(tenant.id, branchId);
    expect(loyalty.redeem).toHaveBeenCalledWith(tenant.id, expect.objectContaining({ orderAmount: 105_000 }));
  });

  it("rejects a non-uuid branch id", async () => {
    const { service } = setup();
    await expect(service.create(tenant, draftInput(), { branchId: "main" })).rejects.toBeInstanceOf(ZodError);
  });
});

describe("routes pass the request branch and points", () => {
  async function build(branch: RequestContext["branch"]) {
    const service = {
      create: vi.fn(async () => ({ id: "inv" })),
      issue: vi.fn(async () => ({ id: "inv" })),
    } as unknown as InvoicesService;
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = { ...emptyContext(), tenant, user: { id: "u1", sessionId: "s1", platformRoles: [], tenantRoles: ["staff"] }, branch };
    });
    app.setErrorHandler((err: { status?: number; statusCode?: number }, _req, reply) => {
      reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: true });
    });
    await app.register(invoicesRoutes(service), { prefix: "/v1/invoices" });
    return { app, service };
  }
  const id = "22222222-2222-4222-8222-222222222222";

  it("create and issue get the branch id (null without one)", async () => {
    const { app, service } = await build({ id: branchId, code: "MDU", locationId: null });
    await app.inject({ method: "POST", url: "/v1/invoices", payload: { a: 1 } });
    expect(service.create).toHaveBeenCalledWith(tenant, { a: 1 }, { branchId });
    await app.inject({ method: "POST", url: `/v1/invoices/${id}/issue`, payload: { loyaltyPoints: 250 } });
    expect(service.issue).toHaveBeenCalledWith(tenant, id, { branchId, loyaltyPoints: 250 });

    const plain = await build(undefined);
    await plain.app.inject({ method: "POST", url: `/v1/invoices/${id}/issue` });
    expect(plain.service.issue).toHaveBeenCalledWith(tenant, id, { branchId: null });
    await plain.app.inject({ method: "POST", url: "/v1/invoices", payload: {} });
    expect(plain.service.create).toHaveBeenCalledWith(tenant, {}, { branchId: null });
  });

  it("rejects bad points", async () => {
    const { app, service } = await build(null);
    expect((await app.inject({ method: "POST", url: `/v1/invoices/${id}/issue`, payload: { loyaltyPoints: -5 } })).statusCode).toBe(400);
    expect(service.issue).not.toHaveBeenCalled();
  });
});
