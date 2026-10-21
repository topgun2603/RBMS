/**
 * Database test of the media-library list (`UploadsService.page`): tenant scoping, kind / visibility / name filters,
 * LIKE escaping and keyset paging over rows created in the same millisecond. Runs only with
 * `UPLOADS_TEST_DATABASE_URL` set (a development Postgres with the `files` table migrated); it copies the table into a
 * throw-away schema and drops it afterwards.
 *   PowerShell: $env:UPLOADS_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5433/srikit"; pnpm test
 */
import { createDb, type Db } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { files } from "./schema";
import { UploadsService } from "./service";
import type { StorageAdapter } from "./storage/types";

const URL_ = process.env.UPLOADS_TEST_DATABASE_URL;
const SCHEMA = `uploads_it_${Math.random().toString(36).slice(2, 10)}`;
const A = "11111111-1111-4111-8111-111111111111";
const B = "33333333-3333-4333-8333-333333333333";

describe.skipIf(!URL_)("media library list against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let service: UploadsService;

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 2 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    await db.execute(sql.raw(`create table "${SCHEMA}"."files" (like public."files" including all)`));
    const storage = { driver: "local", publicUrl: (k: string) => `http://api.test/v1/uploads/files/${k}` } as unknown as StorageAdapter;
    service = new UploadsService(db, { storage });
    // One instant for most rows (a seed writes many files in the same millisecond); ids decide the order there.
    const at = new Date("2026-10-20T10:00:00.123Z");
    const row = (n: number, over: Partial<typeof files.$inferInsert> = {}) => ({
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      tenantId: A,
      key: `t/${A}/site/${n}.webp`,
      originalName: `photo-${n}.webp`,
      contentType: "image/webp",
      size: 100,
      status: "ready" as const,
      visibility: "public" as const,
      purpose: "site",
      createdAt: at,
      ...over,
    });
    await db.insert(files).values([
      ...Array.from({ length: 7 }, (_, i) => row(i + 1)),
      row(8, { originalName: "Kanchi Saree 50%_off.jpg", contentType: "image/jpeg", createdAt: new Date("2026-10-21T08:00:00Z") }),
      row(9, { originalName: "shop-tour.mp4", contentType: "video/mp4" }),
      row(10, { originalName: "invoice.pdf", contentType: "application/pdf", visibility: "private", purpose: "receipts" }),
      row(11, { status: "pending" }),
      row(12, { tenantId: B, key: `t/${B}/site/12.webp` }),
    ]);
    // Microsecond spread inside the same millisecond, as defaultNow() produces.
    await db.execute(sql.raw(`update "${SCHEMA}"."files" set created_at = created_at + (random() * interval '0.0009 second') where created_at = '2026-10-20T10:00:00.123Z'`));
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("filters by kind, visibility and tenant, newest first", async () => {
    const images = await service.page({ tenantId: A, kind: "image", visibility: "public" });
    expect(images.items.map((f) => f.originalName)[0]).toBe("Kanchi Saree 50%_off.jpg");
    expect(images.items).toHaveLength(8);
    expect(images.items.every((f) => f.contentType.startsWith("image/") && f.tenantId === A)).toBe(true);
    expect(images.nextCursor).toBeNull();
    const videos = await service.page({ tenantId: A, kind: "video" });
    expect(videos.items.map((f) => f.originalName)).toEqual(["shop-tour.mp4"]);
  });

  it("searches names case-insensitively, with wildcards taken literally", async () => {
    expect((await service.page({ tenantId: A, q: "kanchi" })).items).toHaveLength(1);
    expect((await service.page({ tenantId: A, q: "50%_" })).items).toHaveLength(1);
    expect((await service.page({ tenantId: A, q: "%" })).items).toHaveLength(1);
    expect((await service.page({ tenantId: A, q: "_" })).items).toHaveLength(1);
  });

  it("pages with a cursor without skipping or repeating rows", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const page = await service.page({ tenantId: A, kind: "image", limit: 3, cursor });
      seen.push(...page.items.map((f) => f.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
  });
});
