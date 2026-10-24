/**
 * Database test of the Phase 3 part B background flows: catalogue photo batches (progress, merge, existing items, credit
 * stop) and photo tags (estimate, draft, conflict-safe approval, shop isolation). Runs only with `AI_TEST_DATABASE_URL`
 * (a development Postgres with migration 0040 applied); it copies the tables into a throw-away schema and drops it.
 *   PowerShell: $env:AI_TEST_DATABASE_URL="postgres://srikit:srikit@127.0.0.1:5432/srikit"; npx vitest run src/trades/b.db.test.ts
 */
import { createDb, type Db } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kit } from "../assist/test-kit";
import { PhotoBatchService, type PhotoJobPayload } from "./catalogue/service";
import { TagService, type TagProduct } from "./textiles/service";

const URL_ = process.env.AI_TEST_DATABASE_URL;
const SCHEMA = `ai_b_${Math.random().toString(36).slice(2, 10)}`;
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const P2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(120)]).toString("base64");
const IMG = { mediaType: "image/jpeg", data: JPEG };

const photoJson = (name: string, mrp: number, barcode = "") =>
  JSON.stringify({ readable: true, unreadableReason: "", ignoredInstructions: false, products: [{ brand: "Velan", product: name, size: "1 kg", unit: "kg", mrp, price: null, barcode, category: "", confidence: "high", photoKind: "shelf" }] });
const hsnJson = JSON.stringify({ suggestions: [{ hsn: "1006", kind: "goods", official_title: "Rice", gstRate: 0, confidence: "high", reason: "rice" }] });
const tagJson = JSON.stringify({
  readable: true, unreadableReason: "", ignoredInstructions: false, garment: "saree", colours: ["maroon"], fabric: "silk", pattern: "", occasion: ["wedding"], work: ["zari"], sleeve: "", neck: "",
  confidence: { colour: "high", fabric: "medium", pattern: "low", occasion: "medium", work: "high", sleeve: "low", neck: "low" },
});

describe.skipIf(!URL_)("Phase 3 B services on a database", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 4 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of ["ai_photo_batches", "ai_product_tags"]) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
  });
  afterAll(async () => {
    await db.execute(sql.raw(`drop schema "${SCHEMA}" cascade`));
    await close();
  });

  describe("catalogue photos", () => {
    const make = (opts: { remaining?: number | null; photos?: string[] } = {}) => {
      const queue: string[] = [...(opts.photos ?? [photoJson("Basmati Rice", 120), photoJson("Basmati Rice", 120, "8901234567890")])];
      const k = kit({
        remaining: opts.remaining,
        responders: [
          (req) => (req.system.includes("You read a photo") ? (queue.shift() ?? photoJson("Other", 10)) : null),
          (req) => (req.system.includes("HSN code") ? hsnJson : null),
        ],
      });
      const queued: PhotoJobPayload[] = [];
      const svc = new PhotoBatchService({
        db,
        ai: k.service,
        ports: {
          categories: async () => [],
          trade: async () => "grocery",
          existing: { find: async (_t, d) => (d.name.includes("Other") ? { id: "v9", name: "Other 1 kg", match: "name" } : null) },
        },
        enqueue: async (p) => void queued.push(p),
      });
      return { svc, k, queued };
    };

    it("refuses a batch the credits cannot pay for, and more than 20 photos", async () => {
      const { svc } = make({ remaining: 10 });
      await expect(svc.start(A, "u", [IMG])).rejects.toMatchObject({ code: "ai_credits_exhausted", status: 402 });
      await expect(svc.estimate(A, 21)).rejects.toThrow(/at most 20/);
      await expect(svc.start(A, "u", [{ mediaType: "image/jpeg", data: Buffer.alloc(100).toString("base64") }])).rejects.toMatchObject({ code: "ai_bad_image" });
    });
    it("queues, reads each photo with progress, merges the same product and adds HSN", async () => {
      const { svc, queued } = make();
      const { batchId } = await svc.start(A, "u", [IMG, IMG]);
      expect((await svc.get(A, batchId)).status).toBe("queued");
      expect(queued).toHaveLength(1);
      const r = await svc.process(queued[0]!);
      expect(r).toEqual({ products: 1, failed: 0 });
      const v = await svc.get(A, batchId);
      expect(v).toMatchObject({ status: "done", total: 2, done: 2, failed: 0 });
      expect(v.drafts).toHaveLength(1);
      expect(v.drafts[0]).toMatchObject({ name: "Velan Basmati Rice 1 kg", barcode: "8901234567890", photos: [0, 1], mrp: 12000 });
      expect(v.drafts[0]!.hsn?.hsn).toBe("1006");
      expect(v.credits).toBeGreaterThan(0);
    });
    it("marks items the shop already has and does not look up their HSN", async () => {
      const { svc, queued, k } = make({ photos: [photoJson("Other", 10)] });
      const { batchId } = await svc.start(A, "u", [IMG]);
      await svc.process(queued[0]!);
      const v = await svc.get(A, batchId);
      expect(v.drafts[0]!.existing).toMatchObject({ id: "v9" });
      expect(v.drafts[0]!.hsn).toBeNull();
      expect(k.mock.calls.filter((c) => c.system.includes("HSN code"))).toHaveLength(0);
    });
    it("one unreadable photo does not stop the rest; all unreadable = failed batch", async () => {
      const bad = JSON.stringify({ readable: false, unreadableReason: "dark", ignoredInstructions: false, products: [] });
      const { svc, queued } = make({ photos: [bad, photoJson("Salt", 24)] });
      const { batchId } = await svc.start(A, "u", [IMG, IMG]);
      await svc.process(queued[0]!);
      const v = await svc.get(A, batchId);
      expect(v).toMatchObject({ status: "done", failed: 1, done: 2 });
      expect(v.problems).toEqual([{ photo: 0, code: "ai_unreadable_image" }]);
      const all = make({ photos: [bad] });
      const s2 = await all.svc.start(A, "u", [IMG]);
      await all.svc.process(all.queued[0]!);
      expect((await all.svc.get(A, s2.batchId)).status).toBe("failed");
    });
    it("AI switched off stops the batch with the reason", async () => {
      const k = kit({ settings: { enabled: false } });
      const queued: PhotoJobPayload[] = [];
      const svc = new PhotoBatchService({ db, ai: k.service, ports: { categories: async () => [], trade: async () => null, existing: { find: async () => null } }, enqueue: async (p) => void queued.push(p) });
      const { batchId } = await svc.start(A, "u", [IMG, IMG]);
      await svc.process(queued[0]!);
      const v = await svc.get(A, batchId);
      expect(v.status).toBe("failed");
      expect(v.problems.map((p) => p.code)).toEqual(["ai_off", "ai_off"]);
    });
    it("another shop cannot read the batch", async () => {
      const { svc, queued } = make();
      const { batchId } = await svc.start(A, "u", [IMG]);
      await svc.process(queued[0]!);
      await expect(svc.get(B, batchId)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("product tags", () => {
    const store: Record<string, TagProduct[]> = {
      [A]: [
        { id: P1, name: "Maroon Silk Saree", categoryName: "Silk", imageUrl: "http://x/t/a/1.jpg", tags: ["handloom"], attributes: {} },
        { id: P2, name: "Blue Cotton Saree", categoryName: "Cotton", imageUrl: "http://x/t/a/2.jpg", tags: [], attributes: { Fabric: "Cotton" } },
      ],
      [B]: [],
    };
    const updates: { tenant: string; id: string; tags: string[]; attributes: Record<string, string> }[] = [];
    const make = (opts: { remaining?: number | null } = {}) => {
      const k = kit({ remaining: opts.remaining, responders: [(req) => (req.system.includes("product photo") ? tagJson : null)] });
      const queued: { tenantId: string; userId: string | null; batchId: string }[] = [];
      const svc = new TagService({
        db,
        ai: k.service,
        ports: {
          products: async (t, ids) => (store[t] ?? []).filter((p) => ids.includes(p.id)),
          colourValues: async () => ["Maroon", "Blue"],
          loadImage: async () => IMG as never,
          update: async (tenant, id, patch) => {
            updates.push({ tenant, id, ...patch });
            const p = store[tenant]!.find((x) => x.id === id)!;
            p.tags = patch.tags;
            p.attributes = patch.attributes;
          },
        },
        enqueue: async (p) => void queued.push(p),
      });
      return { svc, k, queued };
    };

    it("estimates (products without a photo are left out) and refuses an unaffordable batch", async () => {
      const { svc } = make({ remaining: 5 });
      const est = await svc.estimate(A, [P1, P2]);
      expect(est).toMatchObject({ count: 2, withoutPhoto: 0, enough: false });
      await expect(svc.start(A, "u", [P1])).rejects.toMatchObject({ code: "ai_credits_exhausted" });
      await expect(svc.estimate(A, [])).rejects.toThrow();
    });
    it("drafts, then approval adds tags, never overwrites an owner-set attribute, and records what was applied", async () => {
      const { svc, queued } = make();
      const { batchId } = await svc.start(A, "owner", [P1, P2]);
      await svc.process(queued[0]!);
      const list = await svc.list(A, { batchId });
      expect(list.map((x) => x.status)).toEqual(["draft", "draft"]);
      const second = list.find((x) => x.productId === P2)!;
      expect(second.plan.find((p) => p.field === "fabric")).toMatchObject({ conflict: "Cotton" });

      // product 1: nothing set by the owner -> everything applied
      const first = list.find((x) => x.productId === P1)!;
      const a1 = await svc.approve(A, "owner", first.id);
      expect(a1.result.applied.fabric).toEqual(["Silk"]);
      expect(updates.at(-1)).toMatchObject({ id: P1, attributes: { Fabric: "Silk", Colour: "Maroon", Occasion: "Wedding", Work: "Zari" } });
      expect(updates.at(-1)!.tags).toEqual(expect.arrayContaining(["handloom", "silk", "maroon", "wedding", "zari"]));

      // product 2: the owner's "Cotton" stays unless they choose to replace it
      const a2 = await svc.approve(A, "owner", second.id);
      expect(a2.result.skipped).toEqual([{ field: "fabric", reason: "conflict" }]);
      expect(store[A]![1]!.attributes.Fabric).toBe("Cotton");
      expect(store[A]![1]!.tags).toContain("maroon");
      await expect(svc.approve(A, "owner", second.id)).rejects.toMatchObject({ status: 409 });
    });
    it("replace is only applied when the owner ticks it; bulk approve never replaces", async () => {
      store[A]![1]!.attributes = { Fabric: "Cotton" };
      store[A]![1]!.tags = [];
      const { svc, queued } = make();
      const { batchId } = await svc.start(A, "owner", [P2]);
      await svc.process(queued[0]!);
      const bulk = await svc.approveBatch(A, "owner", batchId);
      expect(bulk).toEqual({ approved: 1, skippedFields: 1 });
      expect(store[A]![1]!.attributes.Fabric).toBe("Cotton");

      const again = await svc.start(A, "owner", [P2]);
      await svc.process(queued[1]!);
      const [row] = await svc.list(A, { batchId: again.batchId });
      await svc.approve(A, "owner", row!.id, { fabric: { values: ["Silk"], replace: true } });
      expect(store[A]![1]!.attributes.Fabric).toBe("Silk");
    });
    it("reject, and shop isolation", async () => {
      const { svc, queued } = make();
      const { batchId } = await svc.start(A, "owner", [P1]);
      await svc.process(queued.at(-1)!);
      const [row] = await svc.list(A, { batchId });
      await expect(svc.reject(B, "x", row!.id)).rejects.toMatchObject({ status: 404 });
      expect((await svc.reject(A, "owner", row!.id)).status).toBe("rejected");
      expect(await svc.list(B)).toEqual([]);
    });
    it("a credit stop marks the rest failed", async () => {
      const k = kit({ settings: { enabled: false } });
      const queued: { tenantId: string; userId: string | null; batchId: string }[] = [];
      const svc = new TagService({
        db,
        ai: k.service,
        ports: { products: async (t, ids) => (store[t] ?? []).filter((p) => ids.includes(p.id)), colourValues: async () => [], loadImage: async () => IMG as never, update: async () => undefined },
        enqueue: async (p) => void queued.push(p),
      });
      const { batchId } = await svc.start(A, "o", [P1, P2]);
      await svc.process(queued[0]!);
      expect((await svc.list(A, { batchId })).map((x) => [x.status, x.error])).toEqual([["failed", "ai_off"], ["failed", "ai_off"]]);
    });
  });
});
