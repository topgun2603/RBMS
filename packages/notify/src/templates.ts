import type { ProviderRef } from "./schema";
import type { Channel } from "./types";

export interface TemplateContent {
  key: string;
  channel: Channel;
  locale: string;
  subject: string | null;
  body: string;
  providerRef: ProviderRef | null;
}

/** A template candidate as loaded from the database (subset of the row). */
export interface TemplateCandidate extends TemplateContent {
  tenantId: string | null;
}

export type TemplateSource = "tenant" | "global" | "builtin";

const OTP_EN = "{{code}} is your {{app}} verification code. It expires in {{minutes}} minutes. Do not share it with anyone.";
const OTP_TA =
  "{{code}} என்பது உங்கள் {{app}} சரிபார்ப்புக் குறியீடு. இது {{minutes}} நிமிடங்களில் காலாவதியாகும். இதை யாருடனும் பகிர வேண்டாம்.";
const OTP_SUBJECT_EN = "Your {{app}} verification code";
const OTP_SUBJECT_TA = "உங்கள் {{app}} சரிபார்ப்புக் குறியீடு";

function builtin(key: string, channels: Channel[], locale: string, body: string, subject: string | null): TemplateContent[] {
  return channels.map((channel) => ({
    key,
    channel,
    locale,
    subject: channel === "email" ? subject : null,
    body,
    providerRef: null,
  }));
}

/** Templates that ship with the module; tenants and the platform can override them in the database. */
export const BUILTIN_TEMPLATES: readonly TemplateContent[] = [
  ...builtin("auth.otp", ["sms", "whatsapp", "email"], "en", OTP_EN, OTP_SUBJECT_EN),
  ...builtin("auth.otp", ["sms", "whatsapp", "email"], "ta", OTP_TA, OTP_SUBJECT_TA),
];

/**
 * Picks the best template. Order:
 * tenant+locale → tenant+en → global+locale → global+en → built-in+locale → built-in+en.
 * `candidates` are DB rows already filtered by key and channel.
 */
export function pickTemplate(
  candidates: readonly TemplateCandidate[],
  opts: { tenantId: string | null; key: string; channel: Channel; locale: string },
  builtins: readonly TemplateContent[] = BUILTIN_TEMPLATES,
): { template: TemplateContent; source: TemplateSource } | null {
  const locales = opts.locale === "en" ? ["en"] : [opts.locale, "en"];
  const matching = candidates.filter((c) => c.key === opts.key && c.channel === opts.channel);
  if (opts.tenantId) {
    for (const loc of locales) {
      const t = matching.find((c) => c.tenantId === opts.tenantId && c.locale === loc);
      if (t) return { template: t, source: "tenant" };
    }
  }
  for (const loc of locales) {
    const t = matching.find((c) => c.tenantId === null && c.locale === loc);
    if (t) return { template: t, source: "global" };
  }
  for (const loc of locales) {
    const t = builtins.find((b) => b.key === opts.key && b.channel === opts.channel && b.locale === loc);
    if (t) return { template: t, source: "builtin" };
  }
  return null;
}

/** Normalises "ta-IN" → "ta". */
export const baseLocale = (locale: string | undefined | null) => (locale || "en").toLowerCase().split(/[-_]/)[0] || "en";
