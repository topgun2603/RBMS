import { isValidGstin } from "@srirealtime/gst";
import { z } from "zod";
import { AREA, fail, patchSettings, settingsOf } from "../areas";
import { AI_FEATURE_REGISTRY } from "../../features";
import { defineOp, onOff, rupees } from "./util";

const phone = z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, "Use digits, spaces and an optional +");
const social = (host: RegExp) => z.string().trim().max(300).refine((v) => v === "" || (/^https:\/\//i.test(v) && host.test(v)), "Use the full https:// address of that page");

// ------------------------------------------------------------------ online store settings (namespace "store")

export const storeOpen = defineOp({
  kind: "store.set_open",
  group: "store",
  label: { en: "Open or close the online store", ta: "ஆன்லைன் கடையைத் திற / மூடு" },
  changes: { en: "Whether shoppers can order, and the message they see when closed", ta: "வாடிக்கையாளர்கள் ஆர்டர் செய்ய முடியுமா, மூடியிருக்கும்போது காணும் செய்தி" },
  risk: "medium",
  permission: null,
  fullAccess: true,
  features: ["storefront"],
  schema: z.object({ open: z.boolean(), closedMessage: z.string().trim().max(300).optional() }),
  help: "open: true|false; closedMessage? (shown to shoppers when closed, max 300 characters)",
  areas: () => [AREA.settings("store")],
  target: () => "store:open",
  describe: (p) => ({ en: `${p.open ? "Open" : "Close"} the online store${p.closedMessage ? ` with the message "${p.closedMessage}"` : ""}`, ta: `ஆன்லைன் கடையை ${p.open ? "திற" : "மூடு"}${p.closedMessage ? ` ("${p.closedMessage}" செய்தியுடன்)` : ""}` }),
  run(p, st) {
    patchSettings(st, "store", { open: p.open, ...(p.closedMessage !== undefined ? { closedMessage: p.closedMessage } : {}) });
    if (!p.open) return [{ en: "Shoppers will not be able to place orders while the store is closed.", ta: "கடை மூடியிருக்கும்போது வாடிக்கையாளர்கள் ஆர்டர் செய்ய முடியாது." }];
  },
});

export const storePayments = defineOp({
  kind: "store.set_payments",
  group: "store",
  label: { en: "Cash on delivery and minimum order", ta: "கேஷ் ஆன் டெலிவரி, குறைந்தபட்ச ஆர்டர்" },
  changes: { en: "Whether cash on delivery is offered, its limit, and the smallest order value", ta: "கேஷ் ஆன் டெலிவரி வழங்கப்படுகிறதா, அதன் வரம்பு, குறைந்தபட்ச ஆர்டர் மதிப்பு" },
  risk: "high",
  permission: null,
  fullAccess: true,
  features: ["storefront"],
  schema: z
    .object({ codEnabled: z.boolean().optional(), codMaxRupees: z.number().min(0).max(1_000_000).optional(), minOrderRupees: z.number().min(0).max(1_000_000).optional() })
    .refine((v) => Object.values(v).some((x) => x !== undefined), "Give a value"),
  help: "codEnabled?: boolean; codMaxRupees? (0 = no limit); minOrderRupees? (0 = none). Money in rupees",
  areas: () => [AREA.settings("store")],
  target: () => "store:payments",
  describe: (p) => {
    const bits = [p.codEnabled !== undefined && `cash on delivery ${p.codEnabled ? "on" : "off"}`, p.codMaxRupees !== undefined && `COD limit ${p.codMaxRupees ? rupees(p.codMaxRupees * 100) : "none"}`, p.minOrderRupees !== undefined && `minimum order ${p.minOrderRupees ? rupees(p.minOrderRupees * 100) : "none"}`].filter(Boolean);
    return { en: `Store payments: ${bits.join(", ")}`, ta: `கடை கட்டணங்கள்: ${bits.join(", ")}` };
  },
  run(p, st) {
    patchSettings(st, "store", {
      ...(p.codEnabled !== undefined ? { codEnabled: p.codEnabled } : {}),
      ...(p.codMaxRupees !== undefined ? { codMaxAmount: Math.round(p.codMaxRupees * 100) } : {}),
      ...(p.minOrderRupees !== undefined ? { minOrderValue: Math.round(p.minOrderRupees * 100) } : {}),
    });
    if (p.codEnabled === false) return [{ en: "Make sure online payment is set up, or shoppers will have no way to pay.", ta: "ஆன்லைன் கட்டணம் அமைக்கப்பட்டிருப்பதை உறுதிசெய்யுங்கள்; இல்லையெனில் வாடிக்கையாளர்களுக்கு பணம் செலுத்த வழியில்லை." }];
  },
});

export const storeFulfilment = defineOp({
  kind: "store.set_fulfilment",
  group: "store",
  label: { en: "Delivery and pickup", ta: "டெலிவரி, நேரில் எடுத்தல்" },
  changes: { en: "Home delivery on or off, shop pickup on or off and the pickup note", ta: "வீட்டு டெலிவரி, கடையில் எடுத்தல், எடுக்கும் குறிப்பு" },
  risk: "medium",
  permission: null,
  fullAccess: true,
  features: ["storefront"],
  schema: z
    .object({ deliveryEnabled: z.boolean().optional(), pickupEnabled: z.boolean().optional(), pickupNote: z.string().trim().max(300).optional() })
    .refine((v) => Object.values(v).some((x) => x !== undefined), "Give a value"),
  help: "deliveryEnabled?, pickupEnabled?: boolean; pickupNote? (where and when to collect, max 300)",
  areas: () => [AREA.settings("store")],
  target: () => "store:fulfilment",
  describe: (p) => {
    const bits = [p.deliveryEnabled !== undefined && `home delivery ${p.deliveryEnabled ? "on" : "off"}`, p.pickupEnabled !== undefined && `pickup ${p.pickupEnabled ? "on" : "off"}`, p.pickupNote !== undefined && "pickup note"].filter(Boolean);
    return { en: `Fulfilment: ${bits.join(", ")}`, ta: `டெலிவரி/எடுத்தல்: ${bits.join(", ")}` };
  },
  run(p, st) {
    const cur = settingsOf(st, "store");
    const delivery = p.deliveryEnabled ?? (cur.deliveryEnabled !== false);
    const pickup = p.pickupEnabled ?? cur.pickupEnabled === true;
    if (!delivery && !pickup) fail("no_fulfilment", "Turning off both delivery and pickup would leave shoppers unable to receive orders. Keep one on.", "டெலிவரி, எடுத்தல் இரண்டையும் நிறுத்தினால் ஆர்டரைப் பெற வழி இருக்காது. ஒன்றை இயக்கத்தில் வையுங்கள்.");
    patchSettings(st, "store", { ...(p.deliveryEnabled !== undefined ? { deliveryEnabled: p.deliveryEnabled } : {}), ...(p.pickupEnabled !== undefined ? { pickupEnabled: p.pickupEnabled } : {}), ...(p.pickupNote !== undefined ? { pickupNote: p.pickupNote } : {}) });
  },
});

export const storeContact = defineOp({
  kind: "store.set_contact",
  group: "store",
  label: { en: "Contact details and WhatsApp button", ta: "தொடர்பு விவரங்கள், WhatsApp பொத்தான்" },
  changes: { en: "Phone, e-mail and social links on the store; a WhatsApp number shows a WhatsApp chat button on every page", ta: "கடையில் தொலைபேசி, மின்னஞ்சல், சமூக இணைப்புகள்; WhatsApp எண் இருந்தால் எல்லாப் பக்கங்களிலும் WhatsApp அரட்டை பொத்தான் தெரியும்" },
  risk: "medium",
  permission: null,
  fullAccess: true,
  features: ["storefront"],
  schema: z
    .object({
      contactPhone: phone.optional(),
      contactEmail: z.string().trim().email().optional(),
      whatsapp: phone.optional(),
      instagram: social(/instagram\.com\//i).optional(),
      facebook: social(/(facebook|fb)\.com\//i).optional(),
      youtube: social(/(youtube\.com|youtu\.be)\//i).optional(),
    })
    .refine((v) => Object.values(v).some((x) => x !== undefined), "Give a value"),
  help: "contactPhone?, contactEmail?, whatsapp? (a phone number: shows the floating WhatsApp button on every store page), instagram?, facebook?, youtube? (full https:// page address)",
  areas: () => [AREA.settings("store")],
  target: () => "store:contact",
  describe: (p) => ({ en: `Store contact: ${Object.keys(p).filter((k) => (p as Record<string, unknown>)[k] !== undefined).join(", ")}`, ta: `கடை தொடர்பு: ${Object.keys(p).filter((k) => (p as Record<string, unknown>)[k] !== undefined).join(", ")}` }),
  run(p, st) {
    const cur = settingsOf(st, "store");
    const next: Record<string, unknown> = {};
    if (p.contactPhone !== undefined) next.contactPhone = p.contactPhone;
    if (p.contactEmail !== undefined) next.contactEmail = p.contactEmail;
    if (p.whatsapp !== undefined || p.instagram !== undefined || p.facebook !== undefined || p.youtube !== undefined) {
      next.social = {
        ...((cur.social as Record<string, unknown>) ?? {}),
        ...(p.whatsapp !== undefined ? { whatsapp: p.whatsapp } : {}),
        ...(p.instagram !== undefined ? { instagram: p.instagram } : {}),
        ...(p.facebook !== undefined ? { facebook: p.facebook } : {}),
        ...(p.youtube !== undefined ? { youtube: p.youtube } : {}),
      };
    }
    patchSettings(st, "store", next);
  },
});

export const storePolicies = defineOp({
  kind: "store.set_policies",
  group: "store",
  label: { en: "Store policy pages", ta: "கடைக் கொள்கைப் பக்கங்கள்" },
  changes: { en: "The shipping, returns, privacy and terms text shoppers read", ta: "வாடிக்கையாளர்கள் படிக்கும் ஷிப்பிங், திருப்பி அளிப்பு, தனியுரிமை, விதிமுறை உரைகள்" },
  risk: "medium",
  permission: null,
  fullAccess: true,
  features: ["storefront"],
  schema: z
    .object({ shipping: z.string().trim().max(20_000).optional(), returns: z.string().trim().max(20_000).optional(), privacy: z.string().trim().max(20_000).optional(), terms: z.string().trim().max(20_000).optional() })
    .refine((v) => Object.values(v).some((x) => x !== undefined), "Give a policy text"),
  help: "shipping?, returns?, privacy?, terms?: the full policy text (Markdown) exactly as the owner stated it. Never invent promises (free delivery, return days) the owner did not state",
  areas: () => [AREA.settings("store")],
  target: () => "store:policies",
  describe: (p) => ({ en: `Policy text: ${Object.keys(p).filter((k) => (p as Record<string, unknown>)[k] !== undefined).join(", ")}`, ta: `கொள்கை உரை: ${Object.keys(p).filter((k) => (p as Record<string, unknown>)[k] !== undefined).join(", ")}` }),
  run(p, st) {
    const cur = settingsOf(st, "store");
    patchSettings(st, "store", { policies: { ...((cur.policies as Record<string, unknown>) ?? {}), ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) } });
  },
});

export const storeTrust = defineOp({
  kind: "store.set_trust",
  group: "store",
  label: { en: "Trust badges and install banner", ta: "நம்பிக்கை பேட்ஜ்கள், செயலி நிறுவல் பேனர்" },
  changes: { en: "Which returns and payment badges the store shows, and the 'install our app' banner", ta: "கடையில் காட்டப்படும் திருப்பி அளிப்பு/கட்டண பேட்ஜ்கள், 'செயலியை நிறுவு' பேனர்" },
  risk: "medium",
  permission: null,
  fullAccess: true,
  features: ["storefront"],
  schema: z
    .object({ returns: z.enum(["auto", "easy", "replace", "exchange", "none"]).optional(), payment: z.enum(["auto", "online", "confirm", "visit"]).optional(), installBanner: z.boolean().optional() })
    .refine((v) => Object.values(v).some((x) => x !== undefined), "Give a value"),
  help: "returns?: auto|easy|replace|exchange|none (badge claim: only choose easy/replace/exchange if the owner said so); payment?: auto|online|confirm|visit; installBanner?: boolean",
  areas: () => [AREA.settings("store")],
  target: () => "store:trust",
  describe: (p) => ({ en: `Trust badges: ${Object.entries(p).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} ${v}`).join(", ")}`, ta: `நம்பிக்கை பேட்ஜ்கள்: ${Object.entries(p).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} ${v}`).join(", ")}` }),
  run(p, st) {
    const cur = settingsOf(st, "store");
    const next: Record<string, unknown> = {};
    if (p.installBanner !== undefined) next.installBanner = p.installBanner;
    if (p.returns !== undefined || p.payment !== undefined) next.trust = { returns: "auto", payment: "auto", badges: [], ...((cur.trust as Record<string, unknown>) ?? {}), ...(p.returns !== undefined ? { returns: p.returns } : {}), ...(p.payment !== undefined ? { payment: p.payment } : {}) };
    patchSettings(st, "store", next);
  },
});

// ------------------------------------------------------------------ bills, receipts, quotations

export const billIdentity = defineOp({
  kind: "bill.set_identity",
  group: "bills",
  label: { en: "Business name, GSTIN and address on bills", ta: "பில்லில் உள்ள வணிகப் பெயர், GSTIN, முகவரி" },
  changes: { en: "The seller details printed on every new bill", ta: "ஒவ்வொரு புதிய பில்லிலும் அச்சாகும் விற்பனையாளர் விவரங்கள்" },
  risk: "high",
  permission: null,
  fullAccess: true,
  features: ["invoices"],
  schema: z
    .object({
      legalName: z.string().trim().min(1).max(120).optional(),
      gstin: z.string().trim().toUpperCase().refine((v) => v === "" || isValidGstin(v), "Not a valid GSTIN").optional(),
      address: z.string().trim().max(300).optional(),
      city: z.string().trim().max(80).optional(),
      pincode: z.string().trim().regex(/^$|^[1-9][0-9]{5}$/, "Invalid PIN code").optional(),
      stateCode: z.string().trim().regex(/^$|^[0-9]{2}$/, "Invalid state code").optional(),
      phone: z.string().trim().max(20).optional(),
      email: z.string().trim().email().or(z.literal("")).optional(),
    })
    .refine((v) => Object.values(v).some((x) => x !== undefined), "Give a value"),
  help: "legalName?, gstin? (15 characters, checksum verified), address?, city?, pincode? (6 digits), stateCode? (2 digits), phone?, email?",
  areas: () => [AREA.settings("billing")],
  target: () => "bill:identity",
  describe: (p) => ({ en: `Bill seller details: ${Object.keys(p).filter((k) => (p as Record<string, unknown>)[k] !== undefined).join(", ")}`, ta: `பில் விற்பனையாளர் விவரம்: ${Object.keys(p).filter((k) => (p as Record<string, unknown>)[k] !== undefined).join(", ")}` }),
  run(p, st) {
    patchSettings(st, "billing", Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
    return [{ en: "New bills use these details; bills already issued are not changed.", ta: "புதிய பில்கள் இந்த விவரங்களைப் பயன்படுத்தும்; ஏற்கனவே வழங்கிய பில்கள் மாறாது." }];
  },
});

export const billTerms = defineOp({
  kind: "bill.set_terms",
  group: "bills",
  label: { en: "Terms printed on bills", ta: "பில்லில் அச்சாகும் விதிமுறைகள்" },
  changes: { en: "The terms and conditions text at the bottom of bills", ta: "பில்லின் கீழே உள்ள விதிமுறைகள்" },
  risk: "medium",
  permission: null,
  fullAccess: true,
  features: ["invoices"],
  schema: z.object({ terms: z.string().trim().max(1000) }),
  help: "terms: the text as the owner wants it (max 1000). Do not invent terms the owner did not state",
  areas: () => [AREA.settings("billing")],
  target: () => "bill:terms",
  describe: (p) => ({ en: `Bill terms: "${p.terms.slice(0, 80)}"`, ta: `பில் விதிமுறைகள்: "${p.terms.slice(0, 80)}"` }),
  run(p, st) {
    patchSettings(st, "billing", { terms: p.terms });
  },
});

export const billPayment = defineOp({
  kind: "bill.set_payment_details",
  group: "bills",
  label: { en: "Bank name, IFSC and UPI id on bills", ta: "பில்லில் உள்ள வங்கி, UPI விவரங்கள்" },
  changes: { en: "Where customers are told to pay: bank name, IFSC and UPI id", ta: "வாடிக்கையாளர்கள் எங்கே பணம் செலுத்த வேண்டும்: வங்கிக் கணக்கு, IFSC, UPI ஐடி" },
  risk: "high",
  permission: null,
  fullAccess: true,
  features: ["invoices"],
  schema: z
    .object({
      bankName: z.string().trim().max(80).optional(),
      ifsc: z.string().trim().toUpperCase().regex(/^$|^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC").optional(),
      upiId: z.string().trim().regex(/^$|^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/, "Invalid UPI ID").optional(),
    })
    .refine((v) => Object.values(v).some((x) => x !== undefined), "Give a value"),
  help: "bankName?, ifsc?, upiId? (name@bank). Only values the owner typed in the request. Account numbers are never set from here",
  areas: () => [AREA.settings("billing")],
  target: () => "bill:payment",
  describe: (p) => ({ en: `Payment details on bills: ${Object.keys(p).filter((k) => (p as Record<string, unknown>)[k] !== undefined).join(", ")}`, ta: `பில் கட்டண விவரங்கள்: ${Object.keys(p).filter((k) => (p as Record<string, unknown>)[k] !== undefined).join(", ")}` }),
  run(p, st) {
    patchSettings(st, "billing", Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
    return [{ en: "Customers will be asked to pay to these details. Check them carefully.", ta: "வாடிக்கையாளர்கள் இந்த விவரங்களுக்குப் பணம் செலுத்த வேண்டும். கவனமாகச் சரிபாருங்கள்." }];
  },
});

export const billNumbering = defineOp({
  kind: "bill.set_prefix",
  group: "bills",
  label: { en: "Bill number prefix", ta: "பில் எண் முன்னொட்டு" },
  changes: { en: "The letters at the start of new bill numbers", ta: "புதிய பில் எண்களின் தொடக்க எழுத்துகள்" },
  risk: "high",
  permission: null,
  fullAccess: true,
  features: ["invoices"],
  schema: z.object({ invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,6}$/, "1-6 capital letters, digits or hyphens") }),
  help: "invoicePrefix: 1-6 capital letters, digits or hyphens",
  areas: () => [AREA.settings("billing")],
  target: () => "bill:prefix",
  describe: (p) => ({ en: `New bills start with "${p.invoicePrefix}"`, ta: `புதிய பில்கள் "${p.invoicePrefix}" என்று தொடங்கும்` }),
  run(p, st) {
    patchSettings(st, "billing", { invoicePrefix: p.invoicePrefix });
    return [{ en: "Changing the prefix mid-year can confuse your GST records. Do it at the start of a financial year.", ta: "ஆண்டின் நடுவில் முன்னொட்டை மாற்றினால் GST பதிவுகள் குழம்பலாம். நிதியாண்டின் தொடக்கத்தில் செய்யுங்கள்." }];
  },
});

export const billReminders = defineOp({
  kind: "bill.set_reminders",
  group: "bills",
  label: { en: "Payment reminders and receipts", ta: "கட்டண நினைவூட்டல்கள், ரசீதுகள்" },
  changes: { en: "WhatsApp reminders for overdue bills and thank-you receipts", ta: "நிலுவை பில்களுக்கான WhatsApp நினைவூட்டல்கள், நன்றி ரசீதுகள்" },
  risk: "medium",
  permission: null,
  fullAccess: true,
  features: ["invoices"],
  schema: z
    .object({ autoReminders: z.boolean().optional(), reminderDays: z.array(z.number().int().min(0).max(365)).max(6).optional(), sendPaymentReceipts: z.boolean().optional() })
    .refine((v) => Object.values(v).some((x) => x !== undefined), "Give a value"),
  help: "autoReminders?: boolean; reminderDays?: days after the due date (up to 6); sendPaymentReceipts?: boolean",
  areas: () => [AREA.settings("billing")],
  target: () => "bill:reminders",
  describe: (p) => ({ en: `Reminders: ${Object.entries(p).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join("/") : typeof v === "boolean" ? onOff(v).en : v}`).join(", ")}`, ta: `நினைவூட்டல்கள்: ${Object.entries(p).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join("/") : typeof v === "boolean" ? onOff(v).ta : v}`).join(", ")}` }),
  run(p, st) {
    patchSettings(st, "billing", Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
  },
});

const line = z.string().trim().max(64);
export const receiptLayout = defineOp({
  kind: "receipt.set_layout",
  group: "bills",
  label: { en: "Receipt printer layout", ta: "ரசீது அச்சுப் பொறி அமைப்பு" },
  changes: { en: "Header and footer lines, logo, QR, paper width and drawer on thermal receipts", ta: "தெர்மல் ரசீதின் மேல்/கீழ் வரிகள், லோகோ, QR, காகித அகலம், டிராயர்" },
  risk: "low",
  permission: null,
  fullAccess: true,
  features: ["invoices"],
  schema: z
    .object({
      paperWidth: z.union([z.literal(58), z.literal(80)]).optional(),
      headerLines: z.array(line).max(6).optional(),
      footerLines: z.array(line).max(6).optional(),
      showLogo: z.boolean().optional(),
      showQr: z.boolean().optional(),
      autoPrint: z.boolean().optional(),
      openDrawerOnCash: z.boolean().optional(),
      cut: z.enum(["partial", "full", "none"]).optional(),
    })
    .refine((v) => Object.values(v).some((x) => x !== undefined), "Give a value"),
  help: "paperWidth? 58|80; headerLines?/footerLines?: up to 6 lines of 64 characters (to print the GSTIN on the receipt, put it in headerLines); showLogo?, showQr?, autoPrint?, openDrawerOnCash?: boolean; cut?: partial|full|none",
  areas: () => [AREA.settings("printing")],
  target: () => "receipt:layout",
  describe: (p) => ({ en: `Receipt layout: ${Object.keys(p).filter((k) => (p as Record<string, unknown>)[k] !== undefined).join(", ")}`, ta: `ரசீது அமைப்பு: ${Object.keys(p).filter((k) => (p as Record<string, unknown>)[k] !== undefined).join(", ")}` }),
  run(p, st) {
    patchSettings(st, "printing", Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
  },
});

export const quotationDefaults = defineOp({
  kind: "quotation.set_defaults",
  group: "bills",
  label: { en: "Quotation settings", ta: "விலைப்பட்டியல் அமைப்புகள்" },
  changes: { en: "Quotation prefix, validity days, default terms and advance percent", ta: "விலைப்பட்டியல் முன்னொட்டு, செல்லுபடி நாட்கள், இயல்பு விதிமுறைகள், முன்பணம் %" },
  risk: "medium",
  permission: null,
  fullAccess: true,
  features: ["invoices.quotations"],
  schema: z
    .object({
      prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,6}$/, "1-6 capital letters, digits or hyphens").optional(),
      validityDays: z.number().int().min(1).max(365).optional(),
      terms: z.string().trim().max(2000).optional(),
      advancePercent: z.number().int().min(1).max(100).nullable().optional(),
    })
    .refine((v) => Object.values(v).some((x) => x !== undefined), "Give a value"),
  help: "prefix?, validityDays? (1-365), terms? (max 2000), advancePercent? (1-100 or null for none)",
  areas: () => [AREA.settings("quotations")],
  target: () => "quotation:defaults",
  describe: (p) => ({ en: `Quotation settings: ${Object.keys(p).filter((k) => (p as Record<string, unknown>)[k] !== undefined).join(", ")}`, ta: `விலைப்பட்டியல் அமைப்புகள்: ${Object.keys(p).filter((k) => (p as Record<string, unknown>)[k] !== undefined).join(", ")}` }),
  run(p, st) {
    patchSettings(st, "quotations", Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
  },
});

// ------------------------------------------------------------------ AI settings (namespace "ai")

const optInKeys = new Set(AI_FEATURE_REGISTRY.filter((f) => f.optIn).map((f) => f.key));
const helperKeys = AI_FEATURE_REGISTRY.map((f) => f.key);
export const aiHelper = defineOp({
  kind: "ai.set_helper",
  group: "ai",
  label: { en: "Switch an AI helper on or off", ta: "AI உதவியாளரை இயக்கு / நிறுத்து" },
  changes: { en: "Which AI helpers are allowed for the shop", ta: "கடைக்கு அனுமதிக்கப்பட்ட AI உதவியாளர்கள்" },
  risk: "medium",
  permission: "ai.manage",
  fullAccess: false,
  features: ["ai"],
  schema: z.object({ helper: z.string().refine((k) => helperKeys.includes(k), "Unknown AI helper"), allowed: z.boolean() }),
  help: `helper: one of ${helperKeys.join(", ")}; allowed: true|false. Helpers that read health records are never switched on from here`,
  areas: () => [AREA.settings("ai")],
  target: (p) => `ai:helper:${p.helper}`,
  describe: (p) => ({ en: `${p.allowed ? "Allow" : "Stop"} the AI helper "${p.helper}"`, ta: `AI உதவியாளர் "${p.helper}" ஐ ${p.allowed ? "அனுமதி" : "நிறுத்து"}` }),
  run(p, st) {
    if (p.allowed && optInKeys.has(p.helper)) fail("opt_in_only", "This helper handles health records, so it can only be switched on by hand in Settings > AI.", "இந்த உதவியாளர் உடல்நலப் பதிவுகளைக் கையாள்கிறது; அதனால் அமைப்புகள் > AI-இல் கையால் மட்டுமே இயக்க முடியும்.");
    const cur = settingsOf(st, "ai");
    patchSettings(st, "ai", { features: { ...((cur.features as Record<string, boolean>) ?? {}), [p.helper]: p.allowed } });
    if (!p.allowed && p.helper === "studio-assistant") return [{ en: "You will no longer be able to use the Studio assistant until you switch it on again in Settings > AI.", ta: "அமைப்புகள் > AI-இல் மீண்டும் இயக்கும் வரை Studio உதவியாளரை பயன்படுத்த முடியாது." }];
  },
});

export const aiPrivacy = defineOp({
  kind: "ai.set_privacy",
  group: "ai",
  label: { en: "AI privacy options", ta: "AI தனியுரிமை விருப்பங்கள்" },
  changes: { en: "Hide GSTINs from the AI, and keep prompts for debugging", ta: "AI-க்கு GSTIN-ஐ மறை, பிழைதிருத்தத்துக்கு உள்ளீடுகளைச் சேமி" },
  risk: "high",
  permission: "ai.manage",
  fullAccess: false,
  features: ["ai"],
  schema: z.object({ maskGstin: z.boolean().optional(), storePrompts: z.boolean().optional() }).refine((v) => v.maskGstin !== undefined || v.storePrompts !== undefined, "Give a value"),
  help: "maskGstin?: boolean (hide GSTINs before sending text to the AI); storePrompts?: boolean (keep prompts 7 days for debugging)",
  areas: () => [AREA.settings("ai")],
  target: () => "ai:privacy",
  describe: (p) => ({ en: `AI privacy: ${Object.entries(p).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} ${onOff(v as boolean).en}`).join(", ")}`, ta: `AI தனியுரிமை: ${Object.entries(p).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} ${onOff(v as boolean).ta}`).join(", ")}` }),
  run(p, st) {
    patchSettings(st, "ai", Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
  },
});

export const SETTINGS_OPS = [storeOpen, storePayments, storeFulfilment, storeContact, storePolicies, storeTrust, billIdentity, billTerms, billPayment, billNumbering, billReminders, receiptLayout, quotationDefaults, aiHelper, aiPrivacy];
