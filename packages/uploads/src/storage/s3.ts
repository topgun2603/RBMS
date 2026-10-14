import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageAdapter } from "./types";

export interface S3StorageConfig {
  bucket: string;
  /** "auto" for Cloudflare R2. Default "ap-south-1" (Mumbai). */
  region?: string;
  /** Custom endpoint, e.g. "https://<accountid>.r2.cloudflarestorage.com" for R2. */
  endpoint?: string;
  /** Path-style URLs (endpoint/bucket/key); needed for R2 and MinIO. */
  forcePathStyle?: boolean;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  /** Base URL that serves public objects (CDN, R2 public bucket domain). Defaults to the bucket URL. */
  publicBaseUrl?: string;
  /** Driver name reported to callers. Default "r2" when an endpoint contains r2.cloudflarestorage.com, else "s3". */
  driver?: string;
  /** Inject a client (tests). */
  client?: S3Client;
}

const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");

/** AWS S3 / Cloudflare R2 storage. */
export class S3Storage implements StorageAdapter {
  readonly driver: string;
  readonly client: S3Client;
  private readonly bucket: string;
  private readonly baseUrl: string;

  constructor(private readonly config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.driver = config.driver ?? (config.endpoint?.includes("r2.cloudflarestorage.com") ? "r2" : "s3");
    const region = config.region ?? (this.driver === "r2" ? "auto" : "ap-south-1");
    const clientConfig: S3ClientConfig = {
      region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: config.credentials,
    };
    this.client = config.client ?? new S3Client(clientConfig);
    const trim = (s: string) => s.replace(/\/+$/, "");
    if (config.publicBaseUrl) this.baseUrl = trim(config.publicBaseUrl);
    else if (config.endpoint) this.baseUrl = `${trim(config.endpoint)}/${this.bucket}`;
    else this.baseUrl = `https://${this.bucket}.s3.${region}.amazonaws.com`;
  }

  async presignPut(key: string, opts: { contentType: string; contentLength: number; expiresIn: number }) {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: opts.contentType,
      ContentLength: opts.contentLength,
    });
    const url = await getSignedUrl(this.client, cmd, {
      expiresIn: opts.expiresIn,
      signableHeaders: new Set(["content-type", "content-length"]),
    });
    return { url, headers: { "Content-Type": opts.contentType } };
  }

  async presignGet(key: string, opts: { expiresIn: number; downloadName?: string }) {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: opts.downloadName ? contentDisposition(opts.downloadName) : undefined,
    });
    return getSignedUrl(this.client, cmd, { expiresIn: opts.expiresIn });
  }

  publicUrl(key: string) {
    return `${this.baseUrl}/${encodeKey(key)}`;
  }

  async head(key: string) {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0, contentType: res.ContentType };
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty body for ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/** RFC 6266 attachment header with an ASCII fallback and a UTF-8 filename* (Tamil names survive). */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
