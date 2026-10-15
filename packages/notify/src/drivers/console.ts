import { base64Size, type Channel, type ChannelDriver, type LoggerPort, type OutboundMessage } from "../types";

/**
 * Dev-mode driver used for any channel whose provider credentials are missing.
 * It prints the message instead of sending it (so OTPs are visible locally).
 * Never configure production without real credentials for the channels you use.
 */
export class ConsoleDriver implements ChannelDriver {
  constructor(
    readonly channel: Channel,
    private readonly log?: LoggerPort,
  ) {}

  async send(msg: OutboundMessage): Promise<{ providerId?: string }> {
    const attachments = msg.attachments?.length
      ? msg.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, size: base64Size(a.content) }))
      : undefined;
    const entry = {
      channel: this.channel,
      to: msg.to,
      subject: msg.subject,
      body: msg.body,
      data: msg.data,
      templateKey: msg.templateKey,
      ...(attachments ? { attachments } : {}),
    };
    const suffix = attachments ? ` (attachments: ${attachments.map((a) => `${a.filename} ${a.size} B`).join(", ")})` : "";
    const line = `[notify:console] ${this.channel} → ${msg.to}${suffix}`;
    if (this.log) this.log.info(entry, line);
    else console.info(`${line}\n${msg.subject ? `${msg.subject}\n` : ""}${msg.body}`);
    return { providerId: `console-${Date.now()}` };
  }
}
