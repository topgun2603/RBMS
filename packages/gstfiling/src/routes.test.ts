import { emptyContext, type RequestContext } from "@rbms/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { gstFilingRoutes } from "./routes";
import type { GstFilingService } from "./service";
import type { Gstr2bService } from "./service-2b";

describe("date filters on the GST lists", () => {
  const server = async () => {
    const service = { itcRegister: vi.fn(async () => ({ items: [] })), rcmRegister: vi.fn(async () => ({ items: [] })), listTaxPayments: vi.fn(async () => ({ items: [] })), itcRegisterCsv: vi.fn(() => "") };
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = { ...emptyContext(), tenant: { id: "t1", slug: "s", planId: "pro", appId: "BL" }, user: { id: "u1", sessionId: "s1", platformRoles: [], tenantRoles: ["owner"] } } as RequestContext;
    });
    await app.register(gstFilingRoutes(service as unknown as GstFilingService, {} as Gstr2bService));
    return { app, service };
  };

  it("refuses a bad date with a 400 before it reaches the query", async () => {
    const { app, service } = await server();
    for (const url of ["/itc?from=abc", "/itc?to=2026-13-45", "/itc.csv?from=-1", "/rcm?from=abc", "/payments?to=' OR 1=1--", "/rcm?from=2026-02-30"]) {
      expect((await app.inject({ url })).statusCode, url).toBe(400);
    }
    expect(service.itcRegister).not.toHaveBeenCalled();
    expect(service.rcmRegister).not.toHaveBeenCalled();
    expect(service.listTaxPayments).not.toHaveBeenCalled();
  });

  it("passes good dates, and no dates, through", async () => {
    const { app, service } = await server();
    expect((await app.inject({ url: "/itc?from=2026-04-01&to=2026-10-31" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/rcm" })).statusCode).toBe(200);
    expect(service.itcRegister).toHaveBeenCalledOnce();
  });
});
