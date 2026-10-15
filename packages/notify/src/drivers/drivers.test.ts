import { decodeJwt, exportPKCS8, generateKeyPair } from "jose";
import { describe, expect, it, vi } from "vitest";
import { ProviderError } from "../types";
import { ConsoleDriver } from "./console";
import { FcmDriver, GOOGLE_TOKEN_URL, isUnregisteredTokenError } from "./fcm";
import { MSG91_FLOW_URL, Msg91Driver } from "./msg91";
import { RESEND_URL, ResendDriver } from "./resend";
import { WhatsAppDriver } from "./whatsapp";

type Call = { url: string; init: RequestInit };

function mockFetch(...responses: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses.shift() ?? { body: {} };
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const jsonBody = (c: Call) => JSON.parse(String(c.init.body));
const headers = (c: Call) => c.init.headers as Record<string, string>;

describe("Msg91Driver", () => {
  const config = { authKey: "AK", senderId: "SRIRTL", flowIds: { "auth.otp": "flow-otp" } };

  it("posts the flow with authkey header and variables", async () => {
    const m = mockFetch({ body: { type: "success", request_id: "req-1" } });
    const res = await new Msg91Driver(config, m.fetch).send({
      to: "+91 98765 43210",
      body: "ignored",
      templateKey: "auth.otp",
      vars: { code: "1234", minutes: "5" },
    });
    expect(res.providerId).toBe("req-1");
    expect(m.calls[0]!.url).toBe(MSG91_FLOW_URL);
    expect(headers(m.calls[0]!).authkey).toBe("AK");
    expect(jsonBody(m.calls[0]!)).toEqual({
      template_id: "flow-otp",
      sender: "SRIRTL",
      short_url: "0",
      recipients: [{ mobiles: "919876543210", code: "1234", minutes: "5" }],
    });
  });

  it("prefers the template's provider flow id", async () => {
    const m = mockFetch({ body: { type: "success", request_id: "r" } });
    await new Msg91Driver(config, m.fetch).send({ to: "919", body: "", templateKey: "auth.otp", templateRef: { name: "flow-db", language: "en", params: [] } });
    expect(jsonBody(m.calls[0]!).template_id).toBe("flow-db");
  });

  it("errors without a flow id (DLT)", async () => {
    const m = mockFetch();
    await expect(new Msg91Driver(config, m.fetch).send({ to: "919", body: "hi", templateKey: "order.placed" })).rejects.toThrow(/no DLT flow id/);
    expect(m.calls).toHaveLength(0);
  });

  it("throws ProviderError with status and body", async () => {
    const m = mockFetch({ status: 401, body: { type: "error", message: "Invalid authkey" } });
    const err = await new Msg91Driver(config, m.fetch).send({ to: "919", body: "", templateKey: "auth.otp" }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(401);
    expect(err.message).toContain("Invalid authkey");
  });

  it("treats a 200 with type=error as a failure", async () => {
    const m = mockFetch({ body: { type: "error", message: "Template not approved" } });
    await expect(new Msg91Driver(config, m.fetch).send({ to: "919", body: "", templateKey: "auth.otp" })).rejects.toThrow(/Template not approved/);
  });
});

describe("ResendDriver", () => {
  it("sends from/to/subject/html/text with a bearer key", async () => {
    const m = mockFetch({ body: { id: "em_1" } });
    const res = await new ResendDriver({ apiKey: "re_x", from: "App <no-reply@app.in>" }, m.fetch).send({
      to: "a@b.in",
      subject: "S",
      body: "T",
      html: "<p>T</p>",
    });
    expect(res.providerId).toBe("em_1");
    expect(m.calls[0]!.url).toBe(RESEND_URL);
    expect(headers(m.calls[0]!).authorization).toBe("Bearer re_x");
    expect(jsonBody(m.calls[0]!)).toEqual({ from: "App <no-reply@app.in>", to: ["a@b.in"], subject: "S", html: "<p>T</p>", text: "T" });
  });

  it("includes status and body in errors", async () => {
    const m = mockFetch({ status: 422, body: { message: "Invalid `to` field" } });
    await expect(new ResendDriver({ apiKey: "k", from: "f" }, m.fetch).send({ to: "x", body: "b" })).rejects.toThrow(/422.*Invalid `to` field/);
  });
});

describe("WhatsAppDriver", () => {
  const cfg = { token: "WA", phoneNumberId: "12345" };

  it("sends template messages with body parameters", async () => {
    const m = mockFetch({ body: { messages: [{ id: "wamid.1" }] } });
    const res = await new WhatsAppDriver(cfg, m.fetch).send({
      to: "+919876543210",
      body: "x",
      templateRef: { name: "otp_code", language: "ta", params: ["1234", "5"] },
    });
    expect(res.providerId).toBe("wamid.1");
    expect(m.calls[0]!.url).toBe("https://graph.facebook.com/v21.0/12345/messages");
    expect(headers(m.calls[0]!).authorization).toBe("Bearer WA");
    expect(jsonBody(m.calls[0]!)).toMatchObject({
      to: "919876543210",
      type: "template",
      template: {
        name: "otp_code",
        language: { code: "ta" },
        components: [{ type: "body", parameters: [{ type: "text", text: "1234" }, { type: "text", text: "5" }] }],
      },
    });
  });

  it("sends session text without a template", async () => {
    const m = mockFetch({ body: { messages: [{ id: "wamid.2" }] } });
    await new WhatsAppDriver(cfg, m.fetch).send({ to: "919", body: "வணக்கம்" });
    expect(jsonBody(m.calls[0]!)).toMatchObject({ type: "text", text: { body: "வணக்கம்" } });
  });
});

describe("FcmDriver", () => {
  async function serviceAccount() {
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    return JSON.stringify({
      project_id: "proj-1",
      client_email: "fcm@proj-1.iam.gserviceaccount.com",
      private_key: await exportPKCS8(privateKey),
      private_key_id: "kid1",
    });
  }

  it("exchanges a signed JWT for a token, caches it, and sends", async () => {
    const sa = await serviceAccount();
    let now = 1_700_000_000_000;
    const m = mockFetch(
      { body: { access_token: "ya29.a", expires_in: 3600 } },
      { body: { name: "projects/proj-1/messages/1" } },
      { body: { name: "projects/proj-1/messages/2" } },
      { body: { access_token: "ya29.b", expires_in: 3600 } },
      { body: { name: "projects/proj-1/messages/3" } },
    );
    const d = new FcmDriver({ serviceAccountJson: sa }, m.fetch, () => now);

    const r1 = await d.send({ to: "tok-1", subject: "Hi", body: "B", data: { orderId: "9" } });
    expect(r1.providerId).toBe("projects/proj-1/messages/1");
    expect(m.calls[0]!.url).toBe(GOOGLE_TOKEN_URL);
    const form = new URLSearchParams(String(m.calls[0]!.init.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const claims = decodeJwt(form.get("assertion")!);
    expect(claims).toMatchObject({
      iss: "fcm@proj-1.iam.gserviceaccount.com",
      aud: GOOGLE_TOKEN_URL,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    });
    expect(m.calls[1]!.url).toBe("https://fcm.googleapis.com/v1/projects/proj-1/messages:send");
    expect(headers(m.calls[1]!).authorization).toBe("Bearer ya29.a");
    expect(jsonBody(m.calls[1]!)).toEqual({ message: { token: "tok-1", notification: { title: "Hi", body: "B" }, data: { orderId: "9" } } });

    // Cached until 60s before expiry.
    now += 3500 * 1000;
    await d.send({ to: "tok-2", body: "B" });
    expect(m.calls[2]!.url).toContain("messages:send");
    now += 60 * 1000;
    await d.send({ to: "tok-3", body: "B" });
    expect(m.calls[3]!.url).toBe(GOOGLE_TOKEN_URL);
    expect(headers(m.calls[4]!).authorization).toBe("Bearer ya29.b");
  });

  it("flags UNREGISTERED tokens", async () => {
    const m = mockFetch(
      { body: { access_token: "a", expires_in: 3600 } },
      {
        status: 404,
        body: {
          error: {
            code: 404,
            status: "NOT_FOUND",
            details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }],
          },
        },
      },
    );
    const err = await new FcmDriver({ serviceAccountJson: await serviceAccount() }, m.fetch).send({ to: "dead", body: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(404);
    expect(isUnregisteredTokenError(err)).toBe(true);
    expect(isUnregisteredTokenError(new ProviderError("fcm", 500, {}))).toBe(false);
  });

  it("rejects incomplete service accounts", () => {
    expect(() => new FcmDriver({ serviceAccountJson: "{}" })).toThrow(/project_id/);
  });
});

describe("ConsoleDriver", () => {
  it("logs through the logger port", async () => {
    const info = vi.fn();
    await new ConsoleDriver("sms", { info, warn: vi.fn(), error: vi.fn() }).send({ to: "+91", body: "hello" });
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ channel: "sms", body: "hello" }), expect.stringContaining("sms"));
  });
});

describe("email attachments", () => {
  const content = Buffer.from("a,b\n1,2\n").toString("base64");

  it("Resend sends filename + base64 content", async () => {
    const m = mockFetch({ body: { id: "em_2" } });
    await new ResendDriver({ apiKey: "k", from: "f" }, m.fetch).send({
      to: "a@b.in",
      subject: "S",
      body: "T",
      attachments: [{ filename: "report.csv", contentType: "text/csv", content }],
    });
    expect(jsonBody(m.calls[0]!).attachments).toEqual([{ filename: "report.csv", content }]);
  });

  it("Resend omits attachments when there are none", async () => {
    const m = mockFetch({ body: { id: "em_3" } });
    await new ResendDriver({ apiKey: "k", from: "f" }, m.fetch).send({ to: "a@b.in", body: "T" });
    expect(jsonBody(m.calls[0]!)).not.toHaveProperty("attachments");
  });

  it("Console logs attachment names and sizes, never content", async () => {
    const info = vi.fn();
    await new ConsoleDriver("email", { info, warn: vi.fn(), error: vi.fn() }).send({
      to: "x@y",
      body: "hi",
      attachments: [{ filename: "report.csv", contentType: "text/csv", content }],
    });
    const [entry, line] = info.mock.calls[0]!;
    expect(entry.attachments).toEqual([{ filename: "report.csv", contentType: "text/csv", size: 8 }]);
    expect(JSON.stringify(entry)).not.toContain(content);
    expect(line).toBe("[notify:console] email → x@y (attachments: report.csv 8 B)");
  });
});
