import { newId } from "@rbms/core";
import type { OutboundStatus } from "../logic";
import type { InboundMessage, StatusUpdate } from "../webhook";
import { WhatsAppProviderError, type MockSink, type OutboundPayload, type RemoteTemplate, type WhatsAppDriver } from "./types";

export interface MockDriverOptions {
  /** Delays (ms) before the synthetic sent / delivered / read statuses. Default [200, 1000, 3000]. */
  statusDelaysMs?: [number, number, number];
  /** Text messages are answered with an inbound "Echo: …" after this delay (null = no echo). Default 1500. */
  echoDelayMs?: number | null;
  /** Timer (tests pass a fake). */
  schedule?: (fn: () => void, ms: number) => void;
  /** Templates the mock account "has". Default: a few typical shop templates. */
  templates?: RemoteTemplate[];
}

export const MOCK_TEMPLATES: RemoteTemplate[] = [
  {
    id: "mock_tpl_1",
    name: "offer_announcement",
    language: "en",
    status: "APPROVED",
    category: "MARKETING",
    parameterFormat: "POSITIONAL",
    components: [
      { type: "HEADER", format: "IMAGE" },
      { type: "BODY", text: "Hi {{1}}, {{2}} at our shop this week. Show this message to get it." },
      { type: "FOOTER", text: "Reply STOP to unsubscribe" },
      { type: "BUTTONS", buttons: [{ type: "URL", text: "Shop now", url: "https://shop.example.com/{{1}}" }] },
    ],
  },
  {
    id: "mock_tpl_2",
    name: "payment_reminder",
    language: "en",
    status: "APPROVED",
    category: "UTILITY",
    parameterFormat: "POSITIONAL",
    components: [{ type: "BODY", text: "Dear {{1}}, your balance of {{2}} is due. Please pay at your convenience. Thank you." }],
  },
  {
    id: "mock_tpl_3",
    name: "payment_reminder",
    language: "ta",
    status: "APPROVED",
    category: "UTILITY",
    parameterFormat: "POSITIONAL",
    components: [{ type: "BODY", text: "அன்புள்ள {{1}}, உங்கள் நிலுவைத் தொகை {{2}}. தயவுசெய்து செலுத்தவும். நன்றி." }],
  },
];

/**
 * Development driver: never calls Meta. Every send gets a `wamid.mock-…` id and synthetic sent → delivered → read
 * status webhooks; text messages are echoed back as an inbound message (so the inbox can be tried end to end).
 * Numbers ending in `0000` fail (status `failed`, code 131026 "message undeliverable"); a template named
 * `reject_me` is refused synchronously (400).
 */
export class MockDriver implements WhatsAppDriver {
  readonly name = "mock" as const;
  readonly sent: { to: string; payload: OutboundPayload; providerId: string }[] = [];
  readonly reads: string[] = [];

  constructor(
    private readonly tenantId: string,
    private readonly sink: MockSink | null,
    private readonly opts: MockDriverOptions = {},
  ) {}

  private later(fn: () => Promise<unknown>, ms: number) {
    const schedule = this.opts.schedule ?? ((f: () => void, d: number) => setTimeout(f, d).unref?.());
    schedule(() => void fn().catch(() => undefined), ms);
  }

  async send(to: string, payload: OutboundPayload): Promise<{ providerId: string }> {
    if (payload.type === "template" && payload.name === "reject_me") {
      throw new WhatsAppProviderError(400, { error: { code: 132001, message: "Template name does not exist in the translation" } }, 132001);
    }
    const providerId = `wamid.mock-${newId()}`;
    this.sent.push({ to, payload, providerId });
    if (!this.sink) return { providerId };
    const sink = this.sink;
    const [dSent, dDelivered, dRead] = this.opts.statusDelaysMs ?? [200, 1000, 3000];
    const status = (s: OutboundStatus, errors: StatusUpdate["errors"] = []): StatusUpdate => ({
      phoneNumberId: "mock",
      providerId,
      status: s,
      recipient: to,
      timestamp: new Date(),
      errors,
    });
    if (/0000$/.test(to)) {
      this.later(() => sink.statuses(this.tenantId, [status("failed", [{ code: 131026, title: "Message undeliverable", message: "Mock: number ends in 0000" }])]), dSent);
    } else {
      this.later(() => sink.statuses(this.tenantId, [status("sent")]), dSent);
      this.later(() => sink.statuses(this.tenantId, [status("delivered")]), dDelivered);
      this.later(() => sink.statuses(this.tenantId, [status("read")]), dRead);
    }
    const echo = this.opts.echoDelayMs === undefined ? 1500 : this.opts.echoDelayMs;
    if (payload.type === "text" && echo !== null) {
      const msg: InboundMessage = {
        phoneNumberId: "mock",
        providerId: `wamid.mock-in-${newId()}`,
        from: to,
        name: null,
        timestamp: new Date(),
        type: "text",
        body: `Echo: ${payload.body}`,
        media: null,
        replyTo: providerId,
        extra: null,
      };
      this.later(() => sink.messages(this.tenantId, [msg]), echo);
    }
    return { providerId };
  }

  async markRead(providerId: string): Promise<void> {
    this.reads.push(providerId);
  }

  async listTemplates(): Promise<RemoteTemplate[]> {
    return this.opts.templates ?? MOCK_TEMPLATES;
  }
}
