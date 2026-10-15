import { describe, expect, it, vi } from "vitest";
import { buildMessagePayload, MetaDriver } from "./meta";
import { MockDriver } from "./mock";
import { WhatsAppProviderError } from "./types";

const account = { phoneNumberId: "1234567890", wabaId: "998877", token: "EAAG-secret-token" };

function fakeFetch(responses: { status?: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses.shift() ?? { body: {} };
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe("buildMessagePayload", () => {
  it("text, reply context, template, image and document", () => {
    expect(buildMessagePayload("+919876543210", { type: "text", body: "Hi", replyTo: "wamid.X" })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "919876543210",
      type: "text",
      text: { body: "Hi", preview_url: false },
      context: { message_id: "wamid.X" },
    });
    expect(
      buildMessagePayload("+919876543210", {
        type: "template",
        name: "payment_reminder",
        language: "ta",
        components: [{ type: "body", parameters: [{ type: "text", text: "Ravi" }] }],
      }),
    ).toMatchObject({ type: "template", template: { name: "payment_reminder", language: { code: "ta" }, components: [{ type: "body" }] } });
    expect(buildMessagePayload("+919876543210", { type: "template", name: "hello_world", language: "en_US", components: [] })).toMatchObject({
      template: { name: "hello_world", language: { code: "en_US" } },
    });
    expect((buildMessagePayload("+919876543210", { type: "template", name: "h", language: "en", components: [] }).template as object)).not.toHaveProperty("components");
    expect(buildMessagePayload("+919876543210", { type: "image", link: "https://x/y.jpg", caption: "Bill" })).toMatchObject({ type: "image", image: { link: "https://x/y.jpg", caption: "Bill" } });
    expect(buildMessagePayload("+919876543210", { type: "document", link: "https://x/b.pdf", filename: "INV-1.pdf" })).toMatchObject({
      type: "document",
      document: { link: "https://x/b.pdf", filename: "INV-1.pdf" },
    });
  });
});

describe("MetaDriver", () => {
  it("sends to /{phone-number-id}/messages with the bearer token", async () => {
    const { fn, calls } = fakeFetch([{ body: { messaging_product: "whatsapp", messages: [{ id: "wamid.OK" }] } }]);
    const d = new MetaDriver(account, fn);
    await expect(d.send("+919876543210", { type: "text", body: "Hello" })).resolves.toEqual({ providerId: "wamid.OK" });
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v21.0/1234567890/messages");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer EAAG-secret-token");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ to: "919876543210", type: "text" });
  });

  it("marks messages read", async () => {
    const { fn, calls } = fakeFetch([{ body: { success: true } }]);
    await new MetaDriver(account, fn).markRead("wamid.IN");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid.IN" });
  });

  it("throws WhatsAppProviderError with Meta's error code", async () => {
    const { fn } = fakeFetch([{ status: 400, body: { error: { message: "Re-engagement", code: 131047, error_data: { details: "24h passed" } } } }]);
    const err = await new MetaDriver(account, fn).send("+919876543210", { type: "text", body: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(WhatsAppProviderError);
    expect(err.status).toBe(400);
    expect(err.code).toBe(131047);
    expect(err.message).toContain("24h passed");
  });

  it("lists templates across pages", async () => {
    const { fn, calls } = fakeFetch([
      {
        body: {
          data: [{ id: "1", name: "payment_reminder", language: "en", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Hi {{1}}" }] }],
          paging: { next: "https://graph.facebook.com/v21.0/998877/message_templates?after=abc" },
        },
      },
      { body: { data: [{ id: "2", name: "offer", language: "ta", status: "PENDING", parameter_format: "NAMED", components: [] }, { bad: true }] } },
    ]);
    const list = await new MetaDriver(account, fn).listTemplates();
    expect(calls[0]!.url).toContain("https://graph.facebook.com/v21.0/998877/message_templates?fields=");
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[1]!.url).toBe("https://graph.facebook.com/v21.0/998877/message_templates?after=abc");
    expect(list.map((t) => [t.name, t.language, t.status, t.parameterFormat])).toEqual([
      ["payment_reminder", "en", "APPROVED", null],
      ["offer", "ta", "PENDING", "NAMED"],
    ]);
  });

  it("does not follow paging links to other hosts", async () => {
    const { fn, calls } = fakeFetch([{ body: { data: [], paging: { next: "https://evil.example.com/steal" } } }]);
    await new MetaDriver(account, fn).listTemplates();
    expect(calls).toHaveLength(1);
  });
});

describe("MockDriver", () => {
  function setup(opts: { echo?: number | null } = {}) {
    const timers: { fn: () => void; ms: number }[] = [];
    const sink = { statuses: vi.fn(async () => undefined), messages: vi.fn(async () => undefined) };
    const d = new MockDriver("t1", sink, { schedule: (fn, ms) => timers.push({ fn, ms }), echoDelayMs: opts.echo === undefined ? 1500 : opts.echo });
    const flush = () => timers.splice(0).sort((a, b) => a.ms - b.ms).forEach((t) => t.fn());
    return { d, sink, flush, timers };
  }

  it("returns mock ids, emits sent/delivered/read and echoes text", async () => {
    const { d, sink, flush } = setup();
    const { providerId } = await d.send("+919876543210", { type: "text", body: "Hello" });
    expect(providerId).toMatch(/^wamid\.mock-/);
    flush();
    await Promise.resolve();
    const statuses = sink.statuses.mock.calls.map((c) => (c as unknown as [string, { status: string; providerId: string }[]])[1][0]!);
    expect(statuses.map((s) => s.status)).toEqual(["sent", "delivered", "read"]);
    expect(statuses.every((s) => s.providerId === providerId)).toBe(true);
    const [tenant, msgs] = sink.messages.mock.calls[0] as unknown as [string, { body: string; from: string; replyTo: string }[]];
    expect(tenant).toBe("t1");
    expect(msgs[0]).toMatchObject({ body: "Echo: Hello", from: "+919876543210", replyTo: providerId });
  });

  it("fails numbers ending in 0000 and rejects template reject_me", async () => {
    const { d, sink, flush } = setup({ echo: null });
    await d.send("+919876500000", { type: "template", name: "x", language: "en", components: [] });
    flush();
    await Promise.resolve();
    expect(sink.statuses.mock.calls).toHaveLength(1);
    expect((sink.statuses.mock.calls[0] as unknown as [string, { status: string; errors: { code: number }[] }[]])[1][0]).toMatchObject({ status: "failed", errors: [{ code: 131026 }] });
    expect(sink.messages).not.toHaveBeenCalled();
    await expect(d.send("+919876543210", { type: "template", name: "reject_me", language: "en", components: [] })).rejects.toBeInstanceOf(WhatsAppProviderError);
  });

  it("lists mock templates and records reads", async () => {
    const { d } = setup();
    expect((await d.listTemplates()).map((t) => t.name)).toContain("payment_reminder");
    await d.markRead("wamid.1");
    expect(d.reads).toEqual(["wamid.1"]);
  });
});
