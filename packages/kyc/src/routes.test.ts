import { AppError, emptyContext, type RequestContext } from "@srirealtime/core";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { createKyc } from "./index";
import type { VendorAccessPort } from "./ports";
import { MemoryKycStore } from "./store";

const TENANT = "11111111-1111-4111-8111-111111111111";
const VENDOR = "33333333-3333-4333-8333-333333333333";
const OWNER_USER = "44444444-4444-4444-8444-444444444444";
const STRANGER = "66666666-6666-4666-8666-666666666666";

async function build() {
  const store = new MemoryKycStore();
  const vendors: VendorAccessPort = { isVendorOwner: async (_t, v, u) => v === VENDOR && u === OWNER_USER };
  const kyc = createKyc({ store, vendors, config: { allowMock: true, secret: "s" } });
  const app = Fastify();
  const configs: Record<string, unknown> = {};
  app.addHook("onRoute", (r) => {
    configs[`${r.method} ${r.url}`] = r.config;
  });
  let ctx: RequestContext = emptyContext();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = ctx;
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: "invalid_input" } });
    return reply.status(500).send({ error: { code: "other", message: (err as Error).message } });
  });
  await app.register(async (s) => kyc.module.routes!(s), { prefix: "/v1/kyc" });
  await app.ready();
  const as = (c: Partial<RequestContext>) => {
    ctx = { ...emptyContext(), ...c };
  };
  return { app, configs, as, kyc, store };
}

const tenant = { id: TENANT, slug: "shop", planId: null, appId: null };
const user = (id: string, tenantRoles: string[], platformRoles: string[] = []) => ({ id, sessionId: "s", platformRoles, tenantRoles, permissions: [] });

describe("kyc routes", () => {
  it("declares feature kyc on every route and module features/permissions", async () => {
    const { configs, kyc } = await build();
    const keys = Object.keys(configs).filter((k) => !k.startsWith("HEAD"));
    expect(keys.sort()).toEqual(
      [
        "DELETE /v1/kyc/documents/:id",
        "GET /v1/kyc/review",
        "GET /v1/kyc/subjects/:type/:id",
        "POST /v1/kyc/checks",
        "POST /v1/kyc/checks/:id/approve",
        "POST /v1/kyc/checks/:id/refresh",
        "POST /v1/kyc/checks/:id/reject",
        "POST /v1/kyc/documents",
      ].sort(),
    );
    for (const k of keys) expect(configs[k]).toMatchObject({ feature: "kyc" });
    expect(kyc.module.features?.map((f) => f.key)).toEqual(["kyc"]);
    expect(kyc.module.permissions?.map((p) => p.key)).toEqual(["kyc.manage"]);
    expect(Object.keys(kyc.module.tables ?? {})).toEqual(["kycSubjects", "kycChecks", "kycDocuments"]);
  });

  it("vendor owner verifies their own vendor; strangers can't; review flow for super-admin", async () => {
    const { app, as, kyc } = await build();
    const body = { subjectType: "vendor", subjectId: VENDOR, type: "pan", input: { pan: "ABCDE1234F" } };

    as({ tenant, user: user(STRANGER, ["member"]) });
    expect((await app.inject({ method: "POST", url: "/v1/kyc/checks", payload: body })).statusCode).toBe(403);

    as({ tenant, user: user(OWNER_USER, ["member"]) });
    const pan = await app.inject({ method: "POST", url: "/v1/kyc/checks", payload: body });
    expect(pan.statusCode).toBe(200);
    expect(pan.json()).toMatchObject({ check: { status: "verified", input: { pan: "XXXXXX234F" } }, subject: { status: "pending" } });
    expect(pan.body).not.toContain("ABCDE1234F");

    const bank = await app.inject({
      method: "POST",
      url: "/v1/kyc/checks",
      payload: { subjectType: "vendor", subjectId: VENDOR, type: "bank_account", input: { accountNumber: "123456789999", ifsc: "SBIN0001234" } },
    });
    expect(bank.json().check).toMatchObject({ status: "manual_review", error: "name_mismatch" });
    expect(bank.body).not.toContain("123456789999");
    const checkId = bank.json().check.id as string;

    const subj = await app.inject({ method: "GET", url: `/v1/kyc/subjects/vendor/${VENDOR}` });
    expect(subj.json()).toMatchObject({ status: "manual_review", checks: [{ type: "bank_account" }, { type: "pan" }] });

    // the review queue is super-admin only
    expect((await app.inject({ method: "GET", url: "/v1/kyc/review" })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/v1/kyc/checks/${checkId}/approve`, payload: {} })).statusCode).toBe(403);

    as({ user: user("sa", [], ["superadmin"]) });
    const queue = await app.inject({ method: "GET", url: "/v1/kyc/review?limit=10" });
    expect(queue.json()).toMatchObject({ total: 1, items: [{ check: { id: checkId }, comparedWith: "TEST NAME" }] });
    expect((await app.inject({ method: "POST", url: `/v1/kyc/checks/${checkId}/reject`, payload: {} })).statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: `/v1/kyc/checks/${checkId}/approve`, payload: { reason: "Cheque matches" } });
    expect(ok.json()).toMatchObject({ check: { status: "verified" }, subject: { verified: true } });

    expect(await kyc.status.status(TENANT, "vendor", VENDOR)).toMatchObject({ verified: true, badges: ["pan", "bank", "verified"] });
  });

  it("bad input is 400 without a stored check", async () => {
    const { app, as, store } = await build();
    as({ tenant, user: user(OWNER_USER, ["owner"]) });
    const r = await app.inject({ method: "POST", url: "/v1/kyc/checks", payload: { subjectType: "shop", subjectId: TENANT, type: "gstin", input: { gstin: "33ABCDE1234F1Z8" } } });
    expect(r.statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/kyc/checks", payload: { subjectType: "x" } })).statusCode).toBe(400);
    expect(store.checks).toHaveLength(0);
  });

  it("documents: add, see, remove; access follows the subject", async () => {
    const { app, as } = await build();
    as({ tenant, user: user(OWNER_USER, ["owner"]) });
    const add = await app.inject({ method: "POST", url: "/v1/kyc/documents", payload: { subjectType: "shop", subjectId: TENANT, kind: "gst_certificate", fileUrl: "/v1/uploads/files/abc" } });
    expect(add.statusCode).toBe(200);
    const id = add.json().id as string;
    as({ tenant, user: user(STRANGER, ["staff"]) });
    expect((await app.inject({ method: "DELETE", url: `/v1/kyc/documents/${id}` })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/v1/kyc/subjects/shop/${TENANT}` })).statusCode).toBe(403);
    as({ tenant, user: user(OWNER_USER, ["owner"]) });
    expect((await app.inject({ method: "DELETE", url: `/v1/kyc/documents/${id}` })).json()).toEqual({ ok: true });
  });

  it("DigiLocker refresh route", async () => {
    const { app, as } = await build();
    as({ tenant, user: user(OWNER_USER, ["member"]) });
    const start = await app.inject({ method: "POST", url: "/v1/kyc/checks", payload: { subjectType: "user", subjectId: OWNER_USER, type: "digilocker_aadhaar", input: {} } });
    const id = start.json().check.id as string;
    as({ tenant, user: user(STRANGER, ["member"]) });
    expect((await app.inject({ method: "POST", url: `/v1/kyc/checks/${id}/refresh` })).statusCode).toBe(403);
    as({ tenant, user: user(OWNER_USER, ["member"]) });
    const done = await app.inject({ method: "POST", url: `/v1/kyc/checks/${id}/refresh` });
    expect(done.json()).toMatchObject({ check: { status: "verified" }, subject: { verified: true } });
  });
});
