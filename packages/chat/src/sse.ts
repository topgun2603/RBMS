/** Server-Sent Events framing (https://html.spec.whatwg.org/multipage/server-sent-events.html). */

export const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  /** Stops nginx (and similar proxies) from buffering the stream. */
  "x-accel-buffering": "no",
} as const;

export const HEARTBEAT_MS = 25_000;
export const RETRY_MS = 3_000;

export interface SseEvent {
  /** Event name (`message`, `read`, `typing`, `conversation`, `ready`). Omit for the default "message" type. */
  event?: string;
  /** Strings are sent as-is; anything else is JSON-encoded. */
  data: unknown;
  /** Sets the client's last event id (sent back as `Last-Event-ID` on reconnect). */
  id?: string;
  retry?: number;
}

/** Field values must not contain line breaks (they would start a new field). */
const singleLine = (v: string) => v.replace(/[\r\n]+/g, " ");

/**
 * One SSE frame. Multi-line data becomes several `data:` lines (the client joins them with "\n"); CR/LF/CRLF are all
 * treated as line breaks. The frame ends with a blank line.
 */
export function formatSseEvent(e: SseEvent): string {
  let out = "";
  if (e.id !== undefined) out += `id: ${singleLine(e.id)}\n`;
  if (e.event) out += `event: ${singleLine(e.event)}\n`;
  if (e.retry !== undefined) out += `retry: ${Math.max(0, Math.floor(e.retry))}\n`;
  const data = typeof e.data === "string" ? e.data : JSON.stringify(e.data ?? null);
  for (const line of data.split(/\r\n|\r|\n/)) out += `data: ${line}\n`;
  return `${out}\n`;
}

/** A comment line (ignored by clients); used as the heartbeat. */
export const sseComment = (text = "") => `: ${singleLine(text)}\n\n`;

/** Tells the client how long to wait before reconnecting. */
export const sseRetry = (ms = RETRY_MS) => `retry: ${Math.max(0, Math.floor(ms))}\n\n`;

/** Parses SSE text back into events (tests and the Node client helper). Comments are skipped. */
export function parseSse(text: string): { event: string; data: string; id?: string; retry?: number }[] {
  const out: { event: string; data: string; id?: string; retry?: number }[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    let event = "message";
    const data: string[] = [];
    let id: string | undefined;
    let retry: number | undefined;
    let any = false;
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(":")) continue;
      const i = line.indexOf(":");
      const field = i === -1 ? line : line.slice(0, i);
      let value = i === -1 ? "" : line.slice(i + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      any = true;
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
      else if (field === "id") id = value;
      else if (field === "retry") retry = Number(value);
    }
    if (!any) continue;
    out.push({ event, data: data.join("\n"), ...(id !== undefined ? { id } : {}), ...(retry !== undefined ? { retry } : {}) });
  }
  return out;
}
