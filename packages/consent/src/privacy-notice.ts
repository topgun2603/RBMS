import { createHash } from "node:crypto";
import type { NoticeTextRow, StoredNotice } from "./schema";

/** Which parts of the product the shop uses; each one adds what is collected, why and for how long. */
export interface NoticeModules {
  /** Online store: accounts, addresses, orders, carts. */
  storefront: boolean;
  loyalty: boolean;
  memberships: boolean;
  /** Pharmacy: prescriptions and patient details. */
  pharmacy: boolean;
  /** Staff attendance, leave and payroll. */
  payroll: boolean;
  /** AI helpers switched on (text goes to an AI provider outside India). */
  ai: boolean;
  /** WhatsApp / SMS messages to customers. */
  messaging: boolean;
  delivery: boolean;
  /** Bookings, job cards and repairs (customer name, phone and device / appointment details). */
  services: boolean;
}

export interface NoticeContact {
  name: string;
  role: string;
  phone: string;
  email: string;
  address: string;
}

export interface NoticeInput {
  audience: "shop" | "platform";
  shopName: string;
  legalName: string;
  address: string;
  modules: NoticeModules;
  contact: NoticeContact;
  responseDays: number;
  /** Retention category key -> days the shop keeps it (only categories that are on). */
  retentionDays: Record<string, number>;
  /** Years GST / accounting records are kept (8, CGST Act s.36). */
  taxYears: number;
  /** The shop's own extra text, appended as written. */
  extra: string;
}

export const NOTICE_LOCALES = ["en", "ta"] as const;
export type NoticeLocale = (typeof NOTICE_LOCALES)[number];

export const RBMS_NAME = "RBMS (Retail & Business Management Suite)";

/** "3 years", "6 months", "30 days" (and the Tamil forms). */
export function durationText(days: number, locale: NoticeLocale): string {
  const years = days / 365;
  if (days >= 365 && Number.isInteger(years)) return locale === "ta" ? `${years} ஆண்டுகள்` : `${years} ${years === 1 ? "year" : "years"}`;
  const months = days / 30;
  if (days >= 60 && Number.isInteger(months)) return locale === "ta" ? `${months} மாதங்கள்` : `${months} months`;
  return locale === "ta" ? `${days} நாட்கள்` : `${days} ${days === 1 ? "day" : "days"}`;
}

const list = (items: Array<string | false | null | undefined>): string[] => items.filter((s): s is string => !!s);

function contactLine(c: NoticeContact, locale: NoticeLocale): string {
  const bits = list([c.name && (c.role ? `${c.name} (${c.role})` : c.name), c.phone, c.email, c.address]);
  if (bits.length === 0) return locale === "ta" ? "புகார் அலுவலரின் விவரங்கள் இன்னும் சேர்க்கப்படவில்லை." : "The grievance contact has not been filled in yet.";
  return bits.join(" · ");
}

interface Words {
  title: (n: string) => string;
  intro: (i: NoticeInput) => string;
  review: string;
  who: string;
  whoText: (i: NoticeInput) => string[];
  collect: string;
  collectItems: (i: NoticeInput) => string[];
  why: string;
  whyItems: (i: NoticeInput) => string[];
  share: string;
  shareItems: (i: NoticeInput) => string[];
  keep: string;
  keepText: (i: NoticeInput) => string[];
  rights: string;
  rightsText: (i: NoticeInput) => { paragraphs: string[]; items: string[] };
  withdraw: string;
  withdrawText: (i: NoticeInput) => string[];
  children: string;
  childrenText: string[];
  grievance: string;
  grievanceText: (i: NoticeInput) => string[];
  changes: string;
  changesText: string[];
}

const EN: Words = {
  title: (n) => `Privacy notice: ${n}`,
  intro: (i) =>
    i.audience === "platform"
      ? `This notice explains how ${RBMS_NAME} looks after the personal data of shop owners and their staff who use the service, and what ${RBMS_NAME} does for the shops it serves.`
      : `This notice explains what personal data ${i.shopName} collects from you, why, how long we keep it, and the choices you have. We use ${RBMS_NAME} to run our shop.`,
  review:
    "This text was generated from your shop's settings. It is not legal advice: please review it with your lawyer before relying on it.",
  who: "Who is responsible for your data",
  whoText: (i) =>
    i.audience === "platform"
      ? [
          `${RBMS_NAME} is the "data fiduciary" for the account details of shop owners and staff: your name, phone, email, sign-in records and billing details.`,
          `For the customer data a shop enters or collects, the shop is the data fiduciary and ${RBMS_NAME} is the "data processor": it stores and handles that data only on the shop's behalf and on its instructions.`,
        ]
      : list([
          `${i.legalName || i.shopName}${i.address ? `, ${i.address}` : ""} decides why and how your data is used (the "data fiduciary").`,
          `${RBMS_NAME}, the software we use, processes the data on our behalf.`,
        ]),
  collect: "What we collect",
  collectItems: (i) => {
    if (i.audience === "platform") {
      return [
        "Name, phone number, email address and a profile photo if you add one",
        "Sign-in records: time, device, IP address, one-time passwords (kept only briefly)",
        "Shop details, plan and billing history",
        "Messages you send to our support team",
      ];
    }
    const m = i.modules;
    return list([
      "Your name, phone number and email address, when you give them to us",
      "What you buy: bills, orders, payments, returns and the amounts you owe or have paid",
      m.storefront && "Your online account: delivery addresses, cart, wishlist and order history",
      m.delivery && "Delivery address and phone number, shared with the delivery partner for your order",
      m.loyalty && "Loyalty points and the purchases that earned them",
      m.memberships && "Membership details: plan, dates, visits and a photo for the card if you give one",
      m.services && "Booking, repair or job details: what you asked for, the item or vehicle, and appointment times",
      m.pharmacy && "Prescription details (patient name, age, doctor, medicines) and a photo of the prescription: this is health information and is used only to dispense your medicines",
      m.messaging && "Your messages with us on WhatsApp or SMS",
      "Messages you send to our help desk or chat",
    ]);
  },
  why: "Why we use it",
  whyItems: (i) => {
    if (i.audience === "platform") {
      return [
        "To create your account, sign you in securely and run the service",
        "To bill for your plan and keep the records the law requires",
        "To answer your questions and fix problems",
        "To keep the service secure and prevent misuse",
        "To tell you about changes to the service (not marketing, unless you agree)",
      ];
    }
    const m = i.modules;
    return list([
      "To sell to you, make your bill and deliver or repair what you bought",
      "To keep the accounts and tax records that the law requires us to keep",
      "To answer your questions and handle returns or complaints",
      m.loyalty && "To add and use your loyalty points",
      m.memberships && "To run your membership and remind you before it ends",
      m.pharmacy && "To dispense medicines safely and keep the prescription register the pharmacy rules require",
      m.messaging && "To send you updates about your order, bill or booking, and offers only if you have said yes to them",
      m.ai && "To help our staff write replies, descriptions or summaries faster. Details like phone numbers are masked first, and a person always checks the result",
      i.extra && i.extra,
    ]);
  },
  share: "Who else sees it",
  shareItems: (i) => {
    if (i.audience === "platform") {
      return [
        "Cloud hosting and database providers, who store data for us",
        "Message providers (SMS, WhatsApp, email) to deliver codes and notices",
        "Payment providers, when you pay for your plan",
        "Government or courts, when the law requires it",
        "We do not sell your data",
      ];
    }
    const m = i.modules;
    return list([
      `${RBMS_NAME}, which stores our records on secure servers`,
      "Payment providers (UPI, cards, wallets), when you pay online",
      m.delivery && "Courier and delivery partners, only what is needed to deliver your order",
      m.messaging && "WhatsApp / SMS providers, to deliver our messages to you",
      m.ai && "An AI provider whose servers are outside India, only for the helpers we have switched on, with phone numbers and emails masked",
      "Tax and other authorities, when the law requires it (for example GST returns)",
      "We do not sell your data",
    ]);
  },
  keep: "How long we keep it",
  keepText: (i) => {
    const d = i.retentionDays;
    const out: string[] = [
      `Bills, orders and accounting records are kept for ${i.taxYears} years because tax law (CGST Act section 36) requires it, even if you ask us to erase your other data. We remove your details from everything else.`,
    ];
    const rows = list([
      !!d.inactive_store_customers && `Your online account if you stop using it: ${durationText(d.inactive_store_customers, "en")}`,
      !!d.abandoned_carts && `A cart you did not check out: ${durationText(d.abandoned_carts, "en")}`,
      !!d.support_transcripts && `Help desk conversations: ${durationText(d.support_transcripts, "en")} after they are closed`,
      !!d.chat_messages && `Chat messages: ${durationText(d.chat_messages, "en")}`,
      !!d.whatsapp_chats && `WhatsApp conversations: ${durationText(d.whatsapp_chats, "en")}`,
      i.modules.pharmacy && !!d.prescriptions && `Prescription details and photos: ${durationText(d.prescriptions, "en")}`,
      i.modules.memberships && !!d.lapsed_members && `A membership that has ended: ${durationText(d.lapsed_members, "en")}`,
      i.modules.payroll && !!d.staff_after_exit && `Staff personal details after they leave: ${durationText(d.staff_after_exit, "en")}`,
      !!d.kyc_documents && `Identity documents uploaded for verification: ${durationText(d.kyc_documents, "en")}`,
      !!d.otp_logs && `One-time passwords and sign-in records: ${durationText(d.otp_logs, "en")}`,
    ]);
    return rows.length ? [...out, ...rows] : out;
  },
  rights: "Your rights",
  rightsText: (i) => ({
    paragraphs: [
      i.audience === "platform"
        ? "You can ask us at any time to do any of these. Write to the contact below or use Privacy in your account."
        : "You can ask us at any time to do any of these. Use Privacy in your online account, ask at the counter, or write to the contact below.",
      `We will answer within ${i.responseDays} days.`,
    ],
    items: [
      "See what personal data we hold about you and how it is used",
      "Correct or complete data that is wrong",
      "Erase your data. We will, except records the law makes us keep (see above)",
      "Take back a consent you gave, as easily as you gave it",
      "Name someone who can use these rights for you if you die or cannot act for yourself",
      "Complain about how your data is handled",
    ],
  }),
  withdraw: "How to withdraw your consent",
  withdrawText: (i) => [
    i.audience === "platform"
      ? "Open Privacy in your account and switch the consent off, or write to the grievance contact below. Withdrawing does not undo what was done before, and we may not be able to run your account without the data it needs."
      : "Open Privacy in your online account and switch the consent off, tell us at the counter, or write to the contact below. Withdrawing does not undo what was done before. If you withdraw marketing consent we stop sending offers; bills and order updates still go out.",
  ],
  children: "Children",
  childrenText: ["If you are under 18, a parent or guardian must agree before we use your data. We do not track or send offers to children."],
  grievance: "Questions and complaints",
  grievanceText: (i) => [
    `Grievance contact: ${contactLine(i.contact, "en")}`,
    `We will reply within ${i.responseDays} days. If you are not satisfied you may complain to the Data Protection Board of India.`,
  ],
  changes: "Changes to this notice",
  changesText: ["When this notice changes we give it a new version number. The version you accepted is kept with your consent record."],
};

const TA: Words = {
  title: (n) => `தனியுரிமை அறிவிப்பு: ${n}`,
  intro: (i) =>
    i.audience === "platform"
      ? `${RBMS_NAME} சேவையைப் பயன்படுத்தும் கடை உரிமையாளர்கள் மற்றும் பணியாளர்களின் தனிப்பட்ட தரவை எவ்வாறு பாதுகாக்கிறோம், கடைகளுக்காக என்ன செய்கிறோம் என்பதை இந்த அறிவிப்பு விளக்குகிறது.`
      : `${i.shopName} உங்களிடமிருந்து என்ன தனிப்பட்ட தரவைச் சேகரிக்கிறது, ஏன், எவ்வளவு காலம் வைத்திருக்கிறது, உங்களுக்கு உள்ள உரிமைகள் என்ன என்பதை இந்த அறிவிப்பு விளக்குகிறது. எங்கள் கடையை நடத்த ${RBMS_NAME} மென்பொருளைப் பயன்படுத்துகிறோம்.`,
  review: "இந்த உரை உங்கள் கடையின் அமைப்புகளிலிருந்து தானாக உருவாக்கப்பட்டது. இது சட்ட ஆலோசனை அல்ல: பயன்படுத்துவதற்கு முன் உங்கள் வழக்கறிஞருடன் சரிபார்க்கவும்.",
  who: "உங்கள் தரவுக்குப் பொறுப்பானவர் யார்",
  whoText: (i) =>
    i.audience === "platform"
      ? [
          `கடை உரிமையாளர்கள் மற்றும் பணியாளர்களின் கணக்கு விவரங்களுக்கு (பெயர், தொலைபேசி, மின்னஞ்சல், உள்நுழைவு பதிவுகள், கட்டண விவரங்கள்) ${RBMS_NAME} "தரவு பொறுப்பாளர்" (data fiduciary).`,
          `ஒரு கடை உள்ளிடும் அல்லது சேகரிக்கும் வாடிக்கையாளர் தரவுக்கு அந்தக் கடையே தரவு பொறுப்பாளர்; ${RBMS_NAME} "தரவு செயலாக்குநர்" (data processor) ஆக, கடையின் சார்பில் அதன் உத்தரவின்படி மட்டுமே அந்தத் தரவைச் சேமித்துக் கையாளுகிறது.`,
        ]
      : list([
          `${i.legalName || i.shopName}${i.address ? `, ${i.address}` : ""} உங்கள் தரவு ஏன், எப்படிப் பயன்படுத்தப்படுகிறது என்பதைத் தீர்மானிக்கும் "தரவு பொறுப்பாளர்".`,
          `நாங்கள் பயன்படுத்தும் ${RBMS_NAME} மென்பொருள் எங்கள் சார்பில் தரவைச் செயலாக்குகிறது.`,
        ]),
  collect: "நாங்கள் சேகரிப்பவை",
  collectItems: (i) => {
    if (i.audience === "platform") {
      return [
        "பெயர், தொலைபேசி எண், மின்னஞ்சல் முகவரி, நீங்கள் சேர்த்தால் சுயவிவரப் புகைப்படம்",
        "உள்நுழைவு பதிவுகள்: நேரம், சாதனம், IP முகவரி, ஒருமுறை கடவுச்சொற்கள் (சிறிது காலமே வைக்கப்படும்)",
        "கடை விவரங்கள், திட்டம் மற்றும் கட்டண வரலாறு",
        "ஆதரவுக் குழுவுக்கு நீங்கள் அனுப்பும் செய்திகள்",
      ];
    }
    const m = i.modules;
    return list([
      "நீங்கள் தரும்போது உங்கள் பெயர், தொலைபேசி எண், மின்னஞ்சல் முகவரி",
      "நீங்கள் வாங்குவது: பில்கள், ஆர்டர்கள், பணம் செலுத்தல்கள், திரும்பப் பெறல்கள், நீங்கள் செலுத்த வேண்டிய அல்லது செலுத்திய தொகைகள்",
      m.storefront && "உங்கள் ஆன்லைன் கணக்கு: டெலிவரி முகவரிகள், கார்ட், விருப்பப் பட்டியல், ஆர்டர் வரலாறு",
      m.delivery && "டெலிவரி முகவரி மற்றும் தொலைபேசி எண்: உங்கள் ஆர்டரை அனுப்ப டெலிவரி கூட்டாளருடன் பகிரப்படும்",
      m.loyalty && "லாயல்டி புள்ளிகள் மற்றும் அவற்றைப் பெற்றுத்தந்த வாங்குதல்கள்",
      m.memberships && "உறுப்பினர் விவரங்கள்: திட்டம், தேதிகள், வருகைகள், நீங்கள் தந்தால் அட்டைக்கான புகைப்படம்",
      m.services && "முன்பதிவு, பழுது அல்லது வேலை விவரங்கள்: நீங்கள் கேட்டது, பொருள் அல்லது வாகனம், சந்திப்பு நேரங்கள்",
      m.pharmacy && "மருந்துச் சீட்டு விவரங்கள் (நோயாளி பெயர், வயது, மருத்துவர், மருந்துகள்) மற்றும் மருந்துச் சீட்டின் புகைப்படம்: இது உடல்நலத் தகவல்; உங்கள் மருந்துகளை வழங்க மட்டுமே பயன்படுத்தப்படும்",
      m.messaging && "WhatsApp அல்லது SMS மூலம் எங்களுடன் நீங்கள் நடத்தும் உரையாடல்கள்",
      "உதவி மையம் அல்லது அரட்டையில் நீங்கள் அனுப்பும் செய்திகள்",
    ]);
  },
  why: "ஏன் பயன்படுத்துகிறோம்",
  whyItems: (i) => {
    if (i.audience === "platform") {
      return [
        "உங்கள் கணக்கை உருவாக்கி, பாதுகாப்பாக உள்நுழைய வைத்து, சேவையை நடத்த",
        "உங்கள் திட்டத்துக்குக் கட்டணம் விதிக்கவும், சட்டம் கோரும் பதிவுகளை வைக்கவும்",
        "உங்கள் கேள்விகளுக்குப் பதிலளிக்கவும், சிக்கல்களைத் தீர்க்கவும்",
        "சேவையைப் பாதுகாப்பாக வைத்து, தவறான பயன்பாட்டைத் தடுக்க",
        "சேவையில் மாற்றங்கள் குறித்து உங்களுக்குத் தெரிவிக்க (நீங்கள் ஒப்புக்கொள்ளாவிட்டால் விளம்பரம் இல்லை)",
      ];
    }
    const m = i.modules;
    return list([
      "உங்களுக்கு விற்கவும், பில் தயாரிக்கவும், நீங்கள் வாங்கியதை டெலிவரி செய்ய அல்லது பழுது பார்க்க",
      "சட்டம் வைத்திருக்கச் சொல்லும் கணக்கு மற்றும் வரிப் பதிவுகளை வைத்திருக்க",
      "உங்கள் கேள்விகளுக்குப் பதிலளிக்கவும், திரும்பப் பெறல் அல்லது புகார்களைக் கையாளவும்",
      m.loyalty && "உங்கள் லாயல்டி புள்ளிகளைச் சேர்க்கவும் பயன்படுத்தவும்",
      m.memberships && "உங்கள் உறுப்பினர் திட்டத்தை நடத்தவும், முடிவதற்கு முன் நினைவூட்டவும்",
      m.pharmacy && "மருந்துகளைப் பாதுகாப்பாக வழங்கவும், மருந்தக விதிகள் கோரும் மருந்துச் சீட்டுப் பதிவேட்டை வைத்திருக்கவும்",
      m.messaging && "உங்கள் ஆர்டர், பில் அல்லது முன்பதிவு குறித்த தகவல்களை அனுப்ப; நீங்கள் ஒப்புக்கொண்டால் மட்டுமே விளம்பரச் சலுகைகளை அனுப்ப",
      m.ai && "பதில்கள், விளக்கங்கள், சுருக்கங்களை எங்கள் ஊழியர்கள் விரைவாக எழுத உதவ. தொலைபேசி எண் போன்றவை முதலில் மறைக்கப்படும்; முடிவை எப்போதும் ஒருவர் சரிபார்ப்பார்",
      i.extra && i.extra,
    ]);
  },
  share: "வேறு யார் பார்ப்பார்கள்",
  shareItems: (i) => {
    if (i.audience === "platform") {
      return [
        "எங்களுக்காகத் தரவைச் சேமிக்கும் கிளவுட் ஹோஸ்டிங் மற்றும் தரவுத்தள நிறுவனங்கள்",
        "குறியீடுகள் மற்றும் அறிவிப்புகளை அனுப்பும் செய்தி சேவை நிறுவனங்கள் (SMS, WhatsApp, மின்னஞ்சல்)",
        "உங்கள் திட்டத்துக்குப் பணம் செலுத்தும்போது கட்டண நிறுவனங்கள்",
        "சட்டம் கோரும்போது அரசு அல்லது நீதிமன்றங்கள்",
        "உங்கள் தரவை நாங்கள் விற்பதில்லை",
      ];
    }
    const m = i.modules;
    return list([
      `எங்கள் பதிவுகளைப் பாதுகாப்பான சர்வர்களில் சேமிக்கும் ${RBMS_NAME}`,
      "ஆன்லைனில் பணம் செலுத்தும்போது கட்டண நிறுவனங்கள் (UPI, கார்டு, வாலட்)",
      m.delivery && "கூரியர் மற்றும் டெலிவரி கூட்டாளர்கள்: ஆர்டரை அனுப்பத் தேவையானது மட்டும்",
      m.messaging && "எங்கள் செய்திகளை உங்களிடம் சேர்க்கும் WhatsApp / SMS நிறுவனங்கள்",
      m.ai && "இந்தியாவுக்கு வெளியே சர்வர்கள் உள்ள AI சேவை நிறுவனம்: நாங்கள் இயக்கிய உதவிகளுக்கு மட்டும், தொலைபேசி எண் மற்றும் மின்னஞ்சல் மறைக்கப்பட்டு",
      "சட்டம் கோரும்போது வரி மற்றும் பிற அதிகாரிகள் (எ.கா. GST கணக்குகள்)",
      "உங்கள் தரவை நாங்கள் விற்பதில்லை",
    ]);
  },
  keep: "எவ்வளவு காலம் வைத்திருப்போம்",
  keepText: (i) => {
    const d = i.retentionDays;
    const out: string[] = [
      `பில்கள், ஆர்டர்கள் மற்றும் கணக்குப் பதிவுகள் வரிச் சட்டப்படி (CGST சட்டம் பிரிவு 36) ${durationText(i.taxYears * 365, "ta")} வைக்கப்படும்; உங்கள் மற்ற தரவை அழிக்கச் சொன்னாலும் இவை வைக்கப்படும். மற்ற அனைத்திலிருந்தும் உங்கள் விவரங்களை நீக்குவோம்.`,
    ];
    const rows = list([
      !!d.inactive_store_customers && `நீங்கள் பயன்படுத்துவதை நிறுத்தினால் உங்கள் ஆன்லைன் கணக்கு: ${durationText(d.inactive_store_customers, "ta")}`,
      !!d.abandoned_carts && `நீங்கள் முடிக்காத கார்ட்: ${durationText(d.abandoned_carts, "ta")}`,
      !!d.support_transcripts && `உதவி மைய உரையாடல்கள்: முடிந்த பின் ${durationText(d.support_transcripts, "ta")}`,
      !!d.chat_messages && `அரட்டைச் செய்திகள்: ${durationText(d.chat_messages, "ta")}`,
      !!d.whatsapp_chats && `WhatsApp உரையாடல்கள்: ${durationText(d.whatsapp_chats, "ta")}`,
      i.modules.pharmacy && !!d.prescriptions && `மருந்துச் சீட்டு விவரங்கள் மற்றும் புகைப்படங்கள்: ${durationText(d.prescriptions, "ta")}`,
      i.modules.memberships && !!d.lapsed_members && `முடிந்த உறுப்பினர் திட்டம்: ${durationText(d.lapsed_members, "ta")}`,
      i.modules.payroll && !!d.staff_after_exit && `பணியாளர் விலகிய பின் அவர்களின் தனிப்பட்ட விவரங்கள்: ${durationText(d.staff_after_exit, "ta")}`,
      !!d.kyc_documents && `சரிபார்ப்புக்காகப் பதிவேற்றிய அடையாள ஆவணங்கள்: ${durationText(d.kyc_documents, "ta")}`,
      !!d.otp_logs && `ஒருமுறை கடவுச்சொற்கள் மற்றும் உள்நுழைவு பதிவுகள்: ${durationText(d.otp_logs, "ta")}`,
    ]);
    return rows.length ? [...out, ...rows] : out;
  },
  rights: "உங்கள் உரிமைகள்",
  rightsText: (i) => ({
    paragraphs: [
      i.audience === "platform"
        ? "இவற்றில் எதையும் எப்போது வேண்டுமானாலும் கேட்கலாம். கீழே உள்ள தொடர்பு நபருக்கு எழுதுங்கள் அல்லது உங்கள் கணக்கில் தனியுரிமைப் பகுதியைப் பயன்படுத்துங்கள்."
        : "இவற்றில் எதையும் எப்போது வேண்டுமானாலும் கேட்கலாம். உங்கள் ஆன்லைன் கணக்கில் தனியுரிமைப் பகுதியைப் பயன்படுத்துங்கள், கடையில் கேளுங்கள், அல்லது கீழே உள்ள தொடர்பு நபருக்கு எழுதுங்கள்.",
      `${i.responseDays} நாட்களுக்குள் பதிலளிப்போம்.`,
    ],
    items: [
      "உங்களைப் பற்றி நாங்கள் வைத்துள்ள தனிப்பட்ட தரவையும் அது எவ்வாறு பயன்படுத்தப்படுகிறது என்பதையும் பார்க்க",
      "தவறான அல்லது முழுமையற்ற தரவைத் திருத்த",
      "உங்கள் தரவை அழிக்க. சட்டப்படி நாங்கள் வைத்திருக்க வேண்டிய பதிவுகளைத் தவிர (மேலே பார்க்க) அழிப்போம்",
      "நீங்கள் தந்த ஒப்புதலை, தந்தது போலவே எளிதாகத் திரும்பப் பெற",
      "நீங்கள் இறந்தால் அல்லது செயல்பட இயலாதபோது இந்த உரிமைகளைப் பயன்படுத்தக்கூடிய ஒருவரைப் பரிந்துரைக்க",
      "உங்கள் தரவு கையாளப்படும் விதம் குறித்துப் புகார் செய்ய",
    ],
  }),
  withdraw: "ஒப்புதலைத் திரும்பப் பெறுவது எப்படி",
  withdrawText: (i) => [
    i.audience === "platform"
      ? "உங்கள் கணக்கில் தனியுரிமைப் பகுதியைத் திறந்து ஒப்புதலை அணைக்கவும், அல்லது கீழே உள்ள புகார் தொடர்பு நபருக்கு எழுதவும். திரும்பப் பெறுவது முன்பு செய்தவற்றை மாற்றாது; கணக்குக்குத் தேவையான தரவு இல்லாமல் அதை இயக்க முடியாமல் போகலாம்."
      : "உங்கள் ஆன்லைன் கணக்கில் தனியுரிமைப் பகுதியைத் திறந்து ஒப்புதலை அணைக்கவும், கடையில் சொல்லவும், அல்லது கீழே உள்ள தொடர்பு நபருக்கு எழுதவும். திரும்பப் பெறுவது முன்பு செய்தவற்றை மாற்றாது. விளம்பர ஒப்புதலைத் திரும்பப் பெற்றால் சலுகைகள் நிறுத்தப்படும்; பில் மற்றும் ஆர்டர் தகவல்கள் தொடர்ந்து வரும்.",
  ],
  children: "குழந்தைகள்",
  childrenText: ["நீங்கள் 18 வயதுக்குக் குறைவாக இருந்தால், உங்கள் தரவைப் பயன்படுத்தும் முன் பெற்றோர் அல்லது பாதுகாவலர் ஒப்புக்கொள்ள வேண்டும். குழந்தைகளைக் கண்காணிப்பதில்லை, அவர்களுக்குச் சலுகைகள் அனுப்புவதில்லை."],
  grievance: "கேள்விகள் மற்றும் புகார்கள்",
  grievanceText: (i) => [
    `புகார் தொடர்பு நபர்: ${contactLine(i.contact, "ta")}`,
    `${i.responseDays} நாட்களுக்குள் பதிலளிப்போம். திருப்தி இல்லையெனில் இந்திய தரவுப் பாதுகாப்பு வாரியத்திடம் (Data Protection Board of India) புகார் செய்யலாம்.`,
  ],
  changes: "இந்த அறிவிப்பில் மாற்றங்கள்",
  changesText: ["இந்த அறிவிப்பு மாறும்போது புதிய பதிப்பு எண் தரப்படும். நீங்கள் ஏற்ற பதிப்பு உங்கள் ஒப்புதல் பதிவுடன் சேமிக்கப்படும்."],
};

function build(w: Words, i: NoticeInput): NoticeTextRow {
  const rights = w.rightsText(i);
  return {
    title: w.title(i.shopName),
    intro: w.intro(i),
    reviewNote: w.review,
    sections: [
      { id: "who", heading: w.who, paragraphs: w.whoText(i) },
      { id: "collect", heading: w.collect, paragraphs: [], items: w.collectItems(i) },
      { id: "why", heading: w.why, paragraphs: [], items: w.whyItems(i) },
      { id: "share", heading: w.share, paragraphs: [], items: w.shareItems(i) },
      { id: "keep", heading: w.keep, paragraphs: w.keepText(i) },
      { id: "rights", heading: w.rights, paragraphs: rights.paragraphs, items: rights.items },
      { id: "withdraw", heading: w.withdraw, paragraphs: w.withdrawText(i) },
      { id: "children", heading: w.children, paragraphs: w.childrenText },
      { id: "grievance", heading: w.grievance, paragraphs: w.grievanceText(i) },
      { id: "changes", heading: w.changes, paragraphs: w.changesText },
    ],
  };
}

/** The privacy notice in English and Tamil, generated from the shop's facts. Pure and deterministic. */
export function buildNotice(input: NoticeInput): StoredNotice {
  return { en: build(EN, input), ta: build(TA, input) };
}

/** Stable hash of a generated notice: a new version is stored only when this changes. */
export function noticeHash(content: StoredNotice): string {
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

/** The consent-log `version` string for a notice version ("notice-v3"). */
export const noticeVersionLabel = (version: number) => `notice-v${version}`;
