/**
 * Database test of the Phase 4 part B tables: search words (owner edits are kept, a rename marks them stale, the backfill),
 * bought-together rows (replaced per shop, partners for a cart) and the shopper chat's daily total from `ai_runs`.
 * Runs only with `AI_TEST_DATABASE_URL` (a development Postgres with migration 0041 applied); it copies the tables into a
 * throw-away schema and drops it.
 *   PowerShell: $env:AI_TEST_DATABASE_URL="postgres://srikit:srikit@127.0.0.1:5432/srikit"; npx vitest run src/store/store.db.test.ts
 */
import { createDb, type Db } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveAiConfig } from "../config";
import { AI_SETTINGS_DEFAULTS } from "../features";
import { MockProvider } from "../mock-provider";
import { AiService } from "../service";
import { AliasService, type AliasProduct } from "./aliases";
import { ShopperChat } from "./chat";
import { fixtureChatPorts, P, T1, T2 } from "./fixture";
import { TogetherService } from "./together";

const URL_ = process.env.AI_TEST_DATABASE_URL;
const SCHEMA = `ai_store_it_${Math.random().toString(36).slice(2, 10)}`;

describe.skipIf(!URL_)("Phase 4 part B tables on a database", () => {
  let db: Db;
  let close: () => Promise<void>;
  let spent = 0;
  const names = new Map<string, string>([
    [P.tomato, "Tomato 1 kg"],
    [P.rice, "Ponni Raw Rice 5 kg"],
    [P.saree, "Silk Saree"],
  ]);
  const mock = new MockProvider([() => JSON.stringify({ tamil: ["தக்காளி"], tanglish: ["thakkali"], synonyms: [], misspellings: [] })]);
  let ai: AiService;
  const ports = {
    products: async (_t: string, ids: string[]): Promise<AliasProduct[]> => ids.filter((i) => names.has(i)).map((id) => ({ id, name: names.get(id)! })),
    withoutAliases: async (t: string) => (t === T1 ? [P.tomato, P.rice] : []),
  };
  const creditsPort = () => ({
    balance: async () => ({ period: "2026-10", unlimited: false, allowance: 10000, allowanceUsed: spent, topUp: 0, remaining: 10000 - spent }),
    charge: async (_t: string, n: number) => {
      spent += n;
      return n;
    },
  });

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", `${SCHEMA},public`);
    ({ db, close } = createDb(u.toString(), { max: 4 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of ["ai_runs", "ai_product_aliases", "ai_item_pairs"]) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    ai = new AiService({
      db,
      config: resolveAiConfig({ NODE_ENV: "test" }, { mock }),
      settings: { get: async () => ({ ...AI_SETTINGS_DEFAULTS, enabled: true, features: { "shopper-chat": true } }) },
      featureOn: async () => true,
      credits: creditsPort(),
    });
  });
  afterAll(async () => {
    await db.execute(sql.raw(`drop schema "${SCHEMA}" cascade`));
    await close();
  });

  it("search words: generated once, owner edits are kept, a rename makes them stale, another shop sees nothing", async () => {
    const svc = new AliasService({ db, ai, ports });
    const first = await svc.generate(T1, P.tomato, { userId: "u1" });
    expect(first).toMatchObject({ aliases: ["தக்காளி", "thakkali"], source: "ai", stale: false });
    // fresh already: skipped without a model call
    const calls = mock.calls.length;
    expect(await svc.generate(T1, P.tomato)).toBeNull();
    expect(mock.calls.length).toBe(calls);
    // the owner's list replaces it and AI never overwrites it unless forced
    const own = await svc.setByOwner(T1, P.tomato, ["Thakkali ", "takkali", "tomato pazham", "call 9876543210", "thakkali"]);
    expect(own).toMatchObject({ aliases: ["thakkali", "takkali", "tomato pazham"], source: "owner" });
    expect(await svc.generate(T1, P.tomato)).toBeNull();
    expect((await svc.generate(T1, P.tomato, { force: true }))!.source).toBe("ai");
    // a rename marks the words stale and the next generate refreshes them
    names.set(P.tomato, "Tomato Hybrid 1 kg");
    expect((await svc.get(T1, P.tomato))!.stale).toBe(true);
    expect(await svc.generate(T1, P.tomato)).not.toBeNull();
    // shop isolation
    expect(await svc.get(T2, P.tomato)).toBeNull();
    const rows = (await db.execute(sql`select alias_text from ai_product_aliases where tenant_id = ${T1}::uuid and product_id = ${P.tomato}::uuid`)) as unknown as { alias_text: string }[];
    expect(rows[0]!.alias_text).toBe("தக்காளி thakkali");
    expect(await svc.counts(T1, [P.tomato, P.rice])).toEqual({ [P.tomato]: 2 });
  });

  it("the backfill estimates credits, skips what is done and stops when the helper is switched off", async () => {
    const svc = new AliasService({ db, ai, ports });
    expect(await svc.estimate(T1, 50)).toMatchObject({ count: 2, credits: 4 });
    expect(await svc.estimate(T2, 50)).toMatchObject({ count: 0, credits: 0 });
    const r = await svc.process({ tenantId: T1, userId: "u1", productIds: [P.tomato, P.rice, "00000000-0000-4000-8000-0000000000ff"] });
    expect(r).toMatchObject({ done: 1, skipped: 2, failed: 0, stopped: null });
    const offAi = new AiService({
      db,
      config: resolveAiConfig({ NODE_ENV: "test" }, { mock }),
      settings: { get: async () => ({ ...AI_SETTINGS_DEFAULTS, enabled: true, features: { "search-aliases": false } }) },
      featureOn: async () => true,
      credits: creditsPort(),
    });
    const off = new AliasService({ db, ai: offAi, ports });
    expect(await off.process({ tenantId: T1, productIds: [P.saree, P.rice] })).toMatchObject({ done: 0, stopped: "ai_feature_off" });
  });

  it("bought together: a refresh replaces the shop's rows only; partners for a cart rank by confidence x lift and skip what is in the cart", async () => {
    const rows: { basket: string; productId: string }[] = [];
    let b = 0;
    const add = (n: number, items: string[]) => {
      for (let i = 0; i < n; i++) {
        b++;
        for (const p of items) rows.push({ basket: `b${b}`, productId: p });
      }
    };
    add(20, [P.tomato, P.rice]);
    add(8, [P.tomato]);
    add(6, [P.rice]);
    add(120, [P.saree]);
    const svc = new TogetherService({ db, ports: { baskets: async (t) => (t === T1 ? rows : []), incidental: async () => [], tenants: async () => [T1, T2], enabled: async (t) => t === T1 } });
    expect(await svc.refresh(T1)).toEqual({ baskets: 154, pairs: 2 });
    expect(await svc.hasData(T1)).toBe(true);
    expect(await svc.hasData(T2)).toBe(false);
    const p = await svc.partners(T1, [P.tomato]);
    expect(p.map((x) => x.productId)).toEqual([P.rice]);
    expect(p[0]!.confidence).toBeCloseTo(20 / 28, 5);
    expect(p[0]!.lift).toBeCloseTo(20 / 28 / (26 / 154), 4);
    // the cart already has rice: nothing left to suggest
    expect(await svc.partners(T1, [P.tomato, P.rice])).toEqual([]);
    // another shop's table is empty and a refresh of it leaves shop 1 alone
    await svc.refresh(T2);
    expect((await svc.partners(T1, [P.rice])).map((x) => x.productId)).toEqual([P.tomato]);
    expect(await svc.partners(T2, [P.rice])).toEqual([]);
    // the daily job skips shops whose switch is off
    expect(await svc.refreshAll()).toEqual({ shops: 1, pairs: 2, failed: 0 });
  });

  it("the shopper chat's daily total sums its own ai_runs since midnight IST, for this shop only", async () => {
    const now = new Date("2026-10-24T06:00:00Z");
    const ins = (t: string, feature: string, credits: number, at: string) =>
      db.execute(sql`insert into ai_runs (tenant_id, feature, tier, model, provider, status, credits, period, created_at) values (${t}::uuid, ${feature}, 'light', 'm', 'mock', 'ok', ${credits}, '2026-10', ${at}::timestamptz)`);
    await ins(T1, "shopper-chat", 40, "2026-10-24T01:00:00Z");
    await ins(T1, "shopper-chat", 25, "2026-10-24T05:00:00Z");
    await ins(T1, "shopper-chat", 999, "2026-10-23T12:00:00Z"); // yesterday IST
    await ins(T1, "ask-shop", 500, "2026-10-24T05:00:00Z"); // another helper
    await ins(T2, "shopper-chat", 300, "2026-10-24T05:00:00Z"); // another shop
    const chat = new ShopperChat({
      db,
      ai,
      ports: fixtureChatPorts(),
      settings: { get: async () => ({ ...AI_SETTINGS_DEFAULTS, enabled: true, features: { "shopper-chat": true } }) },
      featureOn: async () => true,
      now: () => now,
    });
    expect(await chat.spentToday(T1)).toBe(65);
    expect((await chat.status(T1)).available).toBe(true);
    expect((await chat.status(T2)).reason).toBe("capped");
  });
});
