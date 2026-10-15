import type { CampaignCounts } from "./logic";
import type { CampaignStatus } from "./schema";

/**
 * Live inbox events. The service emits them after the database write; apps/api can bridge them to browsers, e.g.
 * through chat's SSE pub/sub:
 *
 * ```ts
 * wa.service.onEvent((e) => chatPubSub.publish("whatsapp.events", JSON.stringify(e)));
 * // …and an SSE route (or chat's hub) that delivers `whatsapp.events` to connected staff holding `whatsapp.manage`
 * // of `e.tenantId`, as SSE event `wa.${e.type}`.
 * ```
 * Listener errors are swallowed (logged); listeners must be fast (queue heavy work).
 */
export type WhatsAppEvent =
  | { type: "message"; tenantId: string; contactId: string; message: unknown }
  | { type: "status"; tenantId: string; contactId: string; messageId: string; status: string; error: string | null }
  | { type: "conversation"; tenantId: string; contactId: string; conversation: unknown }
  | { type: "campaign"; tenantId: string; campaignId: string; status: CampaignStatus; counts: CampaignCounts };

export type WhatsAppEventListener = (event: WhatsAppEvent) => void | Promise<void>;

export class WhatsAppEvents {
  private readonly listeners = new Set<WhatsAppEventListener>();

  constructor(private readonly onError: (err: unknown) => void = () => undefined) {}

  on(listener: WhatsAppEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: WhatsAppEvent): void {
    for (const l of [...this.listeners]) {
      try {
        const r = l(event);
        if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(this.onError);
      } catch (err) {
        this.onError(err);
      }
    }
  }

  get size() {
    return this.listeners.size;
  }
}
