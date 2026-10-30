/**
 * Database test of the photo cleanup job flow with a stub segmenter and in-memory image ports: queue, run, quality guard,
 * keep-the-original apply / undo, credits as a setting, and shop isolation. Runs only with `AI_TEST_DATABASE_URL` (a
 * development Postgres with migration 0042 applied); it copies the tables into a throw-away schema and drops it.
 *   PowerShell: $env:AI_TEST_DATABASE_URL="postgres://srikit:srikit@127.0.0.1:5432/srikit"; npx vitest run src/imaging/service.db.test.ts
 */
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kit } from "../assist/test-kit";
import type { Alpha } from "./mask";
import type { RgbImage, Segmenter } from "./segment";
import { ImagingService, type CleanupJobPayload } from "./service";

const URL_ = process.env.AI_TEST_DATABASE_URL;
const SCHEMA = `ai_img_${Math.random().toString(36).slice(2, 10)}`;
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const P2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

const redBlock: Segmenter = {
  id: "stub",
  async segment(img: RgbImage): Promise<Alpha> {
    const data = new Uint8Array(img.width * img.height);
    for (let i = 0; i < data.length; i++) data[i] = img.data[i * 3]! > 150 && img.data[i * 3 + 1]! < 80 ? 255 : 0;
    return { data, width: img.width, height: img.height };
  },
};
const fuzzy: Segmenter = { id: "fuzzy", segment: async (i) => ({ data: new Uint8Array(i.width * i.height).fill(128), width: i.width, height: i.height }) };
const blank: Segmenter = { id: "blank", segment: async (i) => ({ data: new Uint8Array(i.width * i.height), width: i.width, height: i.height }) };

async function photo(): Promise<Buffer> {
  const red = await sharp({ create: { width: 120, height: 80, channels: 3, background: { r: 200, g: 20, b: 20 } } }).png().toBuffer();
  return sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 120, g: 120, b: 125 } } }).composite([{ input: red, left: 200, top: 150 }]).jpeg().toBuffer();
}

describe.skipIf(!URL_)("photo cleanup job flow on a database", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 4 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of ["ai_image_cleanups", "ai_tryons"]) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
  });
  afterAll(async () => {
    await db.execute(sql.raw(`drop schema "${SCHEMA}" cascade`));
    await close();
  });

  const make = (opts: { seg?: Segmenter | null; price?: number; remaining?: number | null; aiOn?: boolean } = {}) => {
    const k = kit({ remaining: opts.remaining, settings: { enabled: opts.aiOn ?? true, localCredits: opts.price ? { "image-cleanup": opts.price } : undefined } });
    const products = new Map<string, { id: string; name: string; images: { url: string; alt?: string | null }[] }>([
      [P1, { id: P1, name: "Red block", images: [{ url: "http://x/own/a.jpg", alt: "first" }, { url: "http://x/own/b.jpg" }] }],
      [P2, { id: P2, name: "No photo", images: [] }],
    ]);
    const stored: string[] = [];
    const queued: CleanupJobPayload[] = [];
    const svc = new ImagingService({
      db,
      ai: k.service,
      ports: {
        loadImage: async () => photo(),
        store: async (_t, f) => {
          stored.push(f.filename);
          return { url: `http://x/own/${f.filename}` };
        },
        product: async (t, id) => (t === A ? (products.get(id) ?? null) : null),
        setImages: async (_t, id, images) => void (products.get(id)!.images = images),
        isOwnImage: (_t, url) => url.startsWith("http://x/own/"),
      },
      segmenter: () => (opts.seg === undefined ? redBlock : opts.seg),
      modelId: () => "stub",
      enqueue: async (p) => void queued.push(p),
    });
    return { svc, k, products, stored, queued };
  };

  it("queues one job per photo and reports progress while they run", async () => {
    const { svc, queued } = make();
    const r = await svc.start(A, "u1", { items: [{ productId: P1 }, { productId: P1, imageUrl: "http://x/own/b.jpg" }, { productId: P2 }], style: "white" });
    expect(r.count).toBe(2); // the product without a photo is skipped
    expect(queued).toHaveLength(2);
    let b = await svc.batch(A, r.batchId);
    expect([b.total, b.done, b.waiting, b.finished]).toEqual([2, 0, 2, false]);
    for (const p of queued) await svc.process(p);
    b = await svc.batch(A, r.batchId);
    expect([b.done, b.ready, b.finished]).toEqual([2, 2, true]);
    expect(b.items.every((i) => i.cleanedUrl?.endsWith(".webp"))).toBe(true);
  });

  it("is a no-op on a second run of the same job (retry safe)", async () => {
    const { svc, queued, stored } = make();
    await svc.start(A, null, { items: [{ productId: P1 }], style: "shadow" });
    expect(await svc.process(queued[0]!)).toBe("ready");
    expect(await svc.process(queued[0]!)).toBe("ready");
    expect(stored).toHaveLength(1);
  });

  it("marks a doubtful mask as needing a manual check, and an empty one as failed", async () => {
    const f = make({ seg: fuzzy });
    const r = await f.svc.start(A, null, { items: [{ productId: P1 }], style: "white" });
    await f.svc.process(f.queued[0]!);
    expect((await f.svc.batch(A, r.batchId)).items[0]).toMatchObject({ status: "check", needsCheck: true });
    const e = make({ seg: blank });
    const r2 = await e.svc.start(A, null, { items: [{ productId: P1 }], style: "white" });
    await e.svc.process(e.queued[0]!);
    expect((await e.svc.batch(A, r2.batchId)).items[0]).toMatchObject({ status: "failed", error: "no_product_found" });
  });

  it("keeps the original: apply swaps it in, revert puts it back, nothing is deleted", async () => {
    const { svc, products, queued } = make();
    await svc.start(A, null, { items: [{ productId: P1, imageUrl: "http://x/own/a.jpg" }], style: "white" });
    await svc.process(queued[0]!);
    const [row] = await svc.forProduct(A, P1);
    await svc.apply(A, row!.id);
    expect(products.get(P1)!.images.map((i) => i.url)).toEqual([row!.cleanedUrl, "http://x/own/b.jpg"]);
    expect(products.get(P1)!.images[0]!.alt).toBe("first");
    await expect(svc.discard(A, row!.id)).rejects.toMatchObject({ code: "cleanup_applied" });
    await svc.revert(A, row!.id);
    expect(products.get(P1)!.images.map((i) => i.url)).toEqual(["http://x/own/a.jpg", "http://x/own/b.jpg"]);
    expect((await svc.forProduct(A, P1))[0]!.status).toBe("ready");
    await svc.apply(A, row!.id, "add");
    expect(products.get(P1)!.images.map((i) => i.url)).toEqual([row!.cleanedUrl, "http://x/own/a.jpg", "http://x/own/b.jpg"]);
  });

  it("refuses to apply when the product photos changed since", async () => {
    const { svc, products, queued } = make();
    await svc.start(A, null, { items: [{ productId: P1, imageUrl: "http://x/own/a.jpg" }], style: "white" });
    await svc.process(queued[0]!);
    products.get(P1)!.images = [{ url: "http://x/own/other.jpg" }];
    await expect(svc.apply(A, (await svc.forProduct(A, P1))[0]!.id)).rejects.toMatchObject({ code: "cleanup_photo_changed" });
  });

  it("is free by default, and a setting makes each image cost credits, metered as provider local", async () => {
    const free = make();
    await free.svc.start(A, null, { items: [{ productId: P1 }], style: "white" });
    await free.svc.process(free.queued[0]!);
    expect(free.k.spent()).toBe(0);
    expect(free.k.rows.at(-1)).toMatchObject({ feature: "image-cleanup", provider: "local", status: "ok", credits: 0 });

    const paid = make({ price: 3 });
    await paid.svc.start(A, null, { items: [{ productId: P1 }, { productId: P1, imageUrl: "http://x/own/b.jpg" }], style: "white" });
    for (const p of paid.queued) await paid.svc.process(p);
    expect(paid.k.spent()).toBe(6);
    expect(paid.k.rows.at(-1)).toMatchObject({ provider: "local", credits: 3 });

    const poor = make({ price: 3, remaining: 5 });
    await expect(poor.svc.start(A, null, { items: [{ productId: P1 }, { productId: P1, imageUrl: "http://x/own/b.jpg" }], style: "white" })).rejects.toMatchObject({ code: "ai_credits_exhausted" });
  });

  it("is blocked cleanly when the shop has AI off, and says so when the model is not installed", async () => {
    const off = make({ aiOn: false });
    const r = await off.svc.start(A, null, { items: [{ productId: P1 }], style: "white" });
    await off.svc.process(off.queued[0]!);
    expect((await off.svc.batch(A, r.batchId)).items[0]).toMatchObject({ status: "failed", error: "ai_off" });
    expect(off.k.rows.at(-1)).toMatchObject({ provider: "local", status: "blocked" });
    const none = make({ seg: null });
    await expect(none.svc.start(A, null, { items: [{ productId: P1 }], style: "white" })).rejects.toMatchObject({ code: "image_model_missing" });
    expect((await none.svc.status(A)).installed).toBe(false);
  });

  it("keeps shops apart", async () => {
    const { svc, queued } = make();
    const r = await svc.start(A, null, { items: [{ productId: P1 }], style: "white" });
    await svc.process(queued[0]!);
    await expect(svc.batch(B, r.batchId)).rejects.toMatchObject({ status: 404 });
    const [row] = await svc.forProduct(A, P1);
    await expect(svc.apply(B, row!.id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.start(B, null, { items: [{ productId: P1 }], style: "white" })).rejects.toMatchObject({ status: 404 });
  });

  it("saves, reads and removes try-on metadata, only with an own image and valid anchors", async () => {
    const { svc } = make();
    const ok = { imageUrl: "http://x/own/tryon.png", anchors: { kind: "glasses", leftEye: { x: 0.3, y: 0.5 }, rightEye: { x: 0.7, y: 0.5 } } };
    expect((await svc.saveTryon(A, "u1", P1, ok)).kind).toBe("glasses");
    expect((await svc.tryon(A, P1))?.anchors).toMatchObject({ kind: "glasses" });
    await svc.saveTryon(A, "u1", P1, { imageUrl: "http://x/own/t2.png", anchors: { kind: "earrings", hook: { x: 0.5, y: 0.1 } } });
    expect((await svc.tryon(A, P1))?.kind).toBe("earrings");
    await expect(svc.saveTryon(A, null, P1, { ...ok, imageUrl: "http://evil/x.png" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.saveTryon(A, null, P1, { imageUrl: ok.imageUrl, anchors: { kind: "glasses", leftEye: { x: 0.7, y: 0.5 }, rightEye: { x: 0.3, y: 0.5 } } })).rejects.toMatchObject({ status: 400 });
    expect(await svc.tryon(B, P1)).toBeNull();
    expect(await svc.publicTryon(A, P1, false)).toBeNull();
    expect(await svc.publicTryon(A, P1, true)).not.toBeNull();
    await svc.removeTryon(A, P1);
    expect(await svc.tryon(A, P1)).toBeNull();
  });
});
