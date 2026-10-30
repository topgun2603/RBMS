import { AppError } from "@rbms/core";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { NOW, salesDef, TENANT } from "./fixtures.test-helpers";
import type { EmailMessage } from "./ports";
import { emailText, REPORTS_JOBS, ReportsService, type Actor } from "./service";
import { MemoryReportStore } from "./store";
import type { DatasetPort, QueryPlan } from "./types";

const OWNER = "44444444-4444-4444-8444-444444444444";
const STAFF = "55555555-5555-4555-8555-555555555555";

function setup(opts: { rows?: number; failEmail?: string; features?: Record<string, boolean>; noEmail?: boolean; maxExportRows?: number } = {}) {
  const store = new MemoryReportStore();
  const plans: QueryPlan[] = [];
  const sent: EmailMessage[] = [];
  let now = NOW;
  const ds: DatasetPort = {
    definition: { ...salesDef, feature: "test.reports" },
    async query(tenantId, plan) {
      expect(tenantId).toBe(TENANT);
      plans.push(plan);
      const n = Math.min(opts.rows ?? 3, plan.limit + 1);
      return {
        rows: Array.from({ length: n }, (_, i) => ({ date: "2026-10-01", customer: `C${i}`, amount: 1000 * (i + 1) })),
        totals: { count: opts.rows ?? 3, amount: 6000 },
      };
    },
  };
  const service = new ReportsService({
    store,
    email: opts.noEmail
      ? undefined
      : {
          send: async (m) => {
            if (m.to === opts.failEmail) throw new Error("mailbox full");
            sent.push(m);
          },
        },
    features: { isEnabled: async (_t, k) => opts.features?.[k] ?? true },
    now: () => now,
    config: { maxExportRows: opts.maxExportRows },
  });
  service.registerDataset(ds);
  const actor = (userId: string, perms: string[] = ["*"], fullAccess = false): Actor => ({
    tenantId: TENANT,
    userId,
    can: (k) => perms.includes("*") || perms.includes(k),
    fullAccess,
  });
  return { service, store, plans, sent, actor, setNow: (d: Date) => (now = d) };
}

const spec = { dataset: "test.sales", columns: ["date", "customer", "amount"], dateRange: { preset: "last_7_days" } };

const expectError = async (p: Promise<unknown>, status: number, code?: string) => {
  try {
    await p;
    throw new Error("expected an error");
  } catch (e) {
    if (e instanceof ZodError) return expect(status).toBe(400);
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).status).toBe(status);
    if (code) expect((e as AppError).code).toBe(code);
  }
};

describe("datasets", () => {
  it("registers, refuses duplicates and bad definitions", () => {
    const { service } = setup();
    expect(() => service.registerDataset({ definition: salesDef, query: async () => ({ rows: [] }) })).toThrow(/already registered/);
    expect(() => service.registerDataset({ definition: { ...salesDef, id: "x.y", columns: [] }, query: async () => ({ rows: [] }) })).toThrow(/no columns/);
  });

  it("lists only datasets whose feature is on and permission held", async () => {
    const { service, actor } = setup({ features: { "test.reports": false } });
    expect(await service.listDatasets(actor(OWNER))).toEqual([]);
    await expectError(service.run(actor(OWNER), spec), 403, "feature_disabled");

    const on = setup();
    on.service.registerDataset({
      definition: { ...salesDef, id: "test.secret", label: "Secret", permission: "test.secret.view" },
      query: async () => ({ rows: [] }),
    });
    expect((await on.service.listDatasets(on.actor(STAFF, ["reports.view"]))).map((d) => d.id)).toEqual(["test.sales"]);
    const all = await on.service.listDatasets(on.actor(STAFF, ["reports.view", "test.secret.view"]));
    expect(all.map((d) => d.id)).toEqual(["test.sales", "test.secret"]);
    expect(all[0]!.ops.money).toContain("between");
    await expectError(on.service.run(on.actor(STAFF, ["reports.view"]), { dataset: "test.secret" }), 403, "permission_denied");
    await expectError(on.service.run(on.actor(STAFF), { dataset: "nope" }), 404);
    await expectError(on.service.run(on.actor(STAFF), {}), 400);
  });
});

describe("run", () => {
  it("validates, queries with the plan and flags truncation", async () => {
    const { service, actor, plans } = setup({ rows: 10 });
    const r = await service.run(actor(OWNER), { ...spec, limit: 5 });
    expect(plans[0]).toMatchObject({ limit: 5, dateRange: { from: "2026-10-09", to: "2026-10-15" } });
    expect(r).toMatchObject({ rowCount: 5, truncated: true, limit: 5, totals: { amount: 6000 }, mode: "rows" });
    expect(r.rows).toHaveLength(5);
    const small = await service.run(actor(OWNER), { ...spec, limit: 50 });
    expect(small).toMatchObject({ rowCount: 10, truncated: false });
    await expectError(service.run(actor(OWNER), { ...spec, columns: ["zzz"] }), 400, "bad_request");
  });

  it("exports ignore the spec limit and use maxExportRows", async () => {
    const { service, actor, plans } = setup({ maxExportRows: 1234 });
    const f = await service.export(actor(OWNER), { ...spec, limit: 5 }, "csv");
    expect(plans[0]!.limit).toBe(1234);
    expect(f.filename).toBe("sales-2026-10-15.csv");
    expect(f.content.toString("utf8")).toContain("Total,,60.00");
  });
});

describe("saved reports", () => {
  it("private reports are only visible to their creator; shared to all", async () => {
    const { service, actor } = setup();
    const priv = await service.createSaved(actor(STAFF), { name: "Mine", spec });
    const shared = await service.createSaved(actor(OWNER, ["*"], true), { name: "Team", spec, shared: true });
    expect(priv).toMatchObject({ dataset: "test.sales", shared: false, createdBy: STAFF });
    expect((await service.listSaved(actor(STAFF))).map((r) => r.name)).toEqual(["Team", "Mine"]);
    expect((await service.listSaved(actor(OWNER))).map((r) => r.name)).toEqual(["Team"]);
    await expectError(service.getSaved(actor(OWNER), priv.id), 404);
    expect((await service.runSaved(actor(STAFF), shared.id)).report.id).toBe(shared.id);
  });

  it("validates the spec on save and update", async () => {
    const { service, actor } = setup();
    await expectError(service.createSaved(actor(OWNER), { name: "Bad", spec: { dataset: "test.sales", groupBy: ["amount"] } }), 400);
    await expectError(service.createSaved(actor(OWNER), { name: "", spec }), 400);
    const r = await service.createSaved(actor(OWNER), { name: "Ok", spec });
    await expectError(service.updateSaved(actor(OWNER), r.id, { spec: { dataset: "test.sales", columns: ["x"] } }), 400);
    const u = await service.updateSaved(actor(OWNER), r.id, { name: "Renamed", spec: { dataset: "test.sales", groupBy: ["customer"] } });
    expect(u).toMatchObject({ name: "Renamed", spec: { groupBy: ["customer"] } });
  });

  it("only the creator, or an owner for shared reports, may change or delete", async () => {
    const { service, actor } = setup();
    const shared = await service.createSaved(actor(STAFF), { name: "Team", spec, shared: true });
    const other = "77777777-7777-4777-8777-777777777777";
    await expectError(service.updateSaved(actor(other), shared.id, { name: "x" }), 403);
    await expectError(service.deleteSaved(actor(other), shared.id), 403);
    expect(await service.updateSaved(actor(OWNER, ["*"], true), shared.id, { name: "By owner" })).toMatchObject({ name: "By owner" });
    await expectError(service.updateSaved(actor(OWNER, ["*"], true), shared.id, { shared: false }), 403);
    expect(await service.deleteSaved(actor(STAFF), shared.id)).toEqual({ ok: true });
  });
});

describe("schedules", () => {
  it("creates with preset cron and next run in IST; edits recompute; inactive has no next run", async () => {
    const { service, actor } = setup();
    const r = await service.createSaved(actor(OWNER), { name: "Weekly sales", spec });
    const s = await service.createSchedule(actor(OWNER), { reportId: r.id, preset: "weekly", recipients: ["A@x.com", "a@x.com", "b@x.com"] });
    expect(s).toMatchObject({ cron: "0 8 * * 1", format: "xlsx", recipients: ["a@x.com", "b@x.com"], active: true });
    expect(s.nextRunAt!.toISOString()).toBe("2026-10-19T02:30:00.000Z");
    expect(s.timing).toMatchObject({ preset: "weekly", weekday: 1, hour: 8 });

    const u = await service.updateSchedule(actor(OWNER), s.id, { hour: 18 });
    expect(u.cron).toBe("0 18 * * 1");
    const m = await service.updateSchedule(actor(OWNER), s.id, { preset: "monthly" });
    expect(m.cron).toBe("0 18 1 * *");
    expect(m.nextRunAt!.toISOString()).toBe("2026-11-01T12:30:00.000Z");
    const off = await service.updateSchedule(actor(OWNER), s.id, { active: false });
    expect(off.nextRunAt).toBeNull();
    const rec = await service.updateSchedule(actor(OWNER), s.id, { recipients: ["c@x.com"] });
    expect(rec).toMatchObject({ recipients: ["c@x.com"], nextRunAt: null, cron: "0 18 1 * *" });

    await expectError(service.createSchedule(actor(OWNER), { reportId: r.id, preset: "daily", recipients: ["not-an-email"] }), 400);
    expect(await service.listSchedules(actor(OWNER))).toHaveLength(1);
    expect(await service.listSchedules(actor(STAFF))).toHaveLength(0); // private report of someone else
    expect(await service.deleteSchedule(actor(OWNER), s.id)).toEqual({ ok: true });
  });

  it("run-now renders the file and emails each recipient", async () => {
    const { service, actor, sent, store } = setup();
    const r = await service.createSaved(actor(OWNER), { name: "Daily sales", spec });
    const s = await service.createSchedule(actor(OWNER), { reportId: r.id, preset: "daily", recipients: ["a@x.com", "b@x.com"], format: "csv" });
    const out = await service.runNow(actor(OWNER), s.id);
    expect(out.result).toEqual({ status: "ok", rowCount: 3, sentTo: ["a@x.com", "b@x.com"], error: null });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      tenantId: TENANT,
      to: "a@x.com",
      subject: "Daily sales – 09-10-2026 to 15-10-2026",
      attachments: [{ filename: "daily-sales-2026-10-15.csv", contentType: "text/csv; charset=utf-8" }],
    });
    expect(sent[0]!.attachments[0]!.content.toString("utf8")).toContain("Customer");
    expect(sent[0]!.text).toContain("Amount: ₹60.00");
    const after = store.schedules.get(s.id)!;
    expect(after).toMatchObject({ lastStatus: "ok", lastError: null, lastRowCount: 3 });
    expect(after.lastRunAt).toEqual(NOW);
    expect(after.nextRunAt).toEqual(s.nextRunAt); // unchanged
  });

  it("records failures on the schedule (partial email failure, no email, feature off, dataset error)", async () => {
    const a = setup({ failEmail: "b@x.com" });
    const r = await a.service.createSaved(a.actor(OWNER), { name: "R", spec });
    const s = await a.service.createSchedule(a.actor(OWNER), { reportId: r.id, preset: "daily", recipients: ["a@x.com", "b@x.com"] });
    const res = await a.service.runSchedule(TENANT, s.id);
    expect(res).toMatchObject({ status: "failed", sentTo: ["a@x.com"], error: "Could not email b@x.com: mailbox full" });
    expect(a.store.schedules.get(s.id)).toMatchObject({ lastStatus: "failed", lastError: "Could not email b@x.com: mailbox full" });

    const b = setup({ noEmail: true });
    const rb = await b.service.createSaved(b.actor(OWNER), { name: "R", spec });
    const sb = await b.service.createSchedule(b.actor(OWNER), { reportId: rb.id, preset: "daily", recipients: ["a@x.com"] });
    expect(await b.service.runSchedule(TENANT, sb.id)).toMatchObject({ status: "failed", error: "Email is not set up" });

    const c = setup();
    const rc = await c.service.createSaved(c.actor(OWNER), { name: "R", spec });
    const sc = await c.service.createSchedule(c.actor(OWNER), { reportId: rc.id, preset: "daily", recipients: ["a@x.com"] });
    // A column the dataset dropped since the report was saved.
    c.store.reports.set(rc.id, { ...c.store.reports.get(rc.id)!, spec: { dataset: "test.sales", columns: ["gone"] } });
    expect(await c.service.runSchedule(TENANT, sc.id)).toMatchObject({ status: "failed", error: expect.stringContaining("Unknown column") });
    expect(c.store.schedules.get(sc.id)!.lastError).toContain("Unknown column");
  });

  it("skips when the report builder is switched off", async () => {
    const { service, actor, store, sent } = setup();
    const r = await service.createSaved(actor(OWNER), { name: "R", spec });
    const s = await service.createSchedule(actor(OWNER), { reportId: r.id, preset: "daily", recipients: ["a@x.com"] });
    (service as unknown as { deps: { features: { isEnabled: () => Promise<boolean> } } }).deps.features = { isEnabled: async () => false };
    expect(await service.runSchedule(TENANT, s.id)).toMatchObject({ status: "skipped" });
    expect(store.schedules.get(s.id)!.lastStatus).toBe("skipped");
    expect(sent).toHaveLength(0);
  });

  it("runDue claims each due schedule once and moves next_run_at on", async () => {
    const { service, actor, store, sent, setNow } = setup();
    const r = await service.createSaved(actor(OWNER), { name: "R", spec });
    const s = await service.createSchedule(actor(OWNER), { reportId: r.id, preset: "daily", recipients: ["a@x.com"] });
    expect(await service.runDue()).toEqual({ claimed: 0 });
    setNow(new Date("2026-10-16T02:31:00Z")); // 08:01 IST next day
    expect(await service.runDue()).toEqual({ claimed: 1 });
    expect(sent).toHaveLength(1);
    expect(store.schedules.get(s.id)!.nextRunAt!.toISOString()).toBe("2026-10-17T02:30:00.000Z");
    expect(await service.runDue()).toEqual({ claimed: 0 });
  });

  it("with a queue, defines the jobs and enqueues due runs", async () => {
    const defined: string[] = [];
    const enqueued: unknown[] = [];
    const store = new MemoryReportStore();
    let now = NOW;
    const service = new ReportsService({
      store,
      queue: { define: (n) => void defined.push(n), enqueue: async (n, d, o) => void enqueued.push([n, d, o]) },
      now: () => now,
    });
    service.registerDataset({ definition: salesDef, query: async () => ({ rows: [] }) });
    const a: Actor = { tenantId: TENANT, userId: OWNER, can: () => true, fullAccess: true };
    const r = await service.createSaved(a, { name: "R", spec });
    const s = await service.createSchedule(a, { reportId: r.id, preset: "daily", recipients: ["a@x.com"] });
    expect(defined).toEqual([REPORTS_JOBS.due, REPORTS_JOBS.run]);
    expect(service.dueJob()).toEqual({ name: "reports.schedules.due", cron: "*/5 * * * *" });
    now = new Date("2026-10-16T03:00:00Z");
    await service.runDue();
    expect(enqueued).toEqual([[REPORTS_JOBS.run, { tenantId: TENANT, scheduleId: s.id }, { jobId: `report-${s.id}-${s.nextRunAt!.getTime()}` }]]);
  });
});

describe("emailText", () => {
  it("summarises period, rows (with truncation note) and totals in ₹", () => {
    const t = emailText("Sales", {
      dataset: "d",
      mode: "rows",
      columns: [
        { key: "customer", label: "Customer", type: "text", column: "customer" },
        { key: "amount", label: "Amount", type: "money", column: "amount" },
      ],
      rows: [],
      totals: { count: 2, amount: 12345678 },
      rowCount: 1000,
      truncated: true,
      limit: 1000,
      dateRange: { column: "date", from: "2026-10-01", to: "2026-10-15" },
      generatedAt: "",
    });
    expect(t).toContain("Period: 01-10-2026 to 15-10-2026");
    expect(t).toContain("Rows: 1,000 (only the first 1,000 are attached)");
    expect(t).toContain("Amount: ₹1,23,456.78");
  });
});
