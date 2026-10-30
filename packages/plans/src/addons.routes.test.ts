import { AppError, emptyContext, type RequestContext } from "@rbms/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { plansRoutes } from "./routes";
import type { PlansService } from "./service";

const TENANT = "11111111-1111-4111-8111-111111111111";

function stub() {
  return {
    listAddons: vi.fn(async (opts?: { appId?: string | null }) => [{ id: "extra-staff", appId: null }, { id: "ec-wa", appId: opts?.appId ?? "EC" }]),
    getAddon: vi.fn(async () => null),
    upsertAddon: vi.fn(async (a: { id: string }) => a),
    deleteAddon: vi.fn(async () => undefined),
    credits: vi.fn(async () => ({ sms_per_month: 5000 })),
  };
}

async function build(service: ReturnType<typeof stub>, ctx: Partial<RequestContext> = {}) {
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = { ...emptyContext(), ...ctx };
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code } });
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: "invalid_input" } });
    return reply.status(500).send({ error: { code: "other" } });
  });
  await app.register(async (s) => plansRoutes(service as unknown as PlansService)(s), { prefix: "/v1/plans" });
  return app;
}

const owner: Partial<RequestContext> = {
  tenant: { id: TENANT, slug: "anbu", planId: "ec-pro", appId: "EC" },
  user: { id: "u1", sessionId: "s", platformRoles: [], tenantRoles: ["owner"] } as RequestContext["user"],
};
const superAdmin: Partial<RequestContext> = { user: { id: "sa", sessionId: "s", platformRoles: ["superadmin"], tenantRoles: [] } as RequestContext["user"] };

describe("add-on catalogue routes", () => {
  it("anyone reads the public add-ons of the shop's app (or ?app=)", async () => {
    const service = stub();
    const app = await build(service, owner);
    expect((await app.inject("/v1/plans/addons")).statusCode).toBe(200);
    expect(service.listAddons).toHaveBeenLastCalledWith({ publicOnly: true, appId: "EC" });
    await (await build(service)).inject("/v1/plans/addons?app=SV");
    expect(service.listAddons).toHaveBeenLastCalledWith({ publicOnly: true, appId: "SV" });
    // ?all=1 is ignored for non-super-admins.
    await app.inject("/v1/plans/addons?all=1");
    expect(service.listAddons).toHaveBeenLastCalledWith({ publicOnly: true, appId: "EC" });
  });

  it("super-admins list every add-on (one app's with ?app=), and edit the catalogue", async () => {
    const service = stub();
    const app = await build(service, superAdmin);
    const all = await app.inject("/v1/plans/addons?all=1&app=SV");
    expect(all.json().items.map((a: { id: string }) => a.id)).toEqual(["extra-staff"]);
    const put = await app.inject({ method: "PUT", url: "/v1/plans/addons/ec-extra-staff", payload: { code: "extra-staff", kind: "limit", name: "Extra staff", limits: { staff: 5 } } });
    expect(put.statusCode).toBe(200);
    expect(service.upsertAddon).toHaveBeenCalledWith(expect.objectContaining({ id: "ec-extra-staff", kind: "limit" }));
    expect((await app.inject({ method: "DELETE", url: "/v1/plans/addons/ec-extra-staff" })).statusCode).toBe(200);
    expect((await app.inject(`/v1/plans/credits/${TENANT}`)).json()).toEqual({ tenantId: TENANT, credits: { sms_per_month: 5000 } });
  });

  it("shop owners can't edit the catalogue or read another shop's credits", async () => {
    const service = stub();
    const app = await build(service, owner);
    expect((await app.inject({ method: "PUT", url: "/v1/plans/addons/x", payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: "/v1/plans/addons/x" })).statusCode).toBe(403);
    expect((await app.inject(`/v1/plans/credits/${TENANT}`)).statusCode).toBe(403);
    expect(service.upsertAddon).not.toHaveBeenCalled();
    expect(service.deleteAddon).not.toHaveBeenCalled();
  });
});
