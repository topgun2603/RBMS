import type { Channel, ChannelDriver, LoggerPort, OutboundMessage } from "../types";

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
    const entry = { channel: this.channel, to: msg.to, subject: msg.subject, body: msg.body, data: msg.data, templateKey: msg.templateKey };
    if (this.log) this.log.info(entry, `[notify:console] ${this.channel} → ${msg.to}`);
    else console.info(`[notify:console] ${this.channel} → ${msg.to}\n${msg.subject ? `${msg.subject}\n` : ""}${msg.body}`);
    return { providerId: `console-${Date.now()}` };
  }
}
