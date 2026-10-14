import type { ChannelDriver, OutboundMessage, WhatsAppConfig } from "../types";
import { digitsOnly, requestJson, type FetchFn } from "./http";

export const whatsappUrl = (phoneNumberId: string) => `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

/**
 * WhatsApp Cloud API. With a `templateRef` (an approved template) it sends a template message with
 * body parameters, which works at any time. Without one it sends plain text, which Meta only
 * delivers inside a 24h customer-service session.
 */
export class WhatsAppDriver implements ChannelDriver {
  readonly channel = "whatsapp" as const;

  constructor(
    private readonly config: WhatsAppConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async send(msg: OutboundMessage): Promise<{ providerId?: string }> {
    const to = digitsOnly(msg.to);
    const payload = msg.templateRef
      ? {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "template",
          template: {
            name: msg.templateRef.name,
            language: { code: msg.templateRef.language },
            components: msg.templateRef.params.length
              ? [{ type: "body", parameters: msg.templateRef.params.map((text) => ({ type: "text", text })) }]
              : [],
          },
        }
      : {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body: msg.body, preview_url: false },
        };
    const res = await requestJson<{ messages?: Array<{ id: string }> }>(
      this.fetchFn,
      "whatsapp",
      whatsappUrl(this.config.phoneNumberId),
      {
        headers: { authorization: `Bearer ${this.config.token}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    return { providerId: res?.messages?.[0]?.id };
  }
}
