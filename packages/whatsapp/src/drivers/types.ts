import type { SendComponent, TemplateComponent } from "../template";
import type { InboundMessage, StatusUpdate } from "../webhook";

export type FetchFn = typeof fetch;

/** What the shop sends. `to` is E.164 ("+919876543210"); drivers convert to Meta's digits-only format. */
export type OutboundPayload =
  | { type: "text"; body: string; previewUrl?: boolean; replyTo?: string | null }
  | { type: "template"; name: string; language: string; components: SendComponent[] }
  | { type: "image"; link: string; caption?: string | null }
  | { type: "document"; link: string; caption?: string | null; filename?: string | null };

export interface RemoteTemplate {
  id: string | null;
  name: string;
  language: string;
  status: string;
  category: string | null;
  parameterFormat: string | null;
  components: TemplateComponent[];
}

export interface WhatsAppDriver {
  readonly name: "meta" | "mock";
  /** Sends a message; resolves with Meta's message id (`wamid.…`). Throws `WhatsAppProviderError` on rejection. */
  send(to: string, payload: OutboundPayload): Promise<{ providerId: string }>;
  /** Marks an inbound message as read (blue ticks). */
  markRead(providerId: string): Promise<void>;
  /** All templates of the WhatsApp Business account (every page). */
  listTemplates(): Promise<RemoteTemplate[]>;
}

/** Decrypted account details a driver needs. */
export interface DriverAccount {
  tenantId: string;
  phoneNumberId: string;
  wabaId: string;
  token: string;
}

/** Where the mock driver delivers its synthetic webhooks (the service's own handlers). */
export interface MockSink {
  statuses(tenantId: string, statuses: StatusUpdate[]): Promise<unknown>;
  messages(tenantId: string, messages: InboundMessage[]): Promise<unknown>;
}

export class WhatsAppProviderError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    /** Meta error code (`error.code`), e.g. 131047 re-engagement, 131026 undeliverable, 190 bad token. */
    readonly code: number | null = null,
  ) {
    super(`WhatsApp API error ${status}${code ? ` (${code})` : ""}: ${errorMessage(body)}`);
    this.name = "WhatsAppProviderError";
  }
}

function errorMessage(body: unknown): string {
  const e = (body as { error?: { message?: string; error_data?: { details?: string } } } | null)?.error;
  return (e?.error_data?.details ?? e?.message ?? (typeof body === "string" ? body : JSON.stringify(body ?? null))).slice(0, 300);
}
