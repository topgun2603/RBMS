/**
 * Minimal multipart/form-data parser for one uploaded file (the fastify multipart plugin isn't a dependency).
 * The whole body is already buffered and size-limited by Fastify's bodyLimit.
 */

export interface MultipartFile {
  fieldName: string;
  fileName: string | null;
  contentType: string | null;
  data: Buffer;
}

export class MultipartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MultipartError";
  }
}

/** boundary from `multipart/form-data; boundary=----abc` (quoted or not). */
export function boundaryOf(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const b = m?.[1] ?? m?.[2] ?? null;
  return b && b.length <= 200 ? b : null;
}

function parseHeaders(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split("\r\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

function dispositionParam(disposition: string, name: string): string | null {
  // filename*=UTF-8''%E0%AE%95.csv (RFC 5987) wins over filename="..."
  if (name === "filename") {
    const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition);
    if (star) {
      try {
        return decodeURIComponent(star[1]!.trim());
      } catch {
        /* fall through */
      }
    }
  }
  const m = new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|([^;]*))`, "i").exec(disposition);
  if (!m) return null;
  return (m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : (m[2] ?? "").trim()) || null;
}

/** All parts of the body. */
export function parseMultipart(body: Buffer, boundary: string): MultipartFile[] {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: MultipartFile[] = [];
  let pos = body.indexOf(delimiter);
  if (pos < 0) throw new MultipartError("Malformed multipart body (no boundary)");
  while (pos >= 0) {
    let start = pos + delimiter.length;
    // "--" after the delimiter = end of body.
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break;
    if (body[start] === 0x0d && body[start + 1] === 0x0a) start += 2;
    const headerEnd = body.indexOf("\r\n\r\n", start);
    if (headerEnd < 0) throw new MultipartError("Malformed multipart body (headers)");
    const headers = parseHeaders(body.subarray(start, headerEnd).toString("utf8"));
    const dataStart = headerEnd + 4;
    const next = body.indexOf(Buffer.concat([Buffer.from("\r\n"), delimiter]), dataStart);
    if (next < 0) throw new MultipartError("Malformed multipart body (unterminated part)");
    const disposition = headers["content-disposition"] ?? "";
    parts.push({
      fieldName: dispositionParam(disposition, "name") ?? "",
      fileName: dispositionParam(disposition, "filename"),
      contentType: headers["content-type"] ?? null,
      data: body.subarray(dataStart, next),
    });
    pos = next + 2;
  }
  return parts;
}

/** The uploaded file: the part named "file", else the first part with a file name. */
export function fileFromMultipart(body: Buffer, contentType: string | undefined): MultipartFile {
  const boundary = boundaryOf(contentType);
  if (!boundary) throw new MultipartError("Missing multipart boundary");
  const parts = parseMultipart(body, boundary);
  const file = parts.find((p) => p.fieldName === "file" && p.fileName !== null) ?? parts.find((p) => p.fileName !== null) ?? parts.find((p) => p.fieldName === "file");
  if (!file) throw new MultipartError('No file in the upload (use a form field named "file")');
  return file;
}
