import { describe, expect, it } from "vitest";
import { composeMessage } from "./compose";
import { BUILTIN_TEMPLATES, baseLocale, pickTemplate, type TemplateCandidate } from "./templates";

const T = "11111111-1111-1111-1111-111111111111";
const cand = (tenantId: string | null, locale: string, body: string): TemplateCandidate => ({
  tenantId,
  key: "auth.otp",
  channel: "sms",
  locale,
  subject: null,
  body,
  providerRef: null,
});

describe("pickTemplate", () => {
  const all = [cand(T, "ta", "tenant-ta"), cand(T, "en", "tenant-en"), cand(null, "ta", "global-ta"), cand(null, "en", "global-en")];
  const opts = { tenantId: T, key: "auth.otp", channel: "sms" as const, locale: "ta" };

  it("follows tenant → global → built-in, locale before en", () => {
    expect(pickTemplate(all, opts)?.template.body).toBe("tenant-ta");
    expect(pickTemplate(all.slice(1), opts)?.template.body).toBe("tenant-en");
    expect(pickTemplate(all.slice(2), opts)).toMatchObject({ source: "global", template: { body: "global-ta" } });
    expect(pickTemplate(all.slice(3), opts)?.template.body).toBe("global-en");
    const builtin = pickTemplate([], opts);
    expect(builtin?.source).toBe("builtin");
    expect(builtin?.template.locale).toBe("ta");
  });

  it("falls back to built-in English for unknown locales", () => {
    expect(pickTemplate([], { ...opts, locale: "hi" })?.template.locale).toBe("en");
  });

  it("ignores other tenants' rows and returns null when nothing matches", () => {
    const other = cand("22222222-2222-2222-2222-222222222222", "ta", "other");
    expect(pickTemplate([other], opts)?.source).toBe("builtin");
    expect(pickTemplate([], { ...opts, key: "order.placed" })).toBeNull();
    expect(pickTemplate([], { ...opts, channel: "push" })).toBeNull();
  });

  it("ships en + ta OTP templates for sms, whatsapp and email", () => {
    for (const channel of ["sms", "whatsapp", "email"]) {
      for (const locale of ["en", "ta"]) {
        expect(BUILTIN_TEMPLATES.some((t) => t.key === "auth.otp" && t.channel === channel && t.locale === locale)).toBe(true);
      }
    }
  });

  it("normalises locales", () => {
    expect(baseLocale("ta-IN")).toBe("ta");
    expect(baseLocale(undefined)).toBe("en");
  });
});

describe("composeMessage", () => {
  const otpEn = BUILTIN_TEMPLATES.find((t) => t.channel === "email" && t.locale === "en")!;
  const vars = { code: "482913", app: "SriShop", minutes: 10 };

  it("renders the built-in OTP email with subject, text and html", () => {
    const msg = composeMessage({ channel: "email", to: "a@b.in", template: otpEn, vars, locale: "en", config: {} });
    expect(msg.subject).toBe("Your SriShop verification code");
    expect(msg.body).toBe("482913 is your SriShop verification code. It expires in 10 minutes. Do not share it with anyone.");
    expect(msg.html).toContain("482913");
    expect(msg.templateKey).toBe("auth.otp");
  });

  it("sets a MSG91 flow reference from provider_ref", () => {
    const tpl = { ...cand(T, "en", "{{code}} is your {{app}} code"), providerRef: { msg91FlowId: "flow-1" } };
    const msg = composeMessage({ channel: "sms", to: "+91987", template: tpl, vars, locale: "en", config: {} });
    expect(msg.templateRef).toEqual({ name: "flow-1", language: "en", params: ["482913", "SriShop"] });
    expect(msg.vars).toMatchObject({ code: "482913", minutes: "10" });
  });

  it("uses a configured WhatsApp template, else sends session text", () => {
    const tpl = { ...cand(null, "ta", "{{code}} {{minutes}}"), channel: "whatsapp" as const };
    const withCfg = composeMessage({
      channel: "whatsapp",
      to: "+91987",
      template: tpl,
      vars,
      locale: "ta",
      config: { whatsapp: { token: "t", phoneNumberId: "p", templates: { "auth.otp": { name: "otp_code" } } } },
    });
    expect(withCfg.templateRef).toEqual({ name: "otp_code", language: "ta", params: ["482913", "10"] });
    const plain = composeMessage({ channel: "whatsapp", to: "+91987", template: tpl, vars, locale: "ta", config: {} });
    expect(plain.templateRef).toBeUndefined();
    expect(plain.body).toBe("482913 10");
  });

  it("renders a raw body without a template", () => {
    const msg = composeMessage({ channel: "push", to: "tok", template: null, subject: "Hi {{n}}", body: "Body {{n}}", vars: { n: 1 }, locale: "en", config: {} });
    expect(msg).toMatchObject({ subject: "Hi 1", body: "Body 1", data: { n: "1" } });
  });
});
