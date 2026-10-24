/**
 * Database test of the AI run log: recording, feedback, usage by helper and day, the platform table and the debug
 * purge. Runs only with `AI_TEST_DATABASE_URL` (a development Postgres with migration 0035 applied); it copies the table
 * into a throw-away schema and drops it.
 *   PowerShell: $env:AI_TEST_DATABASE_URL="postgres://srikit:srikit@127.0.0.1:5432/srikit"; npx vitest run src/service.db.test.ts
 */
import { createDb, type Db } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveAiConfig } from "./config";
import { AI_SETTINGS_DEFAULTS } from "./features";
import { MockProvider } from "./mock-provider";
import { AiService } from "./service";

const URL_ = process.env.AI_TEST_DATABASE_URL;
const SCHEMA = `ai_it_${Math.random().toString(36).slice(2, 10)}`;
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe.skipIf(!URL_)("AiService on a database", () => {
  let db: Db;
  let close: () => Promise<void>;
  let svc: AiService;
  let used = 0;
  let clock = new Date("2026-10-24T06:00:00Z");

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 4 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    await db.execute(sql.raw(`create table "${SCHEMA}"."ai_runs" (like public."ai_runs" including all)`));
    svc = new AiService({
      db,
      config: resolveAiConfig({ NODE_ENV: "test" }, { mock: new MockProvider() }),
      settings: { get: async () => ({ ...AI_SETTINGS_DEFAULTS, enabled: true, storePrompts: true }) },
      featureOn: async () => true,
      credits: {
        balance: async () => ({ period: "2026-10", unlimited: false, allowance: 1000, allowanceUsed: used, topUp: 0, remaining: 1000 - used }),
        charge: async (_t, n) => {
          used += n;
          return n;
        },
      },
      shops: async (ids) => new Map(ids.map((id) => [id, { slug: id === A ? "kumar" : "raja", name: id === A ? "Kumar Stores" : "Raja Traders" }])),
      now: () => clock,
    });
  });
  afterAll(async () => {
    await db.execute(sql.raw(`drop schema "${SCHEMA}" cascade`));
    await close();
  });

  const run = (tenantId: string, feature = "hsn-suggest", text = "cotton shirt") => svc.run({ tenantId, feature, tier: "light", system: "s", input: { text } });

  it("records each run with tokens, cost and credits, and tracks feedback of the shop's own runs only", async () => {
    const r1 = await run(A);
    const r2 = await run(A, "product-description");
    await run(B);
    const runs = await svc.recentRuns(A);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ status: "ok", provider: "mock", tier: "light" });
    expect(runs[0]).not.toHaveProperty("debug");

    await expect(svc.feedback(B, r1.runId, "accepted")).rejects.toMatchObject({ code: "not_found" });
    await svc.feedback(A, r1.runId, "accepted");
    await svc.feedback(A, r2.runId, "edited", "  changed the wording  ");
    const [row] = (await db.execute(sql.raw(`select feedback, feedback_note from "${SCHEMA}"."ai_runs" where id = '${r2.runId}'`))) as unknown as { feedback: string; feedback_note: string }[];
    expect(row).toEqual({ feedback: "edited", feedback_note: "changed the wording" });
  });

  it("summarises usage by helper and by day, and how often drafts were saved without edits", async () => {
    const u = await svc.usage(A, 30);
    expect(u.byFeature.map((f) => f.feature).sort()).toEqual(["hsn-suggest", "product-description"]);
    expect(u.byDay).toHaveLength(1);
    expect(u.byDay[0]!.day).toBe("2026-10-24");
    expect(u.byDay[0]!.runs).toBe(2);
    expect(u.savedWithoutEdits).toBeCloseTo(0.5);
    expect((await svc.usage(B, 30)).byFeature).toHaveLength(1);
  });

  it("gives the platform a per-shop table for a month", async () => {
    const t = await svc.adminUsage("2026-10");
    expect(t.items.map((i) => i.slug).sort()).toEqual(["kumar", "raja"]);
    expect(t.total.runs).toBe(3);
    expect(t.items.find((i) => i.slug === "kumar")).toMatchObject({ name: "Kumar Stores", runs: 2, ok: 2 });
    expect((await svc.adminUsage("2026-09")).items).toHaveLength(0);
    expect((await svc.status(A)).credits.usedThisMonth).toBe(used - (await svc.usage(B, 30)).byFeature.reduce((n, f) => n + f.credits, 0));
  });

  it("clears stored debug prompts after 7 days", async () => {
    const before = await svc.purgeDebug();
    expect(before).toBe(0);
    clock = new Date("2026-11-05T06:00:00Z");
    expect(await svc.purgeDebug()).toBe(3);
    expect(await svc.purgeDebug()).toBe(0);
  });
});
