/**
 * Database test of the daily summary job: one summary per shop and day however many times the job ticks, retry of a
 * failed day, manual re-send, and shops that are off. Runs only with AI_TEST_DATABASE_URL (migration 0038 applied); it
 * copies the table into a throw-away schema.
 *   $env:AI_TEST_DATABASE_URL="postgres://srikit:srikit@127.0.0.1:5432/srikit"; npx vitest run src/insights/daily.db.test.ts
 */
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { kit } from "../assist/test-kit";
import { DailySummaryService, type DailyPorts } from "./daily";
import type { SummaryFacts } from "./summary";

const URL_ = process.env.AI_TEST_DATABASE_URL;
const SCHEMA = `ai_daily_${Math.random().toString(36).slice(2, 10)}`;
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const facts = (date: string): SummaryFacts => ({
  date,
  weekday: 6,
  today: { bills: 3, amount: 150000, cash: 100000, upi: 50000, card: 0, other: 0 },
  lastWeek: { date: "2026-10-17", bills: 2, amount: 100000 },
  vsLastWeekPct: 50,
  topItems: [],
  lowStock: { count: 0, top: [] },
  deadStock: { count: 0, top: [] },
  dues: { count: 0, amount: 0, overdue: [] },
  expiring: null,
  purchases: { count: 0, amount: 0 },
  expenses: { count: 0, amount: 0 },
});

describe.skipIf(!URL_)("daily summary job on a database", () => {
  let db: Db;
  let close: () => Promise<void>;
  let clock = new Date("2026-10-24T15:31:00Z"); // 21:01 IST
  const settings: Record<string, { enabled: boolean; features: Record<string, boolean>; dailySummary?: unknown }> = {
    [A]: { enabled: true, features: {}, dailySummary: { enabled: true, time: "21:00", language: "en", phones: [], toOwner: true } },
    [B]: { enabled: false, features: {}, dailySummary: { enabled: true, time: "21:00", language: "en", phones: [], toOwner: true } },
  };
  const deliver = vi.fn(async () => ({ whatsapp: [], email: [], skipped: ["whatsapp_not_configured"] }));
  const factsFn = vi.fn(async (_t: string, date: string) => facts(date));
  const ports: DailyPorts = {
    facts: factsFn,
    shopName: async () => "Kumar Stores",
    aiSettings: async (t) => settings[t]!,
    candidates: async () => [A, B],
    deliver,
  };
  const make = () => {
    const k = kit({ responders: [() => JSON.stringify({ narrative: "Sales ₹1,500 from 3 bills.", actions: [] })] });
    return { k, svc: new DailySummaryService({ db, ai: k.service, ports, now: () => clock }) };
  };
  const rows = async (t = A) => (await db.execute(sql.raw(`select status, attempts, source, trigger from "${SCHEMA}"."ai_daily_summaries" where tenant_id = '${t}' order by date`))) as unknown as { status: string; attempts: number; source: string; trigger: string }[];

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 4 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    await db.execute(sql.raw(`create table "${SCHEMA}"."ai_daily_summaries" (like public."ai_daily_summaries" including all)`));
  });
  afterAll(async () => {
    await db.execute(sql.raw(`drop schema "${SCHEMA}" cascade`));
    await close();
  });

  it("makes one summary per shop and day, however often or how concurrently the job ticks; shops with AI off get nothing", async () => {
    const { svc, k } = make();
    const results = await Promise.all([svc.tick(), svc.tick(), svc.tick()]);
    const done = results.flat().filter((r) => r.tenantId === A && r.outcome === "ready");
    expect(done).toHaveLength(1);
    await svc.tick();
    expect(await rows(A)).toEqual([{ status: "ready", attempts: 1, source: "ai", trigger: "schedule" }]);
    expect(await rows(B)).toEqual([]);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(factsFn).toHaveBeenCalledTimes(1);
    expect(k.spent()).toBeGreaterThan(0);
  });
  it("is not due before the chosen time and not again the next morning", async () => {
    const { svc } = make();
    clock = new Date("2026-10-25T03:00:00Z"); // 08:30 IST next day
    expect(await svc.tick()).toEqual([]);
    clock = new Date("2026-10-25T15:20:00Z"); // 20:50 IST
    expect(await svc.tick()).toEqual([]);
    clock = new Date("2026-10-25T15:31:00Z");
    expect((await svc.tick()).map((r) => r.outcome)).toEqual(["ready"]);
    expect((await rows(A)).length).toBe(2);
  });
  it("retries a failed day up to three attempts, and a manual send replaces the day", async () => {
    clock = new Date("2026-10-26T15:31:00Z");
    factsFn.mockRejectedValueOnce(new Error("db down"));
    const { svc } = make();
    expect((await svc.tick())[0]!.outcome).toBeTruthy();
    expect((await rows(A)).at(-1)).toMatchObject({ status: "failed", attempts: 1 });
    expect((await svc.tick())[0]!.outcome).toBe("ready"); // the next 15-minute tick retries
    expect((await rows(A)).at(-1)).toMatchObject({ status: "ready", attempts: 2 });
    const r = await svc.run(A, { trigger: "manual", date: "2026-10-26" });
    expect(r.status).toBe("ready");
    expect((await rows(A)).at(-1)).toMatchObject({ status: "ready", attempts: 3, trigger: "manual" });
  });
  it("uses the template when credits ran out, and skips when the helper is switched off", async () => {
    clock = new Date("2026-10-27T15:31:00Z");
    const empty = kit({ remaining: 0 });
    const svc = new DailySummaryService({ db, ai: empty.service, ports, now: () => clock });
    expect((await svc.tick())[0]!.outcome).toBe("ready");
    expect((await rows(A)).at(-1)).toMatchObject({ status: "ready", source: "template" });
    clock = new Date("2026-10-28T15:31:00Z");
    settings[A]!.features = { "daily-summary": false };
    expect((await svc.tick())).toEqual([{ tenantId: A, outcome: "ai_feature_off" }]);
    expect((await rows(A)).length).toBe(4);
  });
});
