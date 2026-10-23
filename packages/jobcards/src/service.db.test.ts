/**
 * Database test of the job card flows that span the card, its lines and the bill: the estimate approval (staff and
 * online), serial numbers on part lines, billing with the advance and the serials passed to the bill, and "track my
 * repair". Runs only with `JOBCARDS_TEST_DATABASE_URL` set (a development Postgres with the jobcards tables migrated);
 * it copies the tables into a throw-away schema and drops it afterwards.
 *   PowerShell: $env:JOBCARDS_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5433/srikit"; pnpm test
 */
import { emptyContext, type RequestContext } from "@srirealtime/core";
import { createDb, type Db } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { BillingPort, JobSummary } from "./ports";
import { jobcardsRoutes, PublicLimiter } from "./routes";
import { JobcardsService } from "./service";
import type { JobApproval } from "./logic";

const URL_ = process.env.JOBCARDS_TEST_DATABASE_URL;
const SCHEMA = `jobcards_it_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["jobcards", "jobcard_lines", "jobcard_events"];
const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "fix", planId: "pro", appId: "SV" };
const ITEM = "33333333-3333-4333-8333-333333333333";
const STAFF = "22222222-2222-4222-8222-222222222222";

describe.skipIf(!URL_)("job cards against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let app: FastifyInstance;
  let service: JobcardsService;
  const bills: Parameters<BillingPort["createBill"]>[1][] = [];
  const told: { job: JobSummary; approval: JobApproval }[] = [];
  /** Serials on the shelf for ITEM. */
  const shelf = new Set(["SSD-001", "SSD-002", "BAT-9"]);

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", `${SCHEMA},public`);
    ({ db, close } = createDb(u.toString(), { max: 3 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    service = new JobcardsService({
      db,
      billing: {
        createBill: async (_t, input) => {
          bills.push(input);
          const total = input.lines.reduce((s, l) => s + Math.round(l.qty * l.rate * (1 + l.gstRate / 100)), 0);
          return { id: "44444444-4444-4444-8444-444444444444", number: "BFX/26-27/0003", total, advancePaid: Math.min(input.advance?.amount ?? 0, total) };
        },
      },
      serials: { unavailable: async (_t, itemId, codes) => codes.filter((c) => itemId !== ITEM || !shelf.has(c)) },
      notify: { statusChanged: () => {}, approvalDecided: (_t, job, approval) => void told.push({ job, approval }) },
    });
    app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = { ...emptyContext(), tenant } as RequestContext;
    });
    app.setErrorHandler((err: { status?: number; statusCode?: number; message: string }, _req, reply) => {
      reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: err.message });
    });
    await app.register(jobcardsRoutes(service, { findPerIp: new PublicLimiter(5, 60_000), findPerJob: new PublicLimiter(4, 60_000) }), { prefix: "/v1/jobcards" });
  });
  afterAll(async () => {
    await app?.close();
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  const laptop = () =>
    service.create(
      tenant.id,
      {
        template: "device",
        customerName: "Ravi",
        customerPhone: "+91 98400 12345",
        advance: 100_000,
        fields: { brand: "Dell", model: "Inspiron", issue: "Slow, battery dead" },
        lines: [
          { description: "Samsung 980 SSD", itemId: ITEM, qty: 1, rate: 400_000, gstRate: 18, serials: ["ssd-001"] },
          { kind: "labour", description: "Labour", qty: 1, rate: 50_000, gstRate: 18 },
        ],
      },
      STAFF,
    );

  it("approves an estimate the staff were told about, with who and how", async () => {
    const job = await laptop();
    const ssd = (j: { lines: { description: string; serials: string[]; id: string }[] }) => j.lines.find((l) => l.description === "Samsung 980 SSD")!;
    expect(ssd(job).serials).toEqual(["SSD-001"]);
    expect(job.fields).toEqual({ brand: "Dell", model: "Inspiron", serial: null, issue: "Slow, battery dead", accessories: [], condition: null });
    await service.moveStatus(tenant.id, job.id, { status: "diagnosed" });
    const waiting = await service.moveStatus(tenant.id, job.id, { status: "awaiting_approval" });
    expect(waiting.next).toEqual([]);
    expect(waiting.approvalRequestedAt).not.toBeNull();
    await expect(service.moveStatus(tenant.id, job.id, { status: "in_progress" })).rejects.toMatchObject({ code: "needs_approval" });

    const approved = await service.recordApproval(tenant.id, job.id, { decision: "approved", channel: "phone", by: "Ravi's son" }, STAFF);
    expect(approved.status).toBe("approved");
    expect(approved.approval).toMatchObject({ decision: "approved", channel: "phone", by: "Ravi's son", amount: approved.totals.total, recordedBy: STAFF });
    expect(approved.next).toEqual(["in_progress"]);
    expect(approved.events.map((e) => e.type)).toEqual(expect.arrayContaining(["approval"]));
    expect(approved.events.find((e) => e.type === "approval")!.note).toContain("Approved by Ravi's son · phone");
    // Editing the details keeps the approval and the serials.
    const edited = await service.update(tenant.id, job.id, { fields: { ...approved.fields, condition: "Scratches" } });
    expect(edited.approval?.decision).toBe("approved");
    expect(ssd(edited).serials).toEqual(["SSD-001"]);
    await expect(service.recordApproval(tenant.id, job.id, { decision: "approved" })).rejects.toMatchObject({ code: "not_awaiting_approval" });
  });

  it("lets the customer approve or decline once on the tracking page, and tells the shop", async () => {
    const job = await laptop();
    await service.moveStatus(tenant.id, job.id, { status: "awaiting_approval" });
    const before = await app.inject({ method: "GET", url: `/v1/jobcards/public/track/${job.trackToken}` });
    expect(before.json()).toMatchObject({ status: "awaiting_approval", canRespond: true, approval: null });
    expect(before.body).not.toContain("98400");

    const res = await app.inject({ method: "POST", url: `/v1/jobcards/public/track/${job.trackToken}/approval`, payload: { decision: "decline" }, headers: { "user-agent": "Test" } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: "diagnosed", canRespond: false, approval: { decision: "declined", channel: "online" } });
    expect(res.body).not.toContain("127.0.0.1");
    const staffView = await service.get(tenant.id, job.id);
    expect(staffView.approval).toMatchObject({ decision: "declined", channel: "online", ip: "127.0.0.1", userAgent: "Test", recordedBy: null });
    expect(told.at(-1)).toMatchObject({ job: { id: job.id }, approval: { decision: "declined" } });

    // Answered: no second answer until it's sent for approval again.
    const again = await app.inject({ method: "POST", url: `/v1/jobcards/public/track/${job.trackToken}/approval`, payload: { decision: "approve" } });
    expect(again.statusCode).toBe(409);
    await service.moveStatus(tenant.id, job.id, { status: "awaiting_approval" });
    const ok = await app.inject({ method: "POST", url: `/v1/jobcards/public/track/${job.trackToken}/approval`, payload: { decision: "approve" } });
    expect(ok.json()).toMatchObject({ status: "approved", approval: { decision: "approved" } });
    expect(told.at(-1)!.approval.decision).toBe("approved");
  });

  it("checks serials against the shelf and keeps them per line", async () => {
    const job = await laptop();
    await expect(service.addLine(tenant.id, job.id, { description: "SSD", itemId: ITEM, qty: 1, rate: 1, serials: ["SSD-001"] })).rejects.toThrow(/already on another line/);
    await expect(service.addLine(tenant.id, job.id, { description: "SSD", itemId: ITEM, qty: 1, rate: 1, serials: ["NOPE-1"] })).rejects.toMatchObject({ code: "serial_unavailable" });
    const added = await service.addLine(tenant.id, job.id, { description: "Battery", itemId: ITEM, qty: 1, rate: 300_000, serials: ["BAT-9"] });
    const battery = added.lines.find((l) => l.description === "Battery")!;
    expect(battery.serials).toEqual(["BAT-9"]);
    const cleared = await service.updateLine(tenant.id, job.id, battery.id, { serials: [] });
    expect(cleared.lines.find((l) => l.id === battery.id)!.serials).toEqual([]);
    const removed = await service.removeLine(tenant.id, job.id, job.lines.find((l) => l.serials.length)!.id);
    expect(removed.lines.flatMap((l) => l.serials)).toEqual([]);
  });

  it("bills with the advance as already paid and the serials on the bill lines", async () => {
    const job = await laptop();
    const { bill, job: billed } = await service.bill(tenant, job.id, {}, { userId: STAFF });
    const input = bills.at(-1)!;
    expect(input.advance).toEqual({ amount: 100_000, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), reference: `Advance on ${job.label}` });
    expect(input.lines.find((l) => l.description === "Samsung 980 SSD")).toMatchObject({ serials: ["SSD-001"] });
    expect(input.lines.find((l) => l.description === "Labour")).not.toHaveProperty("serials");
    expect(bill.advancePaid).toBe(100_000);
    expect(billed.totals.balance).toBe(billed.totals.total - 100_000);

    // A unit sold elsewhere before billing stops the bill.
    const other = await laptop();
    shelf.delete("SSD-001");
    await expect(service.bill(tenant, other.id)).rejects.toMatchObject({ code: "serial_unavailable" });
    shelf.add("SSD-001");
  });

  it("finds the tracking link by job number and the phone's last 4 digits, saying nothing on a mismatch", async () => {
    const job = await laptop();
    const find = (number: string, phoneLast4: string, ip = "10.0.0.1") =>
      app.inject({ method: "POST", url: "/v1/jobcards/public/find", payload: { number, phoneLast4 }, remoteAddress: ip });
    const ok = await find(job.label, "2345");
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toEqual({ token: job.trackToken });
    const wrong = await find(job.label, "9999", "10.0.0.2");
    const unknown = await find("JC-9999", "2345", "10.0.0.3");
    expect(wrong.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(wrong.body).toBe(unknown.body);
    // Per job number: a 4-digit guess from many addresses runs out.
    await find(job.label, "1111", "10.0.0.4");
    await find(job.label, "2222", "10.0.0.5");
    expect((await find(job.label, "2345", "10.0.0.6")).statusCode).toBe(429);
  });
});
