import { aiTemplates } from "./ai-templates";
import { customerTemplates } from "./customer-templates";
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

// Quotations (invoices module, docs/quotations.md). Vars — quotation.sent: shop, customer, number, amount, validUntil, link.
const QUOTATION_SENT_EN = "{{shop}}: Dear {{customer}}, your quotation {{number}} for {{amount}} is ready (valid till {{validUntil}}). View and accept: {{link}}";
const QUOTATION_SENT_TA = "{{shop}}: வணக்கம் {{customer}}, உங்கள் மதிப்பீடு {{number}} ({{amount}}) தயாராக உள்ளது ({{validUntil}} வரை செல்லுபடி). பார்க்க / ஏற்க: {{link}}";
const QUOTATION_SENT_SUBJECT_EN = "Quotation {{number}} from {{shop}}";
const QUOTATION_SENT_SUBJECT_TA = "{{shop}} இடமிருந்து மதிப்பீடு {{number}}";

// Proforma invoices, sale orders, delivery challans (invoices module, docs/sales-documents.md). Vars: shop, customer,
// number, amount, link.
const SALES_DOCS = {
  "proforma.sent": {
    en: "{{shop}}: Dear {{customer}}, your proforma invoice {{number}} for {{amount}} is ready. View: {{link}}",
    ta: "{{shop}}: வணக்கம் {{customer}}, உங்கள் முன் விலைப்பட்டியல் (Proforma) {{number}} ({{amount}}) தயாராக உள்ளது. பார்க்க: {{link}}",
    subjectEn: "Proforma invoice {{number}} from {{shop}}",
    subjectTa: "{{shop}} இடமிருந்து முன் விலைப்பட்டியல் {{number}}",
  },
  "sale-order.sent": {
    en: "{{shop}}: Dear {{customer}}, we have your order {{number}} for {{amount}}. View: {{link}}",
    ta: "{{shop}}: வணக்கம் {{customer}}, உங்கள் ஆர்டர் {{number}} ({{amount}}) பதிவானது. பார்க்க: {{link}}",
    subjectEn: "Order {{number}} confirmed by {{shop}}",
    subjectTa: "{{shop}} ஆர்டர் {{number}} உறுதி",
  },
  "challan.sent": {
    en: "{{shop}}: Dear {{customer}}, goods sent on delivery challan {{number}} (value {{amount}}). View: {{link}}",
    ta: "{{shop}}: வணக்கம் {{customer}}, டெலிவரி சலான் {{number}} மூலம் பொருட்கள் அனுப்பப்பட்டன (மதிப்பு {{amount}}). பார்க்க: {{link}}",
    subjectEn: "Delivery challan {{number}} from {{shop}}",
    subjectTa: "{{shop}} இடமிருந்து டெலிவரி சலான் {{number}}",
  },
} as const;

function salesDocTemplates(): TemplateContent[] {
  return Object.entries(SALES_DOCS).flatMap(([key, t]) => [
    ...builtin(key, ["sms", "whatsapp", "email"], "en", t.en, t.subjectEn),
    ...builtin(key, ["sms", "whatsapp", "email"], "ta", t.ta, t.subjectTa),
  ]);
}

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

// Batch 3 modules. English SMS stays within GSM-7 (amounts arrive pre-formatted, e.g. "Rs.1,234.50") and short.
// Vars:
//   marketplace.vendor_approved: vendorName; marketplace.vendor_order: vendorName, orderNumber, amount;
//   marketplace.payout_paid: vendorName, amount, reference
//   marketplace.product_approved: vendorName, productName; marketplace.product_rejected: vendorName, productName, reason
//   marketplace.vendor_order_packed / _shipped (to the shop): vendorName, orderNumber, tracking
//   support.*: shop, number, subject, message, link, status, priority, customer
//     (created/reply go to the customer; new/assigned/customer_reply/overdue go to staff)
//   chat.message: shop, sender, preview, title, link (also push: subject = title)
//   developer.webhook_disabled: url, failures
//   enquiry.received (to owners): shop, number, name, phone, about, link (also push)
type Copy = { body: string; subject: string };
const BATCH3: Record<string, { en: Copy; ta: Copy; push?: { en: string; ta: string } }> = {
  "marketplace.vendor_approved": {
    en: {
      body: "{{app}}: Congratulations {{vendorName}}! Your seller account is approved. You can now list products and receive orders.",
      subject: "Your seller account is approved - {{app}}",
    },
    ta: {
      body: "{{app}}: வாழ்த்துகள் {{vendorName}}! உங்கள் விற்பனையாளர் கணக்கு அங்கீகரிக்கப்பட்டது. இப்போது பொருட்களைப் பட்டியலிட்டு ஆர்டர்களைப் பெறலாம்.",
      subject: "உங்கள் விற்பனையாளர் கணக்கு அங்கீகரிக்கப்பட்டது - {{app}}",
    },
  },
  "marketplace.vendor_order": {
    en: {
      body: "{{app}}: {{vendorName}}, new order {{orderNumber}} for {{amount}}. Please pack and ship it soon.",
      subject: "New order {{orderNumber}} - {{vendorName}}",
    },
    ta: {
      body: "{{app}}: {{vendorName}}, புதிய ஆர்டர் {{orderNumber}} ({{amount}}). விரைவில் பேக் செய்து அனுப்பவும்.",
      subject: "புதிய ஆர்டர் {{orderNumber}} - {{vendorName}}",
    },
  },
  "marketplace.payout_paid": {
    en: {
      body: "{{app}}: {{vendorName}}, your payout of {{amount}} has been sent. Ref: {{reference}}",
      subject: "Payout of {{amount}} sent - {{app}}",
    },
    ta: {
      body: "{{app}}: {{vendorName}}, உங்கள் {{amount}} தொகை அனுப்பப்பட்டது. குறிப்பு எண்: {{reference}}",
      subject: "{{amount}} தொகை அனுப்பப்பட்டது - {{app}}",
    },
  },
  "marketplace.product_approved": {
    en: {
      body: "{{app}}: {{vendorName}}, your product {{productName}} is approved and now live in the store.",
      subject: "{{productName}} is live - {{app}}",
    },
    ta: {
      body: "{{app}}: {{vendorName}}, உங்கள் பொருள் {{productName}} அங்கீகரிக்கப்பட்டு இப்போது கடையில் விற்பனையில் உள்ளது.",
      subject: "{{productName}} விற்பனையில் உள்ளது - {{app}}",
    },
  },
  "marketplace.product_rejected": {
    en: {
      body: "{{app}}: {{vendorName}}, your product {{productName}} needs changes before it can go live: {{reason}}. Edit it and submit again.",
      subject: "Changes needed for {{productName}} - {{app}}",
    },
    ta: {
      body: "{{app}}: {{vendorName}}, உங்கள் பொருள் {{productName}} விற்பனைக்கு வர சில மாற்றங்கள் தேவை: {{reason}}. திருத்தி மீண்டும் சமர்ப்பிக்கவும்.",
      subject: "{{productName}} பொருளில் மாற்றங்கள் தேவை - {{app}}",
    },
  },
  "marketplace.vendor_order_packed": {
    en: {
      body: "{{app}}: Seller {{vendorName}} has packed their items for order {{orderNumber}}.",
      subject: "{{vendorName}} packed order {{orderNumber}}",
    },
    ta: {
      body: "{{app}}: விற்பனையாளர் {{vendorName}} ஆர்டர் {{orderNumber}} பொருட்களைப் பேக் செய்துவிட்டார்.",
      subject: "{{vendorName}} ஆர்டர் {{orderNumber}} பேக் செய்தார்",
    },
  },
  "marketplace.vendor_order_shipped": {
    en: {
      body: "{{app}}: Seller {{vendorName}} has shipped their items for order {{orderNumber}}. Tracking: {{tracking}}",
      subject: "{{vendorName}} shipped order {{orderNumber}}",
    },
    ta: {
      body: "{{app}}: விற்பனையாளர் {{vendorName}} ஆர்டர் {{orderNumber}} பொருட்களை அனுப்பிவிட்டார். கண்காணிப்பு எண்: {{tracking}}",
      subject: "{{vendorName}} ஆர்டர் {{orderNumber}} அனுப்பினார்",
    },
  },
  "support.created": {
    en: {
      body: "{{shop}}: Dear {{customer}}, we received your request {{number}} ({{subject}}). We will reply soon. View: {{link}}",
      subject: "[{{number}}] We received your request - {{shop}}",
    },
    ta: {
      body: "{{shop}}: வணக்கம் {{customer}}, உங்கள் கோரிக்கை {{number}} ({{subject}}) பெறப்பட்டது. விரைவில் பதிலளிப்போம். பார்க்க: {{link}}",
      subject: "[{{number}}] உங்கள் கோரிக்கை பெறப்பட்டது - {{shop}}",
    },
  },
  "support.reply": {
    en: {
      body: "{{shop}}: Dear {{customer}}, we replied to your request {{number}}: {{message}} View and reply: {{link}}",
      subject: "[{{number}}] New reply: {{subject}} - {{shop}}",
    },
    ta: {
      body: "{{shop}}: வணக்கம் {{customer}}, உங்கள் கோரிக்கை {{number}}-க்கு பதில்: {{message}} பார்க்க / பதிலளிக்க: {{link}}",
      subject: "[{{number}}] புதிய பதில்: {{subject}} - {{shop}}",
    },
  },
  "support.new": {
    en: {
      body: "{{shop}}: New ticket {{number}} from {{customer}} ({{priority}}): {{subject}}. Open: {{link}}",
      subject: "[{{number}}] New ticket: {{subject}}",
    },
    ta: {
      body: "{{shop}}: புதிய டிக்கெட் {{number}} — {{customer}} ({{priority}}): {{subject}}. பார்க்க: {{link}}",
      subject: "[{{number}}] புதிய டிக்கெட்: {{subject}}",
    },
  },
  "support.assigned": {
    en: {
      body: "{{shop}}: Ticket {{number}} ({{priority}}) is assigned to you: {{subject}}. Open: {{link}}",
      subject: "[{{number}}] Assigned to you: {{subject}}",
    },
    ta: {
      body: "{{shop}}: டிக்கெட் {{number}} ({{priority}}) உங்களுக்கு ஒதுக்கப்பட்டது: {{subject}}. பார்க்க: {{link}}",
      subject: "[{{number}}] உங்களுக்கு ஒதுக்கப்பட்டது: {{subject}}",
    },
  },
  "support.customer_reply": {
    en: {
      body: "{{shop}}: {{customer}} replied on ticket {{number}}: {{message}} Open: {{link}}",
      subject: "[{{number}}] Customer reply: {{subject}}",
    },
    ta: {
      body: "{{shop}}: டிக்கெட் {{number}}-இல் {{customer}} பதில்: {{message}} பார்க்க: {{link}}",
      subject: "[{{number}}] வாடிக்கையாளர் பதில்: {{subject}}",
    },
  },
  "support.overdue": {
    en: {
      body: "{{shop}}: Ticket {{number}} ({{priority}}, {{status}}) is overdue: {{subject}}. Please respond: {{link}}",
      subject: "[{{number}}] Overdue: {{subject}}",
    },
    ta: {
      body: "{{shop}}: டிக்கெட் {{number}} ({{priority}}, {{status}}) காலக்கெடு கடந்துவிட்டது: {{subject}}. பதிலளிக்கவும்: {{link}}",
      subject: "[{{number}}] காலக்கெடு கடந்தது: {{subject}}",
    },
  },
  "chat.message": {
    en: {
      body: "{{shop}}: New message from {{sender}}: {{preview}} Reply: {{link}}",
      subject: "{{title}}",
    },
    ta: {
      body: "{{shop}}: {{sender}} அனுப்பிய புதிய செய்தி: {{preview}} பதிலளிக்க: {{link}}",
      subject: "{{title}}",
    },
    push: { en: "{{sender}}: {{preview}}", ta: "{{sender}}: {{preview}}" },
  },
  "enquiry.received": {
    en: {
      body: "{{shop}}: New website enquiry {{number}} from {{name}} ({{phone}}){{about}}. Open: {{link}}",
      subject: "New enquiry {{number}} from {{name}}",
    },
    ta: {
      body: "{{shop}}: இணையதளத்தில் புதிய விசாரணை {{number}}: {{name}} ({{phone}}){{about}}. பார்க்க: {{link}}",
      subject: "{{name}} அனுப்பிய புதிய விசாரணை {{number}}",
    },
    push: { en: "{{name}} ({{phone}}){{about}}", ta: "{{name}} ({{phone}}){{about}}" },
  },
  "developer.webhook_disabled": {
    en: {
      body: "{{app}}: Your webhook {{url}} was turned off after {{failures}} failed deliveries in a row. Fix it and turn it back on in Developer settings.",
      subject: "Webhook turned off after {{failures}} failures - {{app}}",
    },
    ta: {
      body: "{{app}}: உங்கள் webhook {{url}} தொடர்ந்து {{failures}} முறை தோல்வியடைந்ததால் நிறுத்தப்பட்டது. சரிசெய்து Developer அமைப்புகளில் மீண்டும் இயக்கவும்.",
      subject: "{{failures}} தோல்விகளுக்குப் பின் webhook நிறுத்தப்பட்டது - {{app}}",
    },
  },
  // Job cards (to the shop's owners / admins): the customer answered the estimate on the tracking page.
  // Vars: shop, number (JC-0007), customer, amount
  "jobcards.estimate_approved": {
    en: {
      body: "{{shop}}: {{customer}} approved the estimate for job {{number}} ({{amount}}) online. You can start the work.",
      subject: "Job {{number}}: estimate approved",
    },
    ta: {
      body: "{{shop}}: {{customer}} வேலை {{number}}-க்கான மதிப்பீட்டை ({{amount}}) இணையத்தில் ஒப்புக்கொண்டார். வேலையைத் தொடங்கலாம்.",
      subject: "வேலை {{number}}: மதிப்பீடு ஒப்புக்கொள்ளப்பட்டது",
    },
    push: { en: "{{number}}: {{customer}} approved {{amount}}", ta: "{{number}}: {{customer}} {{amount}} ஒப்புக்கொண்டார்" },
  },
  "jobcards.estimate_declined": {
    en: {
      body: "{{shop}}: {{customer}} declined the estimate for job {{number}} ({{amount}}) online. Please call them.",
      subject: "Job {{number}}: estimate declined",
    },
    ta: {
      body: "{{shop}}: {{customer}} வேலை {{number}}-க்கான மதிப்பீட்டை ({{amount}}) இணையத்தில் மறுத்தார். அவரை அழைக்கவும்.",
      subject: "வேலை {{number}}: மதிப்பீடு மறுக்கப்பட்டது",
    },
    push: { en: "{{number}}: {{customer}} declined {{amount}}", ta: "{{number}}: {{customer}} {{amount}} மறுத்தார்" },
  },
};

// Batch 5: the platform's plan subscriptions (packages/subscriptions), sent to the shop's owners/admins.
// Vars: shop, plan, interval, amount (GST included, "Rs.1,234.00"), date (trial end / period end / renewal, IST
// YYYY-MM-DD), days, grace (last day of the grace period), number (platform invoice), link (Plan & billing page).
const BATCH5: Record<string, { en: Copy; ta: Copy }> = {
  "subscription.trial_ending": {
    en: {
      body: "{{app}}: {{shop}}, your free trial of {{plan}} ends in {{days}} day(s) on {{date}}. Add UPI Autopay or a card to keep it: {{link}}",
      subject: "Your {{plan}} trial ends in {{days}} day(s) - {{app}}",
    },
    ta: {
      body: "{{app}}: {{shop}}, உங்கள் {{plan}} இலவச சோதனைக் காலம் {{days}} நாளில் ({{date}}) முடிகிறது. தொடர UPI Autopay அல்லது கார்டைச் சேர்க்கவும்: {{link}}",
      subject: "உங்கள் {{plan}} சோதனைக் காலம் {{days}} நாளில் முடிகிறது - {{app}}",
    },
  },
  "subscription.trial_ended": {
    en: {
      body: "{{app}}: {{shop}}, your {{plan}} trial has ended and the shop is now on the Free plan. Your data is safe. Choose a plan to continue: {{link}}",
      subject: "Your {{plan}} trial has ended - {{app}}",
    },
    ta: {
      body: "{{app}}: {{shop}}, உங்கள் {{plan}} சோதனைக் காலம் முடிந்தது; கடை இப்போது Free திட்டத்தில் உள்ளது. உங்கள் தரவு பாதுகாப்பாக உள்ளது. தொடர ஒரு திட்டத்தைத் தேர்ந்தெடுக்கவும்: {{link}}",
      subject: "உங்கள் {{plan}} சோதனைக் காலம் முடிந்தது - {{app}}",
    },
  },
  "subscription.activated": {
    en: {
      body: "{{app}}: {{shop}}, your {{plan}} plan ({{interval}}) is active. {{amount}} will be charged automatically each cycle. Manage: {{link}}",
      subject: "Your {{plan}} plan is active - {{app}}",
    },
    ta: {
      body: "{{app}}: {{shop}}, உங்கள் {{plan}} திட்டம் ({{interval}}) செயல்பாட்டில் உள்ளது. ஒவ்வொரு சுழற்சியிலும் {{amount}} தானாகக் கழிக்கப்படும். நிர்வகிக்க: {{link}}",
      subject: "உங்கள் {{plan}} திட்டம் செயல்பாட்டில் உள்ளது - {{app}}",
    },
  },
  "subscription.charged": {
    en: {
      body: "{{app}}: {{shop}}, we received {{amount}} for {{plan}}. Tax invoice {{number}} is attached. Valid till {{date}}. Invoices: {{link}}",
      subject: "Payment received - invoice {{number}} - {{app}}",
    },
    ta: {
      body: "{{app}}: {{shop}}, {{plan}} திட்டத்திற்கு {{amount}} பெற்றுக்கொண்டோம். வரி விலைப்பட்டியல் {{number}} இணைக்கப்பட்டுள்ளது. {{date}} வரை செல்லுபடியாகும். விலைப்பட்டியல்கள்: {{link}}",
      subject: "பணம் பெறப்பட்டது - விலைப்பட்டியல் {{number}} - {{app}}",
    },
  },
  "subscription.addon_ending": {
    en: {
      body: "{{app}}: {{shop}}, these add-ons end on {{date}} with your plan change: {{addons}}. Plan & billing: {{link}}",
      subject: "Add-ons ending on {{date}} - {{app}}",
    },
    ta: {
      body: "{{app}}: {{shop}}, உங்கள் திட்ட மாற்றத்துடன் இந்த கூடுதல் வசதிகள் {{date}} அன்று முடிவடையும்: {{addons}}. திட்டம் & கட்டணம்: {{link}}",
      subject: "கூடுதல் வசதிகள் {{date}} அன்று முடிவடையும் - {{app}}",
    },
  },
  "subscription.payment_failed": {
    en: {
      body: "{{app}}: {{shop}}, we could not collect {{amount}} for {{plan}}. Please update your payment method by {{grace}} to keep your plan: {{link}}",
      subject: "Payment failed for your {{plan}} plan - {{app}}",
    },
    ta: {
      body: "{{app}}: {{shop}}, {{plan}} திட்டத்திற்கான {{amount}} வசூலிக்க முடியவில்லை. திட்டத்தைத் தொடர {{grace}}-க்குள் கட்டண முறையைப் புதுப்பிக்கவும்: {{link}}",
      subject: "உங்கள் {{plan}} திட்டத்தின் கட்டணம் தோல்வியடைந்தது - {{app}}",
    },
  },
  "subscription.expired": {
    en: {
      body: "{{app}}: {{shop}}, your {{plan}} plan has expired and the shop is now on the Free plan. Your data is safe. Pay to restore it: {{link}}",
      subject: "Your {{plan}} plan has expired - {{app}}",
    },
    ta: {
      body: "{{app}}: {{shop}}, உங்கள் {{plan}} திட்டம் காலாவதியானது; கடை இப்போது Free திட்டத்தில் உள்ளது. உங்கள் தரவு பாதுகாப்பாக உள்ளது. மீண்டும் பெற கட்டணம் செலுத்தவும்: {{link}}",
      subject: "உங்கள் {{plan}} திட்டம் காலாவதியானது - {{app}}",
    },
  },
  "subscription.cancelled": {
    en: {
      body: "{{app}}: {{shop}}, your {{plan}} plan is cancelled and the shop is now on the Free plan. Your data is safe. Restart any time: {{link}}",
      subject: "Your {{plan}} plan is cancelled - {{app}}",
    },
    ta: {
      body: "{{app}}: {{shop}}, உங்கள் {{plan}} திட்டம் ரத்து செய்யப்பட்டது; கடை இப்போது Free திட்டத்தில் உள்ளது. உங்கள் தரவு பாதுகாப்பாக உள்ளது. எப்போது வேண்டுமானாலும் மீண்டும் தொடங்கலாம்: {{link}}",
      subject: "உங்கள் {{plan}} திட்டம் ரத்து செய்யப்பட்டது - {{app}}",
    },
  },
  "subscription.renewal_reminder": {
    en: {
      body: "{{app}}: {{shop}}, your yearly {{plan}} plan renews on {{date}}. {{amount}} will be charged automatically. Manage: {{link}}",
      subject: "Your {{plan}} plan renews on {{date}} - {{app}}",
    },
    ta: {
      body: "{{app}}: {{shop}}, உங்கள் ஆண்டு {{plan}} திட்டம் {{date}} அன்று புதுப்பிக்கப்படும். {{amount}} தானாகக் கழிக்கப்படும். நிர்வகிக்க: {{link}}",
      subject: "உங்கள் {{plan}} திட்டம் {{date}} அன்று புதுப்பிக்கப்படும் - {{app}}",
    },
  },
};

/** Template keys of the batch 5 plan subscription messages. */
export const BATCH5_TEMPLATE_KEYS: readonly string[] = Object.keys(BATCH5);

function batch5Templates(): TemplateContent[] {
  return Object.entries(BATCH5).flatMap(([key, t]) =>
    (["en", "ta"] as const).flatMap((locale) => builtin(key, ["sms", "whatsapp", "email"], locale, t[locale].body, t[locale].subject)),
  );
}

function batch3Templates(): TemplateContent[] {
  return Object.entries(BATCH3).flatMap(([key, t]) =>
    (["en", "ta"] as const).flatMap((locale) => {
      const copy = t[locale];
      const list = builtin(key, ["sms", "whatsapp", "email"], locale, copy.body, copy.subject);
      if (t.push) list.push({ key, channel: "push", locale, subject: copy.subject, body: t.push[locale], providerRef: null });
      return list;
    }),
  );
}

/** Template keys added for the batch 3 modules (marketplace, support, chat, developer). */
export const BATCH3_TEMPLATE_KEYS: readonly string[] = Object.keys(BATCH3);

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
  ...builtin("quotation.sent", ["sms", "whatsapp", "email"], "en", QUOTATION_SENT_EN, QUOTATION_SENT_SUBJECT_EN),
  ...builtin("quotation.sent", ["sms", "whatsapp", "email"], "ta", QUOTATION_SENT_TA, QUOTATION_SENT_SUBJECT_TA),
  ...salesDocTemplates(),
  ...orderTemplates(),
  ...batch3Templates(),
  ...batch5Templates(),
  ...customerTemplates(),
  ...aiTemplates(),
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
