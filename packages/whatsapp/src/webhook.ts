import { createHmac } from "node:crypto";
import { safeEqual } from "@srirealtime/core";
import { normalisePhone, type OutboundStatus } from "./logic";

/**
 * Meta webhook helpers: the GET verification handshake, the `X-Hub-Signature-256` check and parsing of the POST
 * payload (`entry[].changes[].value.messages[] / statuses[] / contacts[]`).
 */

// ------------------------------------------------------------------ verification

/**
 * `GET /webhooks/:tenantId?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`. Returns the challenge to echo back
 * when the mode is `subscribe` and the token matches, null otherwise (respond 403).
 */
export function verifyChallenge(query: Record<string, unknown>, verifyToken: string | null | undefined): string | null {
  const q = (k: string) => {
    const v = query[k];
    return typeof v === "string" ? v : Array.isArray(v) && typeof v[0] === "string" ? v[0] : null;
  };
  const mode = q("hub.mode");
  const token = q("hub.verify_token");
  const challenge = q("hub.challenge");
  if (mode !== "subscribe" || !token || !challenge || !verifyToken) return null;
  return safeEqual(token, verifyToken) ? challenge : null;
}

/** `sha256=<hex>` for a raw body, as Meta computes it with the app secret. */
export const signBody = (raw: Buffer | string, appSecret: string) => `sha256=${createHmac("sha256", appSecret).update(raw).digest("hex")}`;

/** Constant-time check of `X-Hub-Signature-256` against the exact raw request bytes. */
export function verifySignature(raw: Buffer | string, header: string | null | undefined, appSecret: string | null | undefined): boolean {
  if (!header || !appSecret) return false;
  const h = header.trim();
  if (!/^sha256=[0-9a-f]{64}$/i.test(h)) return false;
  return safeEqual(h.toLowerCase(), signBody(raw, appSecret));
}

// ------------------------------------------------------------------ payload

export const MESSAGE_TYPES = [
  "text",
  "template",
  "image",
  "document",
  "audio",
  "video",
  "sticker",
  "location",
  "contacts",
  "interactive",
  "button",
  "reaction",
  "unsupported",
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export interface InboundMedia {
  /** Meta media id (download with `GET /{media-id}` + token). */
  id: string | null;
  mimeType: string | null;
  sha256: string | null;
  caption: string | null;
  filename: string | null;
}

export interface InboundMessage {
  phoneNumberId: string | null;
  providerId: string;
  /** Sender, "+919876543210". */
  from: string;
  /** Profile name from `contacts[]` (may be absent). */
  name: string | null;
  timestamp: Date;
  type: MessageType;
  /** Text, caption, button / list title, "📍 name, address", reaction emoji … */
  body: string | null;
  media: InboundMedia | null;
  /** The message this one replies to (`context.id`). */
  replyTo: string | null;
  /** Extra details worth keeping (location coordinates, button payload, reacted message id). */
  extra: Record<string, unknown> | null;
}

export interface StatusError {
  code: number | null;
  title: string | null;
  message: string | null;
}

export interface StatusUpdate {
  phoneNumberId: string | null;
  providerId: string;
  status: OutboundStatus;
  /** "+919876543210". */
  recipient: string | null;
  timestamp: Date;
  errors: StatusError[];
}

export interface ParsedWebhook {
  messages: InboundMessage[];
  statuses: StatusUpdate[];
  /** Phone number ids the payload was for (to check it matches the tenant's account). */
  phoneNumberIds: string[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : null);

const tsDate = (v: unknown): Date => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
};

function mediaOf(m: Obj | null): InboundMedia | null {
  if (!m) return null;
  return { id: str(m.id), mimeType: str(m.mime_type), sha256: str(m.sha256), caption: str(m.caption), filename: str(m.filename) };
}

function parseMessage(m: Obj, names: Map<string, string>, phoneNumberId: string | null): InboundMessage | null {
  const providerId = str(m.id);
  const fromRaw = str(m.from);
  if (!providerId || !fromRaw) return null;
  const from = normalisePhone(fromRaw, { assumeInternational: true });
  if (!from) return null;
  const rawType = str(m.type) ?? "unsupported";
  let type: MessageType = (MESSAGE_TYPES as readonly string[]).includes(rawType) ? (rawType as MessageType) : "unsupported";
  let body: string | null = null;
  let media: InboundMedia | null = null;
  let extra: Obj | null = null;
  switch (type) {
    case "text":
      body = str(obj(m.text)?.body);
      break;
    case "image":
    case "document":
    case "audio":
    case "video":
    case "sticker":
      media = mediaOf(obj(m[type]));
      body = media?.caption ?? null;
      break;
    case "location": {
      const l = obj(m.location) ?? {};
      body = ["📍", [str(l.name), str(l.address)].filter(Boolean).join(", ") || `${l.latitude}, ${l.longitude}`].join(" ");
      extra = { latitude: l.latitude ?? null, longitude: l.longitude ?? null };
      break;
    }
    case "button": {
      const b = obj(m.button) ?? {};
      body = str(b.text);
      extra = { payload: str(b.payload) };
      break;
    }
    case "interactive": {
      const i = obj(m.interactive) ?? {};
      const reply = obj(i.button_reply) ?? obj(i.list_reply);
      body = str(reply?.title);
      extra = { id: str(reply?.id), kind: str(i.type) };
      break;
    }
    case "reaction": {
      const r = obj(m.reaction) ?? {};
      body = str(r.emoji);
      extra = { messageId: str(r.message_id) };
      break;
    }
    case "contacts":
      body = arr(m.contacts)
        .map((c) => str(obj(obj(c)?.name)?.formatted_name))
        .filter(Boolean)
        .join(", ") || null;
      break;
    default:
      type = "unsupported";
  }
  return {
    phoneNumberId,
    providerId,
    from,
    name: names.get(fromRaw.replace(/\D/g, "")) ?? null,
    timestamp: tsDate(m.timestamp),
    type,
    body,
    media,
    replyTo: str(obj(m.context)?.id),
    extra,
  };
}

const STATUS_MAP: Record<string, OutboundStatus> = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };

function parseStatus(s: Obj, phoneNumberId: string | null): StatusUpdate | null {
  const providerId = str(s.id);
  const status = STATUS_MAP[str(s.status) ?? ""];
  if (!providerId || !status) return null; // e.g. "deleted", "warning"
  const rid = str(s.recipient_id);
  return {
    phoneNumberId,
    providerId,
    status,
    recipient: rid ? normalisePhone(rid, { assumeInternational: true }) : null,
    timestamp: tsDate(s.timestamp),
    errors: arr(s.errors).map((e) => {
      const o = obj(e) ?? {};
      const details = str(obj(o.error_data)?.details);
      return { code: typeof o.code === "number" ? o.code : null, title: str(o.title), message: details ?? str(o.message) };
    }),
  };
}

/** Parses a webhook POST body (already JSON-decoded). Unknown fields and malformed entries are ignored. */
export function parseWebhook(payload: unknown): ParsedWebhook {
  const out: ParsedWebhook = { messages: [], statuses: [], phoneNumberIds: [] };
  const root = obj(payload);
  if (!root) return out;
  for (const entry of arr(root.entry)) {
    for (const change of arr(obj(entry)?.changes)) {
      const c = obj(change);
      if (!c || (c.field !== undefined && c.field !== "messages")) continue;
      const value = obj(c.value);
      if (!value) continue;
      const phoneNumberId = str(obj(value.metadata)?.phone_number_id);
      if (phoneNumberId && !out.phoneNumberIds.includes(phoneNumberId)) out.phoneNumberIds.push(phoneNumberId);
      const names = new Map<string, string>();
      for (const ct of arr(value.contacts)) {
        const o = obj(ct);
        const id = str(o?.wa_id);
        const name = str(obj(o?.profile)?.name);
        if (id && name) names.set(id.replace(/\D/g, ""), name);
      }
      for (const m of arr(value.messages)) {
        const parsed = obj(m) && parseMessage(obj(m)!, names, phoneNumberId);
        if (parsed) out.messages.push(parsed);
      }
      for (const s of arr(value.statuses)) {
        const parsed = obj(s) && parseStatus(obj(s)!, phoneNumberId);
        if (parsed) out.statuses.push(parsed);
      }
    }
  }
  return out;
}

/** "131047: Re-engagement message — more than 24 hours have passed…" for the message's error column. */
export const describeErrors = (errors: StatusError[]) =>
  errors.length
    ? errors
        .map((e) => [e.code, [e.title, e.message].filter(Boolean).join(" — ")].filter((x) => x !== null && x !== "").join(": "))
        .join("; ")
        .slice(0, 500)
    : null;
