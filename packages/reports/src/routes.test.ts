import { AppError, emptyContext, type RequestContext } from "@srirealtime/core";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { NOW, salesDef, TENANT } from "./fixtures.test-helpers";
import { createReports } from "./index";
import { MemoryReportStore } from "./store";

const OWNER = "44444444-4444-4444-8444-444444444444";
const STAFF = "55555555-5555-4555-8555-555555555555";
const tenant = { id: TENANT, slug: "shop", planId: null, appId: null };
const user = (id: string, tenantRoles: string[], permissions: string[] = []) => ({ id, sessionId: "s", platformRoles: [], tenantRoles, permissions });

async function build() {
  const store = new MemoryReportStore();
  const sent: string[] = [];
  const reports = createReports({ store, now: () => NOW, email: { send: async (m) => void sent.push(m.to) } });
  reports.service.registerDataset({
    definition: salesDef,
    query: async () => ({ rows: [{ date: "2026-10-01", customer: "Raja", amount: 150000 }], totals: { count: 1, amount: 150000 } }),
  });
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
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: "invalid_input" } });
    return reply.status(500).send({ error: { code: "other", message: (err as Error).message } });
  });
  await app.register(async (s) => reports.module.routes!(s), { prefix: "/v1/reports" });
  await app.ready();
  const as = (c: Partial<RequestContext>) => {
    ctx = { ...emptyContext(), ...c };
  };
  return { app, configs, as, reports, sent };
}

const spec = { dataset: "test.sales", columns: ["date", "customer", "amount"] };

describe("reports routes", () => {
  it("declares feature, permission on every route; module features, permissions and tables", async () => {
    const { configs, reports } = await build();
    const keys = Object.keys(configs).filter((k) => !k.startsWith("HEAD"));
    expect(keys.sort()).toEqual(
      [
        "GET /v1/reports/datasets",
        "GET /v1/reports/datasets/:id",
        "POST /v1/reports/run",
        "GET /v1/reports/saved",
        "POST /v1/reports/saved",
        "GET /v1/reports/saved/:id",
        "PATCH /v1/reports/saved/:id",
        "DELETE /v1/reports/saved/:id",
        "POST /v1/reports/saved/:id/run",
        "GET /v1/reports/schedules",
        "POST /v1/reports/schedules",
        "GET /v1/reports/schedules/:id",
        "PATCH /v1/reports/schedules/:id",
        "DELETE /v1/reports/schedules/:id",
        "POST /v1/reports/schedules/:id/run-now",
      ].sort(),
    );
    for (const k of keys) {
      const view = k.includes("/datasets") || k.endsWith("/run") || (k.startsWith("GET") && k.includes("/saved"));
      expect(configs[k]).toMatchObject({ feature: "reports.advanced", permission: view ? "reports.view" : "reports.manage" });
    }
    expect(reports.module.features?.map((f) => f.key)).toEqual(["reports.advanced"]);
    expect(reports.module.permissions?.map((p) => p.key)).toEqual(["reports.manage"]);
    expect(Object.keys(reports.module.tables ?? {})).toEqual(["savedReports", "reportSchedules"]);
  });

  it("staff only; reports.view to run, reports.manage to save", async () => {
    const { app, as } = await build();
    as({ tenant, user: user(STAFF, ["member"]) });
    expect((await app.inject({ method: "GET", url: "/v1/reports/datasets" })).statusCode).toBe(403);

    as({ tenant, user: user(STAFF, ["staff"]) });
    const denied = await app.inject({ method: "POST", url: "/v1/reports/run", payload: spec });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toMatchObject({ code: "permission_denied", details: { permission: "reports.view" } });

    as({ tenant, user: user(STAFF, ["staff"], ["reports.view"]) });
    const ds = await app.inject({ method: "GET", url: "/v1/reports/datasets" });
    expect(ds.json().items.map((d: { id: string }) => d.id)).toEqual(["test.sales"]);
    const run = await app.inject({ method: "POST", url: "/v1/reports/run", payload: spec });
    expect(run.statusCode).toBe(200);
    expect(run.json()).toMatchObject({ rowCount: 1, rows: [{ customer: "Raja", amount: 150000 }], totals: { amount: 150000 } });
    const save = await app.inject({ method: "POST", url: "/v1/reports/saved", payload: { name: "x", spec } });
    expect(save.json().error).toMatchObject({ code: "permission_denied", details: { permission: "reports.manage" } });

    const bad = await app.inject({ method: "POST", url: "/v1/reports/run", payload: { dataset: "test.sales", groupBy: ["amount"] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.details.issues[0]).toMatchObject({ path: "groupBy.0" });
  });

  it("csv and xlsx downloads", async () => {
    const { app, as } = await build();
    as({ tenant, user: user(OWNER, ["owner"]) });
    const csv = await app.inject({ method: "POST", url: "/v1/reports/run?format=csv", payload: { spec, title: "My sales" } });
    expect(csv.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(csv.headers["content-disposition"]).toBe('attachment; filename="my-sales-2026-10-15.csv"');
    expect(csv.body).toContain("2026-10-01,Raja,1500.00");
    const xlsx = await app.inject({ method: "POST", url: "/v1/reports/run?format=xlsx", payload: spec });
    expect(xlsx.headers["content-type"]).toContain("spreadsheetml");
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe("PK");
  });

  it("saved CRUD, schedules and run-now for an owner", async () => {
    const { app, as, sent } = await build();
    as({ tenant, user: user(OWNER, ["owner"]) });
    const saved = (await app.inject({ method: "POST", url: "/v1/reports/saved", payload: { name: "Sales", spec, shared: true } })).json();
    expect(saved).toMatchObject({ name: "Sales", dataset: "test.sales", shared: true });
    expect((await app.inject({ method: "GET", url: "/v1/reports/saved" })).json().items).toHaveLength(1);
    expect((await app.inject({ method: "PATCH", url: `/v1/reports/saved/${saved.id}`, payload: { name: "Sales 2" } })).json().name).toBe("Sales 2");
    const run = await app.inject({ method: "POST", url: `/v1/reports/saved/${saved.id}/run` });
    expect(run.json()).toMatchObject({ report: { id: saved.id }, rowCount: 1 });

    const sch = await app.inject({
      method: "POST",
      url: "/v1/reports/schedules",
      payload: { reportId: saved.id, preset: "monthly", recipients: ["owner@shop.in"], format: "csv" },
    });
    expect(sch.statusCode).toBe(200);
    expect(sch.json()).toMatchObject({ cron: "0 8 1 * *", nextRunAt: "2026-11-01T02:30:00.000Z" });
    const now = await app.inject({ method: "POST", url: `/v1/reports/schedules/${sch.json().id}/run-now` });
    expect(now.json()).toMatchObject({ result: { status: "ok", sentTo: ["owner@shop.in"] }, schedule: { lastStatus: "ok" } });
    expect(sent).toEqual(["owner@shop.in"]);
    expect((await app.inject({ method: "GET", url: "/v1/reports/schedules" })).json().items).toHaveLength(1);
    expect((await app.inject({ method: "DELETE", url: `/v1/reports/saved/${saved.id}` })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: "GET", url: "/v1/reports/schedules" })).json().items).toHaveLength(0);
    expect((await app.inject({ method: "GET", url: `/v1/reports/saved/${saved.id}` })).statusCode).toBe(404);
  });
});
