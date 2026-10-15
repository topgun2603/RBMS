import type { ChannelDriver, OutboundMessage, ResendConfig } from "../types";
import { requestJson, type FetchFn } from "./http";

export const RESEND_URL = "https://api.resend.com/emails";

/** Email through Resend. */
export class ResendDriver implements ChannelDriver {
  readonly channel = "email" as const;

  constructor(
    private readonly config: ResendConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async send(msg: OutboundMessage): Promise<{ providerId?: string }> {
    const res = await requestJson<{ id?: string }>(this.fetchFn, "resend", RESEND_URL, {
      headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: this.config.from,
        to: [msg.to],
        subject: msg.subject ?? "",
        html: msg.html,
        text: msg.body,
        ...(msg.attachments?.length
          ? { attachments: msg.attachments.map((a) => ({ filename: a.filename, content: a.content })) }
          : {}),
      }),
    });
    return { providerId: res?.id };
  }
}
