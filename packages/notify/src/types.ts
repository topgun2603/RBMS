export type Channel = "sms" | "email" | "whatsapp" | "push";
export const CHANNELS: readonly Channel[] = ["sms", "email", "whatsapp", "push"];

export interface TemplateRef {
  name: string;
  language: string;
  params: string[];
}

/** An email attachment. JSON-serialisable so it can travel through the job queue. */
export interface EmailAttachment {
  filename: string;
  contentType: string;
  /** File content, base64-encoded. */
  content: string;
}

/** Decoded size in bytes of a base64 string (no decoding needed). */
export function base64Size(b64: string): number {
  const s = b64.replace(/\s/g, "");
  if (!s) return 0;
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  return Math.floor((s.length * 3) / 4) - pad;
}

export interface OutboundMessage {
  to: string;
  /** Email only. */
  attachments?: EmailAttachment[];
  subject?: string;
  body: string;
  html?: string;
  data?: Record<string, string>;
  /** Provider-side template (MSG91 flow id, WhatsApp template name). */
  templateRef?: TemplateRef;
  /** The notify template key this message was rendered from, e.g. "auth.otp". */
  templateKey?: string;
  /** Named template variables (MSG91 flows use these). */
  vars?: Record<string, string>;
}

export interface ChannelDriver {
  channel: Channel;
  send(msg: OutboundMessage): Promise<{ providerId?: string }>;
}

/** Minimal logger port, structurally compatible with pino / the Fastify logger. */
export interface LoggerPort {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };

/** Background queue port (satisfied by the jobs module's service). */
export interface QueuePort {
  define<T>(name: string, handler: (data: T) => Promise<void>, opts?: { attempts?: number }): void;
  enqueue<T>(name: string, data: T, opts?: { delayMs?: number; jobId?: string }): Promise<void>;
}

/** Resolves a user's contact details (satisfied by the auth/users module). */
export interface ContactLookup {
  contactFor(userId: string): Promise<{ phone?: string | null; email?: string | null; locale?: string }>;
}

export interface Msg91Config {
  authKey: string;
  /** DLT-approved sender id (header). */
  senderId: string;
  /** Template key (e.g. "auth.otp") → MSG91 flow/template id. */
  flowIds: Record<string, string>;
}

export interface ResendConfig {
  apiKey: string;
  /** e.g. "Acme <no-reply@acme.in>" */
  from: string;
}

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  /** Template key → approved WhatsApp template. Without one, messages go out as session text. */
  templates?: Record<string, { name: string; language?: string }>;
}

export interface FcmConfig {
  /** The service-account JSON (as a string) downloaded from Firebase. */
  serviceAccountJson: string;
}

export interface NotifyConfig {
  appName: string;
  msg91?: Msg91Config;
  resend?: ResendConfig;
  whatsapp?: WhatsAppConfig;
  fcm?: FcmConfig;
}

/** A provider API rejected the request. */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`${provider} request failed with status ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    this.name = "ProviderError";
  }
}
