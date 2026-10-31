/**
 * Churn signal SQL (Phase 7 part B). The demo marker is unit-tested; the queries run read-only against a development database
 * only with `PLATFORM_TEST_DATABASE_URL` (nothing is written).
 *   PowerShell: $env:PLATFORM_TEST_DATABASE_URL="postgres://srikit:srikit@127.0.0.1:5432/srikit"; npx vitest run src/ai-platform/churn-data.test.ts
 */
import { aiPlatform } from "@rbms/ai";
import { createDb, type Db } from "@rbms/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { churnSignals, isDemoShop } from "./churn-data";

describe("demo and test shops", () => {
  const demo = new Set(["kumar", "raja"]);
  it("are flagged by the DEMO_SHOPS list, metadata, the e2e prefix or having only platform members", () => {
    expect(isDemoShop({ slug: "kumar", metadata: {} }, demo, 3)).toBe(true);
    expect(isDemoShop({ slug: "real-shop", metadata: { demo: true } }, demo, 3)).toBe(true);
    expect(isDemoShop({ slug: "e2e-bill", metadata: {} }, demo, 1)).toBe(true);
    expect(isDemoShop({ slug: "murugan", metadata: { signup: { source: "www" } } }, demo, 0)).toBe(true);
    expect(isDemoShop({ slug: "murugan", metadata: { signup: { source: "www" } } }, demo, 1)).toBe(false);
  });
});

const URL_ = process.env.PLATFORM_TEST_DATABASE_URL;
describe.skipIf(!URL_)("churn signals on a development database (read-only)", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(() => {
    ({ db, close } = createDb(URL_!, { max: 4 }));
  });
  afterAll(async () => {
    await close?.();
  });

  it("reads every active shop and scores it without errors", async () => {
    const now = new Date();
    const list = await churnSignals({ db, demoSlugs: new Set(), trade: async () => null }, now);
    expect(list.length).toBeGreaterThan(0);
    for (const { shop, signals } of list) {
      expect(shop.tenantId).toBe(signals.tenantId);
      expect(Object.keys(signals.daily).every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
      const a = aiPlatform.assessShop({ ...signals, tickets: { waiting: 0, oldestWaitingAt: null } }, now);
      expect(a.score).toBeGreaterThanOrEqual(0);
      expect(a.score).toBeLessThanOrEqual(100);
    }
  }, 60_000);
});
