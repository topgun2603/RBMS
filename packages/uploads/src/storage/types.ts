/**
 * Object storage behind uploads. Implementations: S3Storage (AWS S3, Cloudflare R2, any S3-compatible
 * store) and LocalStorage (disk, for development).
 *
 * A Firebase/Google Cloud Storage adapter can be added later by implementing this interface
 * (presignPut/presignGet map to GCS V4 signed URLs); it is intentionally not implemented yet.
 */
export interface StorageAdapter {
  /** "s3", "r2", "local", ... */
  driver: string;
  /** URL the client PUTs the file body to, plus headers it must send. */
  presignPut(
    key: string,
    opts: { contentType: string; contentLength: number; expiresIn: number },
  ): Promise<{ url: string; headers: Record<string, string> }>;
  /** Time-limited download URL for a private object. */
  presignGet(key: string, opts: { expiresIn: number; downloadName?: string }): Promise<string>;
  /** Permanent URL for a public object. */
  publicUrl(key: string): string;
  head(key: string): Promise<{ size: number; contentType?: string } | null>;
  get(key: string): Promise<Buffer>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}
