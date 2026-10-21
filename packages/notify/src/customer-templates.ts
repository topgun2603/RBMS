import type { Channel } from "./types";

/**
 * Customer messages of the services engines and the store (bookings, job cards, memberships, abandoned carts), sent
 * through `CustomerMessages` (customer.ts). Written in the style of approved WhatsApp utility templates: the shop name
 * first, one fact per message, a link, no offers. English SMS stays GSM-7 (amounts arrive as "Rs.1,234.50").
 * Shops override any of them per channel and language with `PUT /v1/notify/templates`.
 *
 * Vars (all strings):
 *   booking.confirmed / rescheduled / reminder: shop, customer, number, service, staff, date, time, link (/booking/<token>)
 *   booking.cancelled: shop, customer, number, service, date, time, link (the booking page, to book again)
 *   job.received: shop, customer, number ("JC-0012"), dueDate, link (/job/<token>)
 *   job.approval: shop, customer, number, amount (estimate), link
 *   job.ready: shop, customer, number, amount (balance due), link
 *   job.delivered: shop, customer, number, link
 *   membership.welcome: shop, customer, plan, code, startDate, endDate
 *   membership.renewed: shop, customer, plan, code, endDate
 *   membership.renewal_due: shop, customer, plan, code, endDate, days
 *   membership.expired: shop, customer, plan, code, endDate
 *   cart.abandoned: shop, customer, count, link (the store's /cart)
 *   review.request: shop, customer, number (order), link (the product's review form, or the order page)
 */
type Copy = { body: string; subject: string };

export const CUSTOMER_TEMPLATES: Record<string, { en: Copy; ta: Copy }> = {
  "booking.confirmed": {
    en: {
      body: "{{shop}}: Dear {{customer}}, your booking #{{number}} for {{service}} with {{staff}} on {{date}} at {{time}} is confirmed. View or cancel: {{link}}",
      subject: "Booking confirmed: {{date}} at {{time}} - {{shop}}",
    },
    ta: {
      body: "{{shop}}: வணக்கம் {{customer}}, {{date}} அன்று {{time}} மணிக்கு {{staff}} உடன் உங்கள் {{service}} முன்பதிவு (#{{number}}) உறுதிசெய்யப்பட்டது. பார்க்க / ரத்து செய்ய: {{link}}",
      subject: "முன்பதிவு உறுதிசெய்யப்பட்டது: {{date}} {{time}} - {{shop}}",
    },
  },
  "booking.rescheduled": {
    en: {
      body: "{{shop}}: Dear {{customer}}, your booking #{{number}} for {{service}} is moved to {{date}} at {{time}} with {{staff}}. View or cancel: {{link}}",
      subject: "Booking moved to {{date}} at {{time}} - {{shop}}",
    },
    ta: {
      body: "{{shop}}: வணக்கம் {{customer}}, உங்கள் {{service}} முன்பதிவு (#{{number}}) {{date}} அன்று {{time}} மணிக்கு {{staff}} உடன் மாற்றப்பட்டது. பார்க்க / ரத்து செய்ய: {{link}}",
      subject: "முன்பதிவு மாற்றப்பட்டது: {{date}} {{time}} - {{shop}}",
    },
  },
  "booking.cancelled": {
    en: {
      body: "{{shop}}: Dear {{customer}}, your booking #{{number}} for {{service}} on {{date}} at {{time}} is cancelled. To book again: {{link}}",
      subject: "Booking cancelled - {{shop}}",
    },
    ta: {
      body: "{{shop}}: வணக்கம் {{customer}}, {{date}} அன்று {{time}} மணிக்கான உங்கள் {{service}} முன்பதிவு (#{{number}}) ரத்து செய்யப்பட்டது. மீண்டும் முன்பதிவு செய்ய: {{link}}",
      subject: "முன்பதிவு ரத்து செய்யப்பட்டது - {{shop}}",
    },
  },
  "booking.reminder": {
    en: {
      body: "{{shop}}: Reminder for {{customer}}: your {{service}} appointment with {{staff}} is on {{date}} at {{time}}. View or cancel: {{link}}",
      subject: "Reminder: {{service}} on {{date}} at {{time}} - {{shop}}",
    },
    ta: {
      body: "{{shop}}: நினைவூட்டல் - வணக்கம் {{customer}}, {{staff}} உடன் உங்கள் {{service}} சந்திப்பு {{date}} அன்று {{time}} மணிக்கு. பார்க்க / ரத்து செய்ய: {{link}}",
      subject: "நினைவூட்டல்: {{date}} {{time}} - {{shop}}",
    },
  },
  "job.received": {
    en: {
      body: "{{shop}}: Dear {{customer}}, we received your job {{number}}. Expected ready by {{dueDate}}. Track it: {{link}}",
      subject: "Job {{number}} received - {{shop}}",
    },
    ta: {
      body: "{{shop}}: வணக்கம் {{customer}}, உங்கள் வேலை {{number}} பெறப்பட்டது. தயாராகும் நாள்: {{dueDate}}. நிலையைப் பார்க்க: {{link}}",
      subject: "வேலை {{number}} பெறப்பட்டது - {{shop}}",
    },
  },
  "job.approval": {
    en: {
      body: "{{shop}}: Dear {{customer}}, the estimate for job {{number}} is {{amount}}. Please reply or call us to approve. Details: {{link}}",
      subject: "Approval needed for job {{number}} - {{shop}}",
    },
    ta: {
      body: "{{shop}}: வணக்கம் {{customer}}, வேலை {{number}}-க்கான மதிப்பீடு {{amount}}. ஒப்புதல் அளிக்க பதில் அனுப்பவும் அல்லது எங்களை அழைக்கவும். விவரம்: {{link}}",
      subject: "வேலை {{number}}-க்கு உங்கள் ஒப்புதல் தேவை - {{shop}}",
    },
  },
  "job.ready": {
    en: {
      body: "{{shop}}: Dear {{customer}}, your job {{number}} is ready for pickup. Amount due: {{amount}}. Details: {{link}}",
      subject: "Job {{number}} is ready - {{shop}}",
    },
    ta: {
      body: "{{shop}}: வணக்கம் {{customer}}, உங்கள் வேலை {{number}} தயாராக உள்ளது; வந்து பெற்றுக்கொள்ளலாம். செலுத்த வேண்டிய தொகை: {{amount}}. விவரம்: {{link}}",
      subject: "வேலை {{number}} தயாராக உள்ளது - {{shop}}",
    },
  },
  "job.delivered": {
    en: {
      body: "{{shop}}: Dear {{customer}}, job {{number}} has been delivered. Thank you! Details: {{link}}",
      subject: "Job {{number}} delivered - {{shop}}",
    },
    ta: {
      body: "{{shop}}: வணக்கம் {{customer}}, வேலை {{number}} ஒப்படைக்கப்பட்டது. நன்றி! விவரம்: {{link}}",
      subject: "வேலை {{number}} ஒப்படைக்கப்பட்டது - {{shop}}",
    },
  },
  "membership.welcome": {
    en: {
      body: "{{shop}}: Welcome {{customer}}! Your {{plan}} membership (ID {{code}}) is active from {{startDate}} till {{endDate}}.",
      subject: "Welcome to {{shop}}: {{plan}} is active",
    },
    ta: {
      body: "{{shop}}: வரவேற்கிறோம் {{customer}}! உங்கள் {{plan}} உறுப்பினர் திட்டம் (எண் {{code}}) {{startDate}} முதல் {{endDate}} வரை செயல்பாட்டில் உள்ளது.",
      subject: "{{shop}}-க்கு வரவேற்கிறோம்: {{plan}} செயல்பாட்டில் உள்ளது",
    },
  },
  "membership.renewed": {
    en: {
      body: "{{shop}}: Thank you {{customer}}! Your {{plan}} membership (ID {{code}}) is renewed till {{endDate}}.",
      subject: "{{plan}} renewed till {{endDate}} - {{shop}}",
    },
    ta: {
      body: "{{shop}}: நன்றி {{customer}}! உங்கள் {{plan}} உறுப்பினர் திட்டம் (எண் {{code}}) {{endDate}} வரை புதுப்பிக்கப்பட்டது.",
      subject: "{{plan}} {{endDate}} வரை புதுப்பிக்கப்பட்டது - {{shop}}",
    },
  },
  "membership.renewal_due": {
    en: {
      body: "{{shop}}: Dear {{customer}}, your {{plan}} membership (ID {{code}}) ends on {{endDate}} ({{days}} day(s) left). Renew at the front desk to continue.",
      subject: "Your {{plan}} ends on {{endDate}} - {{shop}}",
    },
    ta: {
      body: "{{shop}}: வணக்கம் {{customer}}, உங்கள் {{plan}} உறுப்பினர் திட்டம் (எண் {{code}}) {{endDate}} அன்று முடிகிறது ({{days}} நாள் உள்ளது). தொடர வரவேற்பில் புதுப்பிக்கவும்.",
      subject: "உங்கள் {{plan}} {{endDate}} அன்று முடிகிறது - {{shop}}",
    },
  },
  "membership.expired": {
    en: {
      body: "{{shop}}: Dear {{customer}}, your {{plan}} membership (ID {{code}}) ended on {{endDate}}. Renew at the front desk to continue.",
      subject: "Your {{plan}} has ended - {{shop}}",
    },
    ta: {
      body: "{{shop}}: வணக்கம் {{customer}}, உங்கள் {{plan}} உறுப்பினர் திட்டம் (எண் {{code}}) {{endDate}} அன்று முடிந்தது. தொடர வரவேற்பில் புதுப்பிக்கவும்.",
      subject: "உங்கள் {{plan}} முடிந்தது - {{shop}}",
    },
  },
  "cart.abandoned": {
    en: {
      body: "{{shop}}: Hi {{customer}}, you left {{count}} item(s) in your cart. It is saved for you: {{link}}",
      subject: "Your cart is saved - {{shop}}",
    },
    ta: {
      body: "{{shop}}: வணக்கம் {{customer}}, உங்கள் கூடையில் {{count}} பொருள்(கள்) உள்ளன. அது உங்களுக்காகச் சேமிக்கப்பட்டுள்ளது: {{link}}",
      subject: "உங்கள் கூடை சேமிக்கப்பட்டுள்ளது - {{shop}}",
    },
  },
  "review.request": {
    en: {
      body: "{{shop}}: Hi {{customer}}, thank you for your order {{number}}. How did you like it? Please share a short review: {{link}}",
      subject: "How was your order {{number}}? - {{shop}}",
    },
    ta: {
      body: "{{shop}}: வணக்கம் {{customer}}, உங்கள் ஆர்டர் {{number}}-க்கு நன்றி. பொருள் எப்படி இருந்தது? ஒரு சிறு விமர்சனம் எழுதுங்கள்: {{link}}",
      subject: "உங்கள் ஆர்டர் {{number}} எப்படி இருந்தது? - {{shop}}",
    },
  },
};

/** Template keys of the customer messages above. */
export const CUSTOMER_TEMPLATE_KEYS: readonly string[] = Object.keys(CUSTOMER_TEMPLATES);

/** Built-in rows (sms, whatsapp, email × en, ta); email carries the subject. */
export function customerTemplates(): { key: string; channel: Channel; locale: string; subject: string | null; body: string; providerRef: null }[] {
  return Object.entries(CUSTOMER_TEMPLATES).flatMap(([key, t]) =>
    (["en", "ta"] as const).flatMap((locale) =>
      (["sms", "whatsapp", "email"] as const).map((channel) => ({
        key,
        channel,
        locale,
        subject: channel === "email" ? t[locale].subject : null,
        body: t[locale].body,
        providerRef: null,
      })),
    ),
  );
}
