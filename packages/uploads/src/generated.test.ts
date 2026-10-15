import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { UploadsService } from "./service";
import type { StorageAdapter } from "./storage/types";

function setup() {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const storage = {
    put: vi.fn(async (key: string, body: Buffer, type: string) => void objects.set(key, { body, type })),
    publicUrl: (key: string) => `http://api.test/v1/uploads/files/${key}`,
  } as unknown as StorageAdapter;
  const rows: Record<string, unknown>[] = [];
  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          const row = { thumbKey: null, width: null, height: null, createdAt: new Date(), updatedAt: new Date(), ...v };
          rows.push(row);
          return [row];
        },
      }),
    }),
  };
  return { service: new UploadsService(db as never, { storage }), objects, rows };
}

describe("storeGenerated", () => {
  it("stores a server-made image as a ready file with a thumbnail and a public URL", async () => {
    const { service, objects, rows } = setup();
    const body = await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#7c3aed" } }).webp().toBuffer();
    const dto = await service.storeGenerated({ tenantId: "t1", filename: "anarkali-kurti.webp", contentType: "image/webp", body, visibility: "public", purpose: "demo-placeholder" });
    expect(dto).toMatchObject({ status: "ready", contentType: "image/webp", width: 800, height: 1000, visibility: "public", purpose: "demo-placeholder" });
    expect(dto.key).toMatch(/^t\/t1\/demo-placeholder\/\d{4}\/\d{2}\/[0-9a-f-]+-anarkali-kurti\.webp$/);
    expect(dto.url).toBe(`http://api.test/v1/uploads/files/${dto.key}`);
    expect(dto.thumbUrl).toContain(".thumb.webp");
    expect(objects.get(dto.key)?.type).toBe("image/webp");
    expect(rows).toHaveLength(1);
  });

  it("keeps the allow-list: SVG and other refused types are not stored", async () => {
    const { service, objects, rows } = setup();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await expect(service.storeGenerated({ tenantId: "t1", filename: "x.svg", contentType: "image/svg+xml", body: svg })).rejects.toThrow(/not allowed/);
    await expect(service.storeGenerated({ tenantId: "t1", filename: "x.html", contentType: "text/html", body: svg })).rejects.toThrow(/not allowed/);
    await expect(service.storeGenerated({ tenantId: "t1", filename: "x.png", contentType: "image/png", body: Buffer.alloc(0) })).rejects.toThrow();
    expect(objects.size).toBe(0);
    expect(rows).toHaveLength(0);
  });
});
