import { createHmac } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { safeEqual } from "@rbms/core";
import { contentDisposition } from "./s3";
import type { StorageAdapter } from "./types";

export interface LocalStorageConfig {
  /** Directory files are stored in. */
  dir: string;
  /** Public base URL of the API, e.g. "http://localhost:4000". Upload/download URLs point at /v1/uploads/... */
  apiBaseUrl: string;
  /** HMAC secret for signed URLs. */
  secret: string;
  /** Override the base URL for public files. Default `${apiBaseUrl}/v1/uploads/files`. */
  publicBaseUrl?: string;
}

const KEY_RE = /^[a-zA-Z0-9/_.-]+$/;

/**
 * Keys may only contain [a-zA-Z0-9/_.-], must not start with "/", contain "..", empty segments
 * or segments starting with "." (which also keeps the `.meta` sidecar directory unreachable).
 */
export function isValidKey(key: string): boolean {
  if (!key || key.length > 1024 || !KEY_RE.test(key) || key.includes("..")) return false;
  return key.split("/").every((seg) => seg.length > 0 && !seg.startsWith("."));
}

export function assertValidKey(key: string): void {
  if (!isValidKey(key)) throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
}

export type SignedMethod = "PUT" | "GET";

export function signLocal(secret: string, key: string, exp: number, method: SignedMethod): string {
  return createHmac("sha256", secret).update(`${key}${exp}${method}`).digest("hex");
}

/** Verifies a local signed URL: valid signature for this key + method, and not expired. */
export function verifyLocalSignature(
  secret: string,
  input: { key: string; exp: string | number | undefined; sig: string | undefined; method: SignedMethod },
  now: number = Date.now(),
): boolean {
  const exp = Number(input.exp);
  if (!input.sig || !Number.isInteger(exp) || exp * 1000 < now) return false;
  return safeEqual(signLocal(secret, input.key, exp, input.method), input.sig);
}

/** Files on local disk, for development. Uploads go through the API's /v1/uploads/local route. */
export class LocalStorage implements StorageAdapter {
  readonly driver = "local";
  readonly root: string;
  private readonly apiBase: string;

  constructor(readonly config: LocalStorageConfig) {
    this.root = resolve(config.dir);
    this.apiBase = config.apiBaseUrl.replace(/\/+$/, "");
  }

  /** Absolute path for a key; throws on anything that could escape the root. */
  pathFor(key: string): string {
    assertValidKey(key);
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
    return p;
  }

  private metaPath(key: string): string {
    this.pathFor(key);
    return resolve(this.root, ".meta", `${key}.json`);
  }

  private signedQuery(key: string, expiresIn: number, method: SignedMethod) {
    const exp = Math.floor(Date.now() / 1000) + expiresIn;
    return `exp=${exp}&sig=${signLocal(this.config.secret, key, exp, method)}`;
  }

  verify(key: string, query: { exp?: string | number; sig?: string }, method: SignedMethod): boolean {
    return isValidKey(key) && verifyLocalSignature(this.config.secret, { key, exp: query.exp, sig: query.sig, method });
  }

  async presignPut(key: string, opts: { contentType: string; contentLength: number; expiresIn: number }) {
    assertValidKey(key);
    return {
      url: `${this.apiBase}/v1/uploads/local/${encodeURIComponent(key)}?${this.signedQuery(key, opts.expiresIn, "PUT")}`,
      headers: { "Content-Type": opts.contentType },
    };
  }

  async presignGet(key: string, opts: { expiresIn: number; downloadName?: string }) {
    assertValidKey(key);
    const dl = opts.downloadName ? `&dl=${encodeURIComponent(opts.downloadName)}` : "";
    return `${this.apiBase}/v1/uploads/files/${encodeURIComponent(key)}?${this.signedQuery(key, opts.expiresIn, "GET")}${dl}`;
  }

  publicUrl(key: string) {
    assertValidKey(key);
    const base = this.config.publicBaseUrl?.replace(/\/+$/, "") ?? `${this.apiBase}/v1/uploads/files`;
    return `${base}/${key}`;
  }

  async head(key: string) {
    try {
      const s = await stat(this.pathFor(key));
      if (!s.isFile()) return null;
      const meta = await readFile(this.metaPath(key), "utf8")
        .then((t) => JSON.parse(t) as { contentType?: string })
        .catch(() => ({}) as { contentType?: string });
      return { size: s.size, contentType: meta.contentType };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async get(key: string) {
    return readFile(this.pathFor(key));
  }

  async put(key: string, body: Buffer, contentType: string) {
    const p = this.pathFor(key);
    const m = this.metaPath(key);
    await mkdir(dirname(p), { recursive: true });
    await mkdir(dirname(m), { recursive: true });
    await writeFile(p, body);
    await writeFile(m, JSON.stringify({ contentType }));
  }

  async delete(key: string) {
    await rm(this.pathFor(key), { force: true });
    await rm(this.metaPath(key), { force: true });
  }
}

export { contentDisposition };
