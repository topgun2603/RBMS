import { describe, expect, it } from "vitest";
import { composeMessage } from "./compose";
import { placeholders, render } from "./render";
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
    expect(pickTemplate([], { ...opts, key: "order.unknown" })).toBeNull();
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

describe("billing templates", () => {
  const VARS: Record<string, string[]> = {
    "invoice.issued": ["shop", "customer", "number", "amount", "dueDate", "link"],
    "invoice.reminder": ["shop", "customer", "number", "amount", "dueDate", "link"],
    "payment.received": ["shop", "customer", "number", "amount", "balance"],
  };
  // Long but realistic values: 30-char shop, 24-char customer, 16-char number, crore amount, ~60-char link.
  const sample = {
    shop: "Sri Lakshmi Silks and Sarees 1",
    customer: "Ravichandran Subramanian",
    number: "SRISLK/26-27/123",
    amount: "Rs.1,00,00,000.00",
    balance: "Rs.1,00,00,000.00",
    dueDate: "14 Oct 2026",
    link: "https://sri-lakshmi-silks.srirealtime.com/i/AbCdEfGhIjKlMnOpQrStUv",
  };
  const GSM7 = /^[A-Za-z0-9 @£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\[~\]|€]*$/;

  it("ships sms + whatsapp in English and Tamil", () => {
    for (const key of Object.keys(VARS)) {
      for (const channel of ["sms", "whatsapp"] as const) {
        for (const locale of ["en", "ta"]) {
          const t = BUILTIN_TEMPLATES.find((b) => b.key === key && b.channel === channel && b.locale === locale);
          expect(t, `${key}/${channel}/${locale}`).toBeDefined();
          expect(t!.subject).toBeNull();
          expect(pickTemplate([], { tenantId: null, key, channel, locale })?.template).toBe(t);
        }
      }
    }
  });

  it("only uses the variables the invoices module sends", () => {
    for (const t of BUILTIN_TEMPLATES.filter((b) => b.key in VARS)) {
      for (const name of placeholders(t.body)) expect(VARS[t.key], `${t.key}/${t.locale}: ${name}`).toContain(name);
      expect(placeholders(t.body)).toContain("shop");
    }
  });

  it("keeps English SMS within two GSM-7 segments", () => {
    for (const t of BUILTIN_TEMPLATES.filter((b) => b.key in VARS && b.channel === "sms" && b.locale === "en")) {
      const text = render(t.body, sample);
      expect(text, t.key).toMatch(GSM7);
      expect(text.length, t.key).toBeLessThanOrEqual(306);
    }
  });

  it("writes the Tamil versions in Tamil script", () => {
    for (const t of BUILTIN_TEMPLATES.filter((b) => b.key in VARS && b.locale === "ta")) {
      expect(t.body).toMatch(/[஀-௿]{3,}/);
    }
  });

  it("renders a reminder", () => {
    const t = pickTemplate([], { tenantId: null, key: "invoice.reminder", channel: "whatsapp", locale: "en" })!.template;
    expect(render(t.body, { ...sample, amount: "₹950.00" })).toBe(
      "Sri Lakshmi Silks and Sarees 1: Dear Ravichandran Subramanian, ₹950.00 is pending on your account. Please pay: https://sri-lakshmi-silks.srirealtime.com/i/AbCdEfGhIjKlMnOpQrStUv Ignore if already paid.",
    );
  });
});

describe("order templates", () => {
  const VARS: Record<string, string[]> = {
    "order.placed": ["shop", "customer", "number", "amount", "items", "link"],
    "order.received": ["shop", "customer", "number", "amount", "items", "link"],
    "order.confirmed": ["shop", "customer", "number", "link"],
    "order.shipped": ["shop", "customer", "number", "tracking", "link"],
    "order.delivered": ["shop", "customer", "number", "link"],
    "order.cancelled": ["shop", "customer", "number", "link"],
  };
  const sample = {
    shop: "Sri Lakshmi Silks and Sarees 1",
    customer: "Ravichandran Subramanian",
    number: "ORDERS/26-27/1234",
    amount: "Rs.1,00,00,000.00",
    items: "12 items",
    tracking: "Professional Couriers 123456789012",
    link: "https://sri-lakshmi-silks.srirealtime.com/o/AbCdEfGhIjKlMnOpQrStUvWx",
  };
  const GSM7 = /^[A-Za-z0-9 @£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\[~\]|€]*$/;

  it("ships sms, whatsapp and email in English and Tamil", () => {
    for (const key of Object.keys(VARS)) {
      for (const channel of ["sms", "whatsapp", "email"] as const) {
        for (const locale of ["en", "ta"]) {
          const t = BUILTIN_TEMPLATES.find((b) => b.key === key && b.channel === channel && b.locale === locale);
          expect(t, `${key}/${channel}/${locale}`).toBeDefined();
          if (channel === "email") expect(t!.subject, `${key}/${locale} subject`).toBeTruthy();
          else expect(t!.subject).toBeNull();
          expect(pickTemplate([], { tenantId: null, key, channel, locale })?.template).toBe(t);
        }
      }
    }
  });

  it("only uses the documented variables, always naming the shop and order", () => {
    for (const t of BUILTIN_TEMPLATES.filter((b) => b.key in VARS)) {
      const used = [...placeholders(t.body), ...placeholders(t.subject ?? "")];
      for (const name of used) expect(VARS[t.key], `${t.key}/${t.locale}: ${name}`).toContain(name);
      expect(placeholders(t.body)).toEqual(expect.arrayContaining(["shop", "number"]));
    }
  });

  it("keeps English SMS within two GSM-7 segments", () => {
    for (const t of BUILTIN_TEMPLATES.filter((b) => b.key in VARS && b.channel === "sms" && b.locale === "en")) {
      const text = render(t.body, sample);
      expect(text, t.key).toMatch(GSM7);
      expect(text.length, t.key).toBeLessThanOrEqual(306);
    }
  });

  it("writes the Tamil versions (and subjects) in Tamil script", () => {
    for (const t of BUILTIN_TEMPLATES.filter((b) => b.key in VARS && b.locale === "ta")) {
      expect(t.body).toMatch(/[஀-௿]{3,}/);
      if (t.subject) expect(t.subject).toMatch(/[஀-௿]{3,}/);
    }
  });

  it("renders a shipped message and an email with subject", () => {
    const wa = pickTemplate([], { tenantId: null, key: "order.shipped", channel: "whatsapp", locale: "en" })!.template;
    expect(render(wa.body, { ...sample, amount: "₹950.00", tracking: "DTDC D123", link: "https://t.example/D123", number: "ORD/26-27/0007" })).toBe(
      "Sri Lakshmi Silks and Sarees 1: Dear Ravichandran Subramanian, your order ORD/26-27/0007 has been shipped. Courier: DTDC D123. Track: https://t.example/D123",
    );
    const email = pickTemplate([], { tenantId: null, key: "order.placed", channel: "email", locale: "ta" })!.template;
    const msg = composeMessage({ channel: "email", to: "a@b.in", template: email, vars: sample, locale: "ta", config: {} });
    expect(msg.subject).toBe("ஆர்டர் ORDERS/26-27/1234 பெறப்பட்டது - Sri Lakshmi Silks and Sarees 1");
    expect(msg.body).toContain("நன்றி Ravichandran Subramanian!");
    expect(msg.html).toContain("https://sri-lakshmi-silks.srirealtime.com/o/");
  });
});
