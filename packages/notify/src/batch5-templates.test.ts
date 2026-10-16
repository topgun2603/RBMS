import { describe, expect, it } from "vitest";
import { BATCH5_TEMPLATE_KEYS, BUILTIN_TEMPLATES, pickTemplate } from "./templates";

describe("batch 5 subscription templates", () => {
  it("has every key the subscriptions module sends", () => {
    expect([...BATCH5_TEMPLATE_KEYS].sort()).toEqual(
      [
        "subscription.activated",
        "subscription.cancelled",
        "subscription.charged",
        "subscription.expired",
        "subscription.payment_failed",
        "subscription.renewal_reminder",
        "subscription.trial_ended",
        "subscription.trial_ending",
      ].sort(),
    );
  });

  it("ships English and Tamil on sms, whatsapp and email (email with a subject), as global built-ins", () => {
    for (const key of BATCH5_TEMPLATE_KEYS) {
      for (const channel of ["sms", "whatsapp", "email"] as const) {
        for (const locale of ["en", "ta"]) {
          const t = pickTemplate([], { tenantId: null, key, channel, locale });
          expect(t?.source, `${key} ${channel} ${locale}`).toBe("builtin");
          expect(t?.template.locale).toBe(locale);
          if (channel === "email") expect(t?.template.subject).toBeTruthy();
        }
      }
    }
  });

  it("uses no Hindi terms and keeps English SMS GSM-7 friendly", () => {
    const hindi = /khata|udhaar|udhar|bahi|rupaye|dhanyavad/i;
    for (const t of BUILTIN_TEMPLATES.filter((x) => BATCH5_TEMPLATE_KEYS.includes(x.key))) {
      expect(hindi.test(`${t.subject ?? ""} ${t.body}`), `${t.key} ${t.locale}`).toBe(false);
      expect(/[ऀ-ॿ]/.test(t.body), "no Devanagari").toBe(false);
      if (t.locale === "en" && t.channel === "sms") expect(/^[\x20-\x7E]*$/.test(t.body), `${t.key} ASCII`).toBe(true);
      if (t.locale === "ta") expect(/[஀-௿]/.test(t.body), `${t.key} Tamil`).toBe(true);
    }
  });

  it("the charged email names the invoice number", () => {
    const t = pickTemplate([], { tenantId: null, key: "subscription.charged", channel: "email", locale: "en" });
    expect(t?.template.body).toContain("{{number}}");
    expect(t?.template.subject).toContain("{{number}}");
  });
});
