import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalStorage, isValidKey, signLocal, verifyLocalSignature } from "./local";
import { S3Storage, contentDisposition } from "./s3";

describe("isValidKey", () => {
  it("accepts normal keys", () => {
    expect(isValidKey("t/abc/avatar/2026/01/id-photo.png")).toBe(true);
    expect(isValidKey("t/abc/avatar/2026/01/id-photo.png.thumb.webp")).toBe(true);
  });

  it("rejects traversal and odd characters", () => {
    for (const k of ["", "../x", "a/../b", "a/..", "/abs", "a//b", "a/.meta/x", ".meta/x", "a\\b", "a b", "a%2e%2e/b", "C:/x", "a/b/"]) {
      expect(isValidKey(k), k).toBe(false);
    }
  });
});

describe("local signatures", () => {
  const now = Date.UTC(2026, 0, 1);
  const exp = Math.floor(now / 1000) + 60;

  it("verifies matching key, exp and method", () => {
    const sig = signLocal("s3cret", "t/a/b.png", exp, "PUT");
    expect(verifyLocalSignature("s3cret", { key: "t/a/b.png", exp, sig, method: "PUT" }, now)).toBe(true);
    expect(verifyLocalSignature("s3cret", { key: "t/a/b.png", exp: String(exp), sig, method: "PUT" }, now)).toBe(true);
  });

  it("rejects wrong method, key, secret, expiry or missing params", () => {
    const sig = signLocal("s3cret", "t/a/b.png", exp, "PUT");
    expect(verifyLocalSignature("s3cret", { key: "t/a/b.png", exp, sig, method: "GET" }, now)).toBe(false);
    expect(verifyLocalSignature("s3cret", { key: "t/a/c.png", exp, sig, method: "PUT" }, now)).toBe(false);
    expect(verifyLocalSignature("other", { key: "t/a/b.png", exp, sig, method: "PUT" }, now)).toBe(false);
    expect(verifyLocalSignature("s3cret", { key: "t/a/b.png", exp, sig, method: "PUT" }, now + 61_000)).toBe(false);
    expect(verifyLocalSignature("s3cret", { key: "t/a/b.png", exp: undefined, sig, method: "PUT" }, now)).toBe(false);
    expect(verifyLocalSignature("s3cret", { key: "t/a/b.png", exp, sig: undefined, method: "PUT" }, now)).toBe(false);
  });
});

describe("LocalStorage", () => {
  let dir: string;
  let store: LocalStorage;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sr-uploads-"));
    store = new LocalStorage({ dir, apiBaseUrl: "http://localhost:4000/", secret: "sek" });
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("puts, heads, gets and deletes", async () => {
    const key = "t/x/misc/2026/01/id-a.txt";
    expect(await store.head(key)).toBeNull();
    await store.put(key, Buffer.from("hello"), "text/plain");
    expect(await store.head(key)).toEqual({ size: 5, contentType: "text/plain" });
    expect((await store.get(key)).toString()).toBe("hello");
    await store.delete(key);
    expect(await store.head(key)).toBeNull();
  });

  it("refuses keys that escape the root", async () => {
    await expect(store.put("../evil.txt", Buffer.from("x"), "text/plain")).rejects.toThrow(/Invalid storage key/);
    await expect(store.get("a/../../evil")).rejects.toThrow(/Invalid storage key/);
    expect(() => store.pathFor("..")).toThrow();
  });

  it("presigns PUT and GET URLs that verify", async () => {
    const key = "t/x/misc/2026/01/id-a.png";
    const put = await store.presignPut(key, { contentType: "image/png", contentLength: 10, expiresIn: 60 });
    expect(put.headers).toEqual({ "Content-Type": "image/png" });
    const u = new URL(put.url);
    expect(u.origin + u.pathname).toBe(`http://localhost:4000/v1/uploads/local/${encodeURIComponent(key)}`);
    const q = { exp: u.searchParams.get("exp")!, sig: u.searchParams.get("sig")! };
    expect(store.verify(key, q, "PUT")).toBe(true);
    expect(store.verify(key, q, "GET")).toBe(false);

    const get = new URL(await store.presignGet(key, { expiresIn: 60, downloadName: "My file.png" }));
    expect(get.pathname).toBe(`/v1/uploads/files/${encodeURIComponent(key)}`);
    expect(get.searchParams.get("dl")).toBe("My file.png");
    expect(store.verify(key, { exp: get.searchParams.get("exp")!, sig: get.searchParams.get("sig")! }, "GET")).toBe(true);
  });

  it("builds public URLs", () => {
    expect(store.publicUrl("t/x/a.png")).toBe("http://localhost:4000/v1/uploads/files/t/x/a.png");
  });
});

describe("S3Storage", () => {
  const creds = { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" };

  it("presigns PUT with signed content-type (offline)", async () => {
    const s3 = new S3Storage({ bucket: "my-bucket", region: "ap-south-1", credentials: creds });
    expect(s3.driver).toBe("s3");
    const { url, headers } = await s3.presignPut("t/a/b c.png", { contentType: "image/png", contentLength: 123, expiresIn: 600 });
    const u = new URL(url);
    expect(u.hostname).toBe("my-bucket.s3.ap-south-1.amazonaws.com");
    expect(u.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(headers).toEqual({ "Content-Type": "image/png" });
    expect(s3.publicUrl("t/a/b c.png")).toBe("https://my-bucket.s3.ap-south-1.amazonaws.com/t/a/b%20c.png");
  });

  it("supports R2 endpoints with path-style URLs", async () => {
    const r2 = new S3Storage({
      bucket: "assets",
      endpoint: "https://acc123.r2.cloudflarestorage.com",
      forcePathStyle: true,
      credentials: creds,
      publicBaseUrl: "https://cdn.example.in/",
    });
    expect(r2.driver).toBe("r2");
    const url = new URL(await r2.presignGet("t/a/x.pdf", { expiresIn: 900, downloadName: "Bill.pdf" }));
    expect(url.hostname).toBe("acc123.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/assets/t/a/x.pdf");
    expect(url.searchParams.get("response-content-disposition")).toContain("Bill.pdf");
    expect(r2.publicUrl("t/a/x.pdf")).toBe("https://cdn.example.in/t/a/x.pdf");
  });

  it("encodes download names safely", () => {
    expect(contentDisposition('ரசீது "1".pdf')).toBe(
      `attachment; filename="_____ _1_.pdf"; filename*=UTF-8''${encodeURIComponent('ரசீது "1".pdf')}`,
    );
  });
});
