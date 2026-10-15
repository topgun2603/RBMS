const MIN = 60_000;

/** Delay before retry n (1-based): 1 m, 5 m, 30 m, 2 h, 12 h. After the 6th failed attempt the delivery fails. */
export const RETRY_SCHEDULE_MS = [1 * MIN, 5 * MIN, 30 * MIN, 120 * MIN, 720 * MIN] as const;
/** First attempt + one per retry. */
export const MAX_ATTEMPTS = RETRY_SCHEDULE_MS.length + 1;
/** An endpoint is switched off after this many failed attempts in a row (any success resets the count). */
export const AUTO_DISABLE_AFTER = 20;
export const DELIVERY_TIMEOUT_MS = 10_000;
export const RESPONSE_BODY_LIMIT = 2048;

/** Delay before the next attempt after `attemptsMade` failed attempts, or null when no retries are left. */
export function retryDelayMs(attemptsMade: number): number | null {
  if (attemptsMade < 1) return 0;
  return RETRY_SCHEDULE_MS[attemptsMade - 1] ?? null;
}

export const isSuccessStatus = (status: number) => status >= 200 && status < 300;

/** Cuts a string to at most `limit` UTF-8 bytes without splitting a character. */
export function truncateUtf8(text: string, limit = RESPONSE_BODY_LIMIT): string {
  if (Buffer.byteLength(text, "utf8") <= limit) return text;
  let out = Buffer.from(text, "utf8").subarray(0, limit).toString("utf8");
  // A cut multi-byte character decodes to U+FFFD; drop it.
  while (out.endsWith("�") || Buffer.byteLength(out, "utf8") > limit) out = out.slice(0, -1);
  return out;
}

/** Reads at most `limit` bytes of a response body (then cancels the stream) and returns it as UTF-8. */
export async function readLimited(res: Response, limit = RESPONSE_BODY_LIMIT): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size <= limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return truncateUtf8(Buffer.concat(chunks).toString("utf8"), limit);
}
