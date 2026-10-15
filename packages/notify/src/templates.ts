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

// Billing (invoices module). English SMS stays within GSM-7 (amounts arrive as "Rs.1,234.50") and 2 segments.
// Vars — invoice.issued: shop, customer, number, amount, dueDate, link; invoice.reminder: shop, customer, amount,
// link (+ number, dueDate for automatic reminders); payment.received: shop, customer, number, amount, balance.
const INVOICE_ISSUED_EN = "{{shop}}: Dear {{customer}}, your bill {{number}} for {{amount}} is ready. View and pay: {{link}}";
const INVOICE_ISSUED_TA = "{{shop}}: வணக்கம் {{customer}}, உங்கள் பில் {{number}} ({{amount}}) தயாராக உள்ளது. பார்க்க / செலுத்த: {{link}}";
const INVOICE_REMINDER_EN = "{{shop}}: Dear {{customer}}, {{amount}} is pending on your account. Please pay: {{link}} Ignore if already paid.";
const INVOICE_REMINDER_TA =
  "{{shop}}: வணக்கம் {{customer}}, உங்கள் கணக்கில் {{amount}} நிலுவையில் உள்ளது. செலுத்த: {{link}} ஏற்கனவே செலுத்தியிருந்தால் இதைப் புறக்கணிக்கவும்.";
const PAYMENT_RECEIVED_EN = "{{shop}}: Thank you {{customer}}! We received {{amount}} for bill {{number}}. Balance due: {{balance}}.";
const PAYMENT_RECEIVED_TA = "{{shop}}: நன்றி {{customer}}! பில் {{number}}-க்கு {{amount}} பெற்றுக்கொண்டோம். மீதி நிலுவை: {{balance}}.";

// Orders (orders module). Customer messages go out on WhatsApp + email (SMS kept for tenants who switch to it);
// English SMS stays within GSM-7 and 2 segments. Vars:
//   order.placed / order.received (to the shop owner): shop, customer, number, amount, items, link
//   order.confirmed, order.delivered, order.cancelled: shop, customer, number, link
//   order.shipped: shop, customer, number, tracking ("<carrier> <tracking no.>" or "-"), link (tracking URL if any)
// The orders module also sends carrier, trackingNumber, trackingUrl, orderLink, reason and paymentMethod for overrides.
const ORDER_EN = {
  placed: "{{shop}}: Thank you {{customer}}! We received your order {{number}} ({{items}}, {{amount}}). Track it: {{link}}",
  received: "{{shop}}: New order {{number}} from {{customer}}: {{items}}, {{amount}}. Open: {{link}}",
  confirmed: "{{shop}}: Dear {{customer}}, your order {{number}} is confirmed. We will ship it soon. Track: {{link}}",
  shipped: "{{shop}}: Dear {{customer}}, your order {{number}} has been shipped. Courier: {{tracking}}. Track: {{link}}",
  delivered: "{{shop}}: Dear {{customer}}, your order {{number}} has been delivered. Thank you for shopping with us! {{link}}",
  cancelled: "{{shop}}: Dear {{customer}}, your order {{number}} has been cancelled. Need help? Contact us: {{link}}",
};
const ORDER_TA = {
  placed: "{{shop}}: நன்றி {{customer}}! உங்கள் ஆர்டர் {{number}} ({{items}}, {{amount}}) பெறப்பட்டது. நிலையைப் பார்க்க: {{link}}",
  received: "{{shop}}: புதிய ஆர்டர் {{number}} — {{customer}}: {{items}}, {{amount}}. பார்க்க: {{link}}",
  confirmed: "{{shop}}: வணக்கம் {{customer}}, உங்கள் ஆர்டர் {{number}} உறுதிசெய்யப்பட்டது. விரைவில் அனுப்புவோம். நிலை: {{link}}",
  shipped: "{{shop}}: வணக்கம் {{customer}}, உங்கள் ஆர்டர் {{number}} அனுப்பப்பட்டது. கூரியர்: {{tracking}}. கண்காணிக்க: {{link}}",
  delivered: "{{shop}}: வணக்கம் {{customer}}, உங்கள் ஆர்டர் {{number}} டெலிவரி செய்யப்பட்டது. எங்களிடம் வாங்கியதற்கு நன்றி! {{link}}",
  cancelled: "{{shop}}: வணக்கம் {{customer}}, உங்கள் ஆர்டர் {{number}} ரத்து செய்யப்பட்டது. உதவிக்கு எங்களைத் தொடர்பு கொள்ளவும்: {{link}}",
};
const ORDER_SUBJECT_EN = {
  placed: "Order {{number}} received - {{shop}}",
  received: "New order {{number}} from {{customer}}",
  confirmed: "Order {{number}} confirmed - {{shop}}",
  shipped: "Order {{number}} shipped - {{shop}}",
  delivered: "Order {{number}} delivered - {{shop}}",
  cancelled: "Order {{number}} cancelled - {{shop}}",
};
const ORDER_SUBJECT_TA = {
  placed: "ஆர்டர் {{number}} பெறப்பட்டது - {{shop}}",
  received: "புதிய ஆர்டர் {{number}} - {{customer}}",
  confirmed: "ஆர்டர் {{number}} உறுதிசெய்யப்பட்டது - {{shop}}",
  shipped: "ஆர்டர் {{number}} அனுப்பப்பட்டது - {{shop}}",
  delivered: "ஆர்டர் {{number}} டெலிவரி செய்யப்பட்டது - {{shop}}",
  cancelled: "ஆர்டர் {{number}} ரத்து செய்யப்பட்டது - {{shop}}",
};
const ORDER_STEPS = ["placed", "received", "confirmed", "shipped", "delivered", "cancelled"] as const;

function orderTemplates(): TemplateContent[] {
  return ORDER_STEPS.flatMap((step) => [
    ...builtin(`order.${step}`, ["sms", "whatsapp", "email"], "en", ORDER_EN[step], ORDER_SUBJECT_EN[step]),
    ...builtin(`order.${step}`, ["sms", "whatsapp", "email"], "ta", ORDER_TA[step], ORDER_SUBJECT_TA[step]),
  ]);
}

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
  ...builtin("invoice.issued", ["sms", "whatsapp"], "en", INVOICE_ISSUED_EN, null),
  ...builtin("invoice.issued", ["sms", "whatsapp"], "ta", INVOICE_ISSUED_TA, null),
  ...builtin("invoice.reminder", ["sms", "whatsapp"], "en", INVOICE_REMINDER_EN, null),
  ...builtin("invoice.reminder", ["sms", "whatsapp"], "ta", INVOICE_REMINDER_TA, null),
  ...builtin("payment.received", ["sms", "whatsapp"], "en", PAYMENT_RECEIVED_EN, null),
  ...builtin("payment.received", ["sms", "whatsapp"], "ta", PAYMENT_RECEIVED_TA, null),
  ...orderTemplates(),
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
