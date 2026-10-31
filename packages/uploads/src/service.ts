import { badRequest, forbidden, newId, notFound } from "@rbms/core";
import type { Db } from "@rbms/db";
import { and, desc, eq, ilike, isNull, like, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { processImage } from "./images";
import { DEFAULT_ALLOWED_TYPES, buildKey, isAllowedType, normalizeType, thumbKeyFor, withExtension } from "./keys";
import { files, type FileRow, type FileVisibility } from "./schema";
import { LocalStorage } from "./storage/local";
import type { StorageAdapter } from "./storage/types";

export interface LoggerPort {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };

export interface UploadsConfig {
  storage: StorageAdapter;
  /** Max upload size in bytes for everything but video. Default 25 MB. */
  maxBytes?: number;
  /** Max size for `video/*` uploads (a shop's hero clip). Default 50 MB, and never below `maxBytes`. */
  videoMaxBytes?: number;
  /** Allowed MIME types; wildcards like "image/*" work. Default: images, pdf, csv, xlsx, mp4, mp3. */
  allowedTypes?: string[];
  /** Thumbnail width in px. Default 400. */
  thumbnailWidth?: number;
  /** Overrides the storage's public URL base (e.g. a CDN in front of the bucket). */
  publicBaseUrl?: string;
}

export interface FileDto {
  id: string;
  tenantId: string | null;
  ownerUserId: string | null;
  key: string;
  originalName: string;
  contentType: string;
  size: number;
  status: FileRow["status"];
  visibility: FileVisibility;
  purpose: string | null;
  width: number | null;
  height: number | null;
  url: string;
  thumbUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SignInput {
  tenantId: string | null;
  userId: string | null;
  filename: string;
  contentType: string;
  size: number;
  visibility?: FileVisibility;
  purpose?: string | null;
}

/** `GET /v1/uploads` filters (the media library): newest first, keyset-paginated with `cursor`. */
export interface ListInput {
  tenantId: string | null;
  purpose?: string;
  ownerUserId?: string;
  /** "image" → image/*, "video" → video/*. */
  kind?: "image" | "video";
  visibility?: FileVisibility;
  /** Case-insensitive match on the original file name. */
  q?: string;
  limit?: number;
  /** Older offset paging; ignored when `cursor` is set. */
  offset?: number;
  /** `nextCursor` of the previous page. */
  cursor?: string;
}

export interface FilePage {
  items: FileDto[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}

/** Opaque keyset cursor: the last row's created-at and id. */
export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const [at, id, extra] = raw.split("|");
  const createdAt = new Date(at ?? "");
  if (extra !== undefined || !id || !/^[0-9a-f-]{36}$/i.test(id) || Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
}

/** Escapes LIKE wildcards so a search for "50%_off" matches literally. */
export const likeEscape = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface SignResult {
  fileId: string;
  key: string;
  upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresIn: number };
}

export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
/** Videos may be larger than other files. */
export const DEFAULT_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
/** Images larger than this are stored without dimensions/thumbnail. */
export const THUMBNAIL_MAX_BYTES = 20 * 1024 * 1024;
const UPLOAD_URL_TTL = 15 * 60;
const DOWNLOAD_URL_TTL = 15 * 60;
const THUMBNAIL_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif", "image/tiff"]);

/** created_at at millisecond precision (Postgres keeps microseconds; cursors carry a JS Date). */
const createdMs = sql<Date>`date_trunc('milliseconds', ${files.createdAt})`;

const sqlTime = (d: Date) => sql`${d.toISOString()}::timestamptz`;

const tenantFilter = (tenantId: string | null): SQL => (tenantId ? eq(files.tenantId, tenantId) : isNull(files.tenantId));

export class UploadsService {
  readonly storage: StorageAdapter;
  /** The largest size any upload may have (the video limit included): the local driver's body limit. */
  readonly maxBytes: number;
  private readonly fileMaxBytes: number;
  private readonly videoMaxBytes: number;
  private readonly allowed: readonly string[];
  private readonly thumbWidth: number;
  private readonly log: LoggerPort;

  constructor(
    private readonly db: Db,
    private readonly config: UploadsConfig,
    log?: LoggerPort,
  ) {
    this.storage = config.storage;
    this.fileMaxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES;
    this.videoMaxBytes = Math.max(config.videoMaxBytes ?? DEFAULT_VIDEO_MAX_BYTES, this.fileMaxBytes);
    this.maxBytes = this.videoMaxBytes;
    this.allowed = config.allowedTypes ?? DEFAULT_ALLOWED_TYPES;
    this.thumbWidth = config.thumbnailWidth ?? 400;
    this.log = log ?? noopLogger;
  }

  /** Validates the request, records a pending file and returns a pre-signed PUT. */
  async sign(input: SignInput): Promise<SignResult> {
    const contentType = normalizeType(input.contentType);
    if (!isAllowedType(contentType, this.allowed)) throw badRequest(`File type ${contentType} is not allowed`);
    if (!Number.isInteger(input.size) || input.size <= 0) throw badRequest("File size must be a positive integer");
    const limit = this.limitFor(contentType);
    if (input.size > limit) throw badRequest(`File is larger than ${Math.floor(limit / 1024 / 1024)} MB`);
    const originalName = input.filename.trim().slice(0, 255) || "file";

    const id = newId();
    const key = buildKey({
      tenantId: input.tenantId,
      purpose: input.purpose,
      filename: withExtension(originalName, contentType),
      id,
    });
    await this.db.insert(files).values({
      id,
      tenantId: input.tenantId,
      ownerUserId: input.userId,
      key,
      originalName,
      contentType,
      size: input.size,
      status: "pending",
      visibility: input.visibility ?? "private",
      purpose: input.purpose ?? null,
    });
    const upload = await this.storage.presignPut(key, { contentType, contentLength: input.size, expiresIn: UPLOAD_URL_TTL });
    return { fileId: id, key, upload: { url: upload.url, method: "PUT", headers: upload.headers, expiresIn: UPLOAD_URL_TTL } };
  }

  /** Confirms the object exists with the declared size/type, extracts image dimensions + thumbnail, marks it ready. */
  async complete(fileId: string, actor: { tenantId: string | null; userId: string | null }): Promise<FileDto> {
    const row = await this.findRow(fileId, actor.tenantId);
    if (row.ownerUserId && actor.userId !== row.ownerUserId) throw forbidden("Only the uploader can complete this file");
    if (row.status === "ready") return this.toDto(row);
    if (row.status !== "pending") throw notFound("File");

    const head = await this.storage.head(row.key);
    if (!head) throw badRequest("The file has not been uploaded yet");
    if (head.size !== row.size || head.size > this.limitFor(row.contentType)) {
      await this.storage.delete(row.key).catch(() => undefined);
      throw badRequest("Uploaded file size does not match the declared size");
    }
    if (head.contentType && normalizeType(head.contentType) !== row.contentType) {
      await this.storage.delete(row.key).catch(() => undefined);
      throw badRequest("Uploaded file type does not match the declared type");
    }

    const patch: Partial<Pick<FileRow, "width" | "height" | "thumbKey">> = {};
    if (THUMBNAIL_TYPES.has(row.contentType) && row.size <= THUMBNAIL_MAX_BYTES) {
      try {
        const buf = await this.storage.get(row.key);
        const { width, height, thumb } = await processImage(buf, this.thumbWidth);
        patch.width = width;
        patch.height = height;
        const thumbKey = thumbKeyFor(row.key);
        await this.storage.put(thumbKey, thumb, "image/webp");
        patch.thumbKey = thumbKey;
      } catch (err) {
        this.log.warn({ err, fileId, contentType: row.contentType }, "uploads: could not process image; storing without thumbnail");
      }
    }

    const [updated] = await this.db
      .update(files)
      .set({ ...patch, status: "ready" })
      .where(and(eq(files.id, row.id), tenantFilter(actor.tenantId)))
      .returning();
    return this.toDto(updated!);
  }

  /**
   * Server-side store for files the server made itself (seed placeholders, generated documents): writes the bytes and
   * records a ready file in one step, no pre-signed upload. The same type allow-list and size cap apply as for user
   * uploads (so SVG is still refused); images get dimensions and a thumbnail. Not exposed over HTTP.
   */
  async storeGenerated(input: {
    tenantId: string | null;
    filename: string;
    contentType: string;
    body: Buffer;
    visibility?: FileVisibility;
    purpose?: string | null;
    userId?: string | null;
  }): Promise<FileDto> {
    const contentType = normalizeType(input.contentType);
    if (!isAllowedType(contentType, this.allowed)) throw badRequest(`File type ${contentType} is not allowed`);
    if (input.body.length === 0 || input.body.length > this.limitFor(contentType)) throw badRequest("Generated file is empty or too large");
    const originalName = input.filename.trim().slice(0, 255) || "file";
    const id = newId();
    const key = buildKey({ tenantId: input.tenantId, purpose: input.purpose, filename: withExtension(originalName, contentType), id });
    await this.storage.put(key, input.body, contentType);
    const patch: Partial<Pick<FileRow, "width" | "height" | "thumbKey">> = {};
    if (THUMBNAIL_TYPES.has(contentType) && input.body.length <= THUMBNAIL_MAX_BYTES) {
      try {
        const { width, height, thumb } = await processImage(input.body, this.thumbWidth);
        patch.width = width;
        patch.height = height;
        const thumbKey = thumbKeyFor(key);
        await this.storage.put(thumbKey, thumb, "image/webp");
        patch.thumbKey = thumbKey;
      } catch (err) {
        this.log.warn({ err, contentType }, "uploads: could not process generated image; storing without thumbnail");
      }
    }
    const [row] = await this.db
      .insert(files)
      .values({
        id,
        tenantId: input.tenantId,
        ownerUserId: input.userId ?? null,
        key,
        originalName,
        contentType,
        size: input.body.length,
        status: "ready",
        visibility: input.visibility ?? "private",
        purpose: input.purpose ?? null,
        ...patch,
      })
      .returning();
    return this.toDto(row!);
  }

  async get(fileId: string, tenantId: string | null): Promise<FileDto> {
    const row = await this.findRow(fileId, tenantId);
    return this.toDto(row);
  }

  /** Size cap for a content type: videos get the larger video limit. */
  limitFor(contentType: string): number {
    return normalizeType(contentType).startsWith("video/") ? this.videoMaxBytes : this.fileMaxBytes;
  }

  async list(input: ListInput): Promise<FileDto[]> {
    return (await this.page(input)).items;
  }

  /** Ready files of one tenant, newest first, filtered by purpose / owner / kind / visibility / name. */
  async page(input: ListInput): Promise<FilePage> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const after = input.cursor ? decodeCursor(input.cursor) : null;
    if (input.cursor && !after) throw badRequest("Invalid cursor");
    const q = input.q?.trim();
    const rows = await this.db
      .select()
      .from(files)
      .where(
        and(
          tenantFilter(input.tenantId),
          eq(files.status, "ready"),
          input.purpose ? eq(files.purpose, input.purpose) : undefined,
          input.ownerUserId ? eq(files.ownerUserId, input.ownerUserId) : undefined,
          input.kind ? like(files.contentType, `${input.kind}/%`) : undefined,
          input.visibility ? eq(files.visibility, input.visibility) : undefined,
          q ? ilike(files.originalName, `%${likeEscape(q)}%`) : undefined,
          after ? or(lt(createdMs, sqlTime(after.createdAt)), and(eq(createdMs, sqlTime(after.createdAt)), lt(files.id, after.id))) : undefined,
        ),
      )
      .orderBy(desc(createdMs), desc(files.id))
      .limit(limit + 1)
      .offset(after ? 0 : Math.max(input.offset ?? 0, 0));
    const more = rows.length > limit;
    const pageRows = more ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];
    return { items: await Promise.all(pageRows.map((r) => this.toDto(r))), nextCursor: more && last ? encodeCursor(last) : null };
  }

  /** Deletes the stored objects and marks the row deleted. */
  async remove(fileId: string, tenantId: string | null): Promise<void> {
    const row = await this.findRow(fileId, tenantId);
    await this.deleteObjects(row);
    await this.db
      .update(files)
      .set({ status: "deleted", thumbKey: null })
      .where(and(eq(files.id, row.id), tenantFilter(tenantId)));
  }

  /**
   * Deletes pending uploads older than `olderThan` (never completed), objects and rows.
   * Platform maintenance job: intentionally spans all tenants. Returns the number removed.
   */
  async cleanupPending(olderThan: Date): Promise<number> {
    const stale = await this.db
      .select()
      .from(files)
      .where(and(eq(files.status, "pending"), lt(files.createdAt, olderThan)))
      .limit(1000);
    for (const row of stale) {
      await this.deleteObjects(row);
      await this.db.delete(files).where(and(eq(files.id, row.id), eq(files.status, "pending")));
    }
    if (stale.length) this.log.info({ count: stale.length }, "uploads: removed stale pending files");
    return stale.length;
  }

  // ---------------------------------------------------------------- local driver

  private local(): LocalStorage {
    if (!(this.storage instanceof LocalStorage)) throw notFound("Route");
    return this.storage;
  }

  /** Accepts the body of a signed local PUT. */
  async localUploadHandler(key: string, query: { exp?: string; sig?: string }, body: Buffer): Promise<void> {
    const storage = this.local();
    if (!storage.verify(key, query, "PUT")) throw forbidden("Invalid or expired upload URL");
    const [row] = await this.db.select().from(files).where(eq(files.key, key)).limit(1);
    if (!row || row.status !== "pending") throw notFound("Upload");
    if (body.length > this.limitFor(row.contentType) || body.length !== row.size) throw badRequest("Body size does not match the signed size");
    await storage.put(key, body, row.contentType);
  }

  /**
   * Serves a local file (or its thumbnail). Public files are open; private ones need a signed GET.
   * Lookup is by globally unique key, which is what the URL carries.
   */
  async localFileHandler(
    key: string,
    query: { exp?: string; sig?: string; dl?: string },
  ): Promise<{ body: Buffer; contentType: string; downloadName?: string }> {
    const storage = this.local();
    const [row] = await this.db
      .select()
      .from(files)
      .where(and(or(eq(files.key, key), eq(files.thumbKey, key)), ne(files.status, "deleted")))
      .limit(1);
    if (!row || row.status !== "ready") throw notFound("File");
    if (row.visibility !== "public" && !storage.verify(key, query, "GET")) throw forbidden("Invalid or expired file URL");
    const isThumb = row.thumbKey === key;
    const body = await storage.get(key).catch(() => {
      throw notFound("File");
    });
    return {
      body,
      contentType: isThumb ? "image/webp" : row.contentType,
      downloadName: !isThumb && query.dl ? query.dl.slice(0, 255) : undefined,
    };
  }

  // ---------------------------------------------------------------- helpers

  private async findRow(fileId: string, tenantId: string | null): Promise<FileRow> {
    if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw notFound("File");
    const [row] = await this.db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), tenantFilter(tenantId), ne(files.status, "deleted")))
      .limit(1);
    if (!row) throw notFound("File");
    return row;
  }

  private async deleteObjects(row: FileRow) {
    for (const key of [row.key, row.thumbKey]) {
      if (!key) continue;
      await this.storage.delete(key).catch((err) => this.log.warn({ err, key }, "uploads: could not delete object"));
    }
  }

  private urlFor(key: string, visibility: FileVisibility, downloadName?: string): Promise<string> | string {
    if (visibility === "public") {
      const base = this.config.publicBaseUrl?.replace(/\/+$/, "");
      return base ? `${base}/${key}` : this.storage.publicUrl(key);
    }
    return this.storage.presignGet(key, { expiresIn: DOWNLOAD_URL_TTL, downloadName });
  }

  private async toDto(row: FileRow): Promise<FileDto> {
    const ready = row.status === "ready";
    return {
      id: row.id,
      tenantId: row.tenantId,
      ownerUserId: row.ownerUserId,
      key: row.key,
      originalName: row.originalName,
      contentType: row.contentType,
      size: row.size,
      status: row.status,
      visibility: row.visibility,
      purpose: row.purpose,
      width: row.width,
      height: row.height,
      url: ready ? await this.urlFor(row.key, row.visibility) : "",
      thumbUrl: ready && row.thumbKey ? await this.urlFor(row.thumbKey, row.visibility) : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
