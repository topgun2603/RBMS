const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "text/csv": "csv",
  "text/plain": "txt",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/json": "json",
  "application/zip": "zip",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
};

/**
 * Default allow-list: common raster images, PDF, CSV, XLSX, MP4 / WebM video, MP3.
 * SVG is deliberately excluded (it can carry scripts when served from your own origin).
 */
export const DEFAULT_ALLOWED_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
];

/** File extension for a MIME type ("image/jpeg" → "jpg"), or undefined if unknown. */
export function extFor(contentType: string): string | undefined {
  return EXT[normalizeType(contentType)];
}

/** "Image/JPEG; charset=x" → "image/jpeg" */
export const normalizeType = (contentType: string) => contentType.split(";")[0]!.trim().toLowerCase();

/** Checks a MIME type against an allow-list that may contain wildcards like "image/*" (or "*\/*"). */
export function isAllowedType(contentType: string, allowed: readonly string[]): boolean {
  const type = normalizeType(contentType);
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type)) return false;
  return allowed.some((a) => {
    const rule = a.trim().toLowerCase();
    if (rule === "*/*" || rule === "*") return true;
    if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
    return rule === type;
  });
}

/**
 * Safe file name for storage keys: ASCII letters/digits/._- only, no leading dots or dashes,
 * at most 100 chars (extension kept). Falls back to "file" (e.g. for an all-Tamil name).
 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const ascii = base.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  // Split the extension off first, so a stem with no ASCII left can't swallow it.
  const dot = ascii.lastIndexOf(".");
  const rawStem = dot > 0 ? ascii.slice(0, dot) : ascii;
  const ext = dot > 0 ? ascii.slice(dot + 1).replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) : "";
  let stem = rawStem
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+/, "")
    .replace(/[.-]+$/, "");
  if (!stem) stem = "file";
  const maxStem = 100 - (ext ? ext.length + 1 : 0);
  return stem.slice(0, maxStem).replace(/[.-]+$/, "") + (ext ? `.${ext}` : "");
}

/** Ensures the name carries an extension matching the content type when it has none. */
export function withExtension(filename: string, contentType: string): string {
  if (/\.[a-zA-Z0-9]{1,10}$/.test(filename)) return filename;
  const ext = extFor(contentType);
  return ext ? `${filename}.${ext}` : filename;
}

const PURPOSE_RE = /^[a-z0-9_-]{1,40}$/;

/** `t/<tenantId|platform>/<purpose|misc>/<yyyy>/<mm>/<id>-<sanitized-filename>` (UTC date). */
export function buildKey(input: {
  tenantId: string | null | undefined;
  purpose?: string | null;
  filename: string;
  id: string;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const purpose = input.purpose && PURPOSE_RE.test(input.purpose) ? input.purpose : "misc";
  const tenant = input.tenantId ? input.tenantId.replace(/[^a-zA-Z0-9-]/g, "") : "platform";
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `t/${tenant}/${purpose}/${yyyy}/${mm}/${input.id}-${sanitizeFilename(input.filename)}`;
}

export const thumbKeyFor = (key: string) => `${key}.thumb.webp`;
