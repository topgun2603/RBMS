/**
 * Database test of the bulk Tamil translation flow: estimate, start, background drafting, review (approve / edit / reject),
 * credit stops and shop isolation. Runs only with `AI_TEST_DATABASE_URL` (a development Postgres with migration 0037
 * applied); it copies the table into a throw-away schema and drops it.
 *   PowerShell: $env:AI_TEST_DATABASE_URL="postgres://srikit:srikit@127.0.0.1:5432/srikit"; npx vitest run src/assist/translations.db.test.ts
 */
import { createDb, type Db } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kit } from "./test-kit";
import { TranslationService, estimateOne, type TranslateJobPayload, type TranslateSource } from "./translations";

const URL_ = process.env.AI_TEST_DATABASE_URL;
const SCHEMA = `ai_tr_${Math.random().toString(36).slice(2, 10)}`;
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const P2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const P3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

const catalog: Record<string, TranslateSource[]> = {
  [A]: [
    { id: P1, name: "Cotton kurti", description: "Soft cotton kurti in blue. Machine washable." },
    { id: P2, name: "Steel bottle", description: "Keeps water cold. Free delivery." },
    { id: P3, name: "Jaggery powder", description: null },
  ],
  [B]: [],
};

const tamil = (req: { messages: { content: unknown }[] }) => {
  const c = req.messages.at(-1)!.content;
  const text = typeof c === "string" ? c : (c as { text?: string }[]).map((b) => b.text ?? "").join("");
  if (text.includes("Steel bottle")) return JSON.stringify({ name_ta: "ஸ்டீல் பாட்டில்", description_ta: "தண்ணீரை குளிர்ச்சியாக வைக்கும். இலவச டெலிவரி." });
  if (text.includes("FAILME")) throw new Error("boom");
  return JSON.stringify({ name_ta: text.includes("Jaggery") ? "வெல்லப் பொடி" : "பருத்தி குர்தி", description_ta: text.includes("Jaggery") ? "" : "மென்மையான பருத்தி குர்தி. இலவச டெலிவரி!" });
};

describe.skipIf(!URL_)("TranslationService on a database", () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 4 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    await db.execute(sql.raw(`create table "${SCHEMA}"."ai_product_translations" (like public."ai_product_translations" including all)`));
  });
  afterAll(async () => {
    await db.execute(sql.raw(`drop schema "${SCHEMA}" cascade`));
    await close();
  });

  const make = (opts: { remaining?: number | null; queue?: boolean } = {}) => {
    const k = kit({ remaining: opts.remaining, responders: [tamil] });
    const queued: TranslateJobPayload[] = [];
    const svc = new TranslationService({
      db,
      ai: k.service,
      products: { get: async (t, ids) => (catalog[t] ?? []).filter((p) => ids.includes(p.id)) },
      enqueue: opts.queue ? async (p) => void queued.push(p) : undefined,
    });
    return { svc, k, queued };
  };

  it("estimates credits before starting and refuses a batch the shop cannot pay for", async () => {
    const { svc } = make({ remaining: 3 });
    const est = await svc.estimate(A, [P1, P2, P3]);
    expect(est.count).toBe(3);
    expect(est.credits).toBeGreaterThan(est.perProduct);
    expect(est.enough).toBe(false);
    await expect(svc.start(A, "u1", [P1, P2])).rejects.toMatchObject({ code: "ai_credits_exhausted", status: 402 });
    expect(estimateOne("claude-opus-5-5", { name: "x", description: "y".repeat(500) })).toBeGreaterThan(estimateOne("claude-opus-5-5", { name: "x", description: null }));
    await expect(svc.estimate(A, [])).rejects.toMatchObject({ status: 400 });
  });

  it("queues the batch, drafts in the background, strips unstated promises, then the owner approves one by one", async () => {
    const { svc, queued, k } = make({ queue: true });
    const { batchId, count } = await svc.start(A, "u1", [P1, P2, P3]);
    expect(count).toBe(3);
    expect(queued).toEqual([{ tenantId: A, userId: "u1", batchId }]);
    expect((await svc.list(A, { batchId })).every((r) => r.status === "queued")).toBe(true);

    expect(await svc.process(queued[0]!)).toEqual({ drafted: 3, failed: 0 });
    expect(k.mock.calls).toHaveLength(3);
    const rows = await svc.list(A, { batchId });
    expect(rows.every((r) => r.status === "draft")).toBe(true);
    const kurti = rows.find((r) => r.productId === P1)!;
    expect(kurti.name).toBe("பருத்தி குர்தி");
    expect(kurti.description).toBe("மென்மையான பருத்தி குர்தி."); // "free delivery" was not in the English source
    expect(kurti.removed).toHaveLength(1);
    const bottle = rows.find((r) => r.productId === P2)!;
    expect(bottle.description).toContain("இலவச டெலிவரி"); // the source said "Free delivery", so the translation may
    expect(rows.find((r) => r.productId === P3)!.description).toBeNull();

    // nothing is approved until the owner says so
    expect(await svc.approvedFor(A, [P1, P2, P3])).toEqual({});
    const edited = await svc.approve(A, "u1", kurti.id, { name: "பருத்தி குர்த்தா" });
    expect(edited).toMatchObject({ status: "approved", name: "பருத்தி குர்த்தா" });
    await expect(svc.approve(A, "u1", kurti.id)).rejects.toMatchObject({ status: 409 }); // already approved
    await svc.reject(A, "u1", bottle.id);
    expect(await svc.approveBatch(A, "u1", batchId)).toEqual({ approved: 1 }); // only the remaining draft
    const approved = await svc.approvedFor(A, [P1, P2, P3]);
    expect(Object.keys(approved).sort()).toEqual([P1, P3].sort());
    expect(approved[P1]!.name).toBe("பருத்தி குர்த்தா");
  });

  it("is isolated per shop", async () => {
    const { svc } = make();
    const { batchId } = await svc.start(A, "u1", [P1]);
    const [row] = await svc.list(A, { batchId });
    expect(await svc.list(B, { batchId })).toEqual([]);
    await expect(svc.approve(B, "u9", row!.id)).rejects.toMatchObject({ status: 404 });
    expect(await svc.approvedFor(B, [P1])).toEqual({});
  });

  it("a switched-off helper stops the batch and marks the rest failed, without charging", async () => {
    const off = kit({ settings: { features: { "product-description": false } }, responders: [tamil] });
    const svc = new TranslationService({ db, ai: off.service, products: { get: async (t, ids) => (catalog[t] ?? []).filter((p) => ids.includes(p.id)) } });
    const { batchId } = await svc.start(A, "u1", [P1, P2]);
    const rows = await svc.list(A, { batchId });
    expect(rows.map((r) => r.status)).toEqual(["failed", "failed"]);
    expect(rows[0]!.error).toBe("ai_feature_off");
    expect(off.spent()).toBe(0);
  });
});
