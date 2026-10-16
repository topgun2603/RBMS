"use client";

import * as React from "react";
import { createTranslator, type Locale, type Messages, type Translator } from "@srirealtime/i18n/client";
import { useI18n } from "./i18n";

/**
 * admin.subs.* strings for Platform → Subscriptions (docs/batch5.md). Kept apart from admin-messages.ts like the KYC
 * queue's; copy into packages/i18n/src/bundles/{en,ta}.ts when the server bundles take them.
 */
const en: Messages = {
  "admin.subs.nav": "Subscriptions",
  "admin.subs.title": "Subscriptions",
  "admin.subs.subtitle": "Every shop's plan subscription: revenue, trials, payments that need attention and platform invoices.",
  "admin.subs.tabs": "Subscriptions and invoices",
  "admin.subs.tab.subscriptions": "Subscriptions",
  "admin.subs.tab.invoices": "Platform invoices",

  "admin.subs.stats.mrr": "MRR",
  "admin.subs.stats.mrrHint": "Monthly, GST excluded",
  "admin.subs.stats.arr": "ARR",
  "admin.subs.stats.arrHint": "MRR × 12",
  "admin.subs.stats.active": "Paying",
  "admin.subs.stats.activeHint": "{comp} complimentary · {free} free",
  "admin.subs.stats.trialing": "On trial",
  "admin.subs.stats.pastDue": "Past due",
  "admin.subs.stats.pastDueHint": "In the 7-day grace period",
  "admin.subs.stats.churn": "Churn (30 days)",
  "admin.subs.stats.churnHint": "Paying shops that ended",
  "admin.subs.stats.conversion": "Trial conversion",
  "admin.subs.stats.conversionHint": "{converted} of {ended} ended trials",
  "admin.subs.stats.conversionNone": "No trial has ended yet",

  "admin.subs.filter.status": "Status",
  "admin.subs.filter.all": "All",
  "admin.subs.search": "Search shops or plans",
  "admin.subs.count": "{count} subscriptions",

  "admin.subs.col.shop": "Shop",
  "admin.subs.col.plan": "Plan",
  "admin.subs.col.status": "Status",
  "admin.subs.col.mrr": "MRR",
  "admin.subs.col.renews": "Next date",
  "admin.subs.col.provider": "Provider",

  "admin.subs.status.trialing": "Trial",
  "admin.subs.status.active": "Active",
  "admin.subs.status.past_due": "Past due",
  "admin.subs.status.cancelled": "Cancelled",
  "admin.subs.status.expired": "Expired",

  "admin.subs.provider.razorpay": "Razorpay",
  "admin.subs.provider.mock": "Mock",
  "admin.subs.provider.manual": "Complimentary",
  "admin.subs.provider.none": "Free",

  "admin.subs.interval.monthly": "Monthly",
  "admin.subs.interval.yearly": "Yearly",

  "admin.subs.when.trialEnds": "Trial ends {date}",
  "admin.subs.when.renews": "Renews {date}",
  "admin.subs.when.ends": "Ends {date}",
  "admin.subs.when.grace": "Grace until {date}",
  "admin.subs.when.compUntil": "Comp until {date}",
  "admin.subs.when.open": "No end date",
  "admin.subs.when.pending": "→ {plan} at period end",
  "admin.subs.when.awaitingMandate": "Waiting for mandate",

  "admin.subs.empty": "No subscriptions",
  "admin.subs.emptyHint": "Shops appear here once they sign up or pick a plan.",

  "admin.subs.action.extend": "Extend trial",
  "admin.subs.action.comp": "Comp plan",
  "admin.subs.action.open": "Open shop",
  "admin.subs.action.workspace": "Open in admin",

  "admin.subs.extend.title": "Extend the trial of {shop}",
  "admin.subs.extend.body": "Adds days to the trial end. An ended trial re-opens for that many days from today.",
  "admin.subs.extend.days": "Days",
  "admin.subs.extend.daysHint": "1 to 365 days.",
  "admin.subs.extend.newEnd": "New trial end: {date}",
  "admin.subs.extend.invalid": "Enter 1 to 365 days",
  "admin.subs.extend.save": "Extend trial",
  "admin.subs.extend.done": "Trial extended to {date}",

  "admin.subs.comp.title": "Comp a plan for {shop}",
  "admin.subs.comp.body": "The shop gets the plan with no charge. Any running mandate is cancelled.",
  "admin.subs.comp.plan": "Plan",
  "admin.subs.comp.until": "Until",
  "admin.subs.comp.untilHint": "Leave empty for no end date. After it, the lifecycle job moves the shop to Free.",
  "admin.subs.comp.untilPast": "Pick a date in the future",
  "admin.subs.comp.save": "Comp plan",
  "admin.subs.comp.done": "{plan} given to {shop}",

  "admin.subs.inv.search": "Search invoices or shops",
  "admin.subs.inv.count": "{count} invoices",
  "admin.subs.inv.col.number": "Invoice",
  "admin.subs.inv.col.shop": "Shop",
  "admin.subs.inv.col.date": "Date",
  "admin.subs.inv.col.total": "Total",
  "admin.subs.inv.col.gst": "GST",
  "admin.subs.inv.col.status": "Status",
  "admin.subs.inv.status.paid": "Paid",
  "admin.subs.inv.status.void": "Void",
  "admin.subs.inv.gst.intra": "CGST + SGST",
  "admin.subs.inv.gst.inter": "IGST",
  "admin.subs.inv.pdf": "Download PDF",
  "admin.subs.inv.void": "Void invoice",
  "admin.subs.inv.voidTitle": "Void {number}?",
  "admin.subs.inv.voidBody": "The invoice stays in the series but is marked void. This can't be undone; issue a new one if needed.",
  "admin.subs.inv.voidReason": "Reason",
  "admin.subs.inv.voidReasonHint": "Kept with the invoice and in the audit log.",
  "admin.subs.inv.voided": "{number} voided",
  "admin.subs.inv.downloaded": "PDF downloaded",
  "admin.subs.inv.empty": "No platform invoices",
  "admin.subs.inv.emptyHint": "An invoice is issued for every successful plan charge.",
  "admin.subs.optional": "optional",
};

const ta: Messages = {
  "admin.subs.nav": "சந்தாக்கள்",
  "admin.subs.title": "சந்தாக்கள்",
  "admin.subs.subtitle": "ஒவ்வொரு கடையின் திட்டச் சந்தா: வருவாய், சோதனைகள், கவனிக்க வேண்டிய கட்டணங்கள், தள விலைப்பட்டியல்கள்.",
  "admin.subs.tabs": "சந்தாக்களும் விலைப்பட்டியல்களும்",
  "admin.subs.tab.subscriptions": "சந்தாக்கள்",
  "admin.subs.tab.invoices": "தள விலைப்பட்டியல்கள்",

  "admin.subs.stats.mrr": "MRR",
  "admin.subs.stats.mrrHint": "மாதாந்திரம், ஜிஎஸ்டி தவிர்த்து",
  "admin.subs.stats.arr": "ARR",
  "admin.subs.stats.arrHint": "MRR × 12",
  "admin.subs.stats.active": "கட்டணம் செலுத்துபவை",
  "admin.subs.stats.activeHint": "{comp} இலவசமாக வழங்கியவை · {free} இலவசத் திட்டம்",
  "admin.subs.stats.trialing": "சோதனையில்",
  "admin.subs.stats.pastDue": "கட்டணம் நிலுவை",
  "admin.subs.stats.pastDueHint": "7 நாள் சலுகைக் காலத்தில்",
  "admin.subs.stats.churn": "விலகல் (30 நாட்கள்)",
  "admin.subs.stats.churnHint": "முடிந்த கட்டணக் கடைகள்",
  "admin.subs.stats.conversion": "சோதனை மாற்றம்",
  "admin.subs.stats.conversionHint": "முடிந்த {ended} சோதனைகளில் {converted}",
  "admin.subs.stats.conversionNone": "இன்னும் எந்தச் சோதனையும் முடியவில்லை",

  "admin.subs.filter.status": "நிலை",
  "admin.subs.filter.all": "அனைத்தும்",
  "admin.subs.search": "கடை அல்லது திட்டம் தேடுக",
  "admin.subs.count": "{count} சந்தாக்கள்",

  "admin.subs.col.shop": "கடை",
  "admin.subs.col.plan": "திட்டம்",
  "admin.subs.col.status": "நிலை",
  "admin.subs.col.mrr": "MRR",
  "admin.subs.col.renews": "அடுத்த தேதி",
  "admin.subs.col.provider": "வழங்குநர்",

  "admin.subs.status.trialing": "சோதனை",
  "admin.subs.status.active": "செயலில்",
  "admin.subs.status.past_due": "நிலுவை",
  "admin.subs.status.cancelled": "ரத்துசெய்யப்பட்டது",
  "admin.subs.status.expired": "காலாவதி",

  "admin.subs.provider.razorpay": "Razorpay",
  "admin.subs.provider.mock": "சோதனை வழங்குநர்",
  "admin.subs.provider.manual": "இலவசமாக வழங்கியது",
  "admin.subs.provider.none": "இலவசம்",

  "admin.subs.interval.monthly": "மாதாந்திரம்",
  "admin.subs.interval.yearly": "ஆண்டுதோறும்",

  "admin.subs.when.trialEnds": "சோதனை {date} அன்று முடியும்",
  "admin.subs.when.renews": "{date} அன்று புதுப்பிப்பு",
  "admin.subs.when.ends": "{date} அன்று முடியும்",
  "admin.subs.when.grace": "{date} வரை சலுகைக் காலம்",
  "admin.subs.when.compUntil": "{date} வரை இலவசம்",
  "admin.subs.when.open": "முடிவுத் தேதி இல்லை",
  "admin.subs.when.pending": "காலம் முடிவில் → {plan}",
  "admin.subs.when.awaitingMandate": "கட்டண அனுமதிக்குக் காத்திருக்கிறது",

  "admin.subs.empty": "சந்தாக்கள் இல்லை",
  "admin.subs.emptyHint": "கடைகள் பதிவுசெய்தோ திட்டத்தைத் தேர்ந்தோ ஆனதும் இங்கே தோன்றும்.",

  "admin.subs.action.extend": "சோதனையை நீட்டி",
  "admin.subs.action.comp": "இலவசமாகத் திட்டம் வழங்கு",
  "admin.subs.action.open": "கடையைத் திற",
  "admin.subs.action.workspace": "நிர்வாகத்தில் திற",

  "admin.subs.extend.title": "{shop} சோதனையை நீட்டி",
  "admin.subs.extend.body": "சோதனை முடிவில் நாட்களைச் சேர்க்கும். முடிந்த சோதனை இன்றிலிருந்து அத்தனை நாட்களுக்கு மீண்டும் திறக்கும்.",
  "admin.subs.extend.days": "நாட்கள்",
  "admin.subs.extend.daysHint": "1 முதல் 365 நாட்கள்.",
  "admin.subs.extend.newEnd": "புதிய சோதனை முடிவு: {date}",
  "admin.subs.extend.invalid": "1 முதல் 365 நாட்கள் உள்ளிடவும்",
  "admin.subs.extend.save": "சோதனையை நீட்டி",
  "admin.subs.extend.done": "சோதனை {date} வரை நீட்டிக்கப்பட்டது",

  "admin.subs.comp.title": "{shop} கடைக்கு இலவசமாகத் திட்டம் வழங்கு",
  "admin.subs.comp.body": "கட்டணம் இல்லாமல் கடைக்குத் திட்டம் கிடைக்கும். இயங்கும் கட்டண அனுமதி ரத்துசெய்யப்படும்.",
  "admin.subs.comp.plan": "திட்டம்",
  "admin.subs.comp.until": "வரை",
  "admin.subs.comp.untilHint": "முடிவுத் தேதி வேண்டாமெனில் காலியாக விடுங்கள். அதன் பிறகு கடை இலவசத் திட்டத்துக்கு மாறும்.",
  "admin.subs.comp.untilPast": "எதிர்காலத் தேதியைத் தேர்ந்தெடுங்கள்",
  "admin.subs.comp.save": "திட்டம் வழங்கு",
  "admin.subs.comp.done": "{shop} கடைக்கு {plan} வழங்கப்பட்டது",

  "admin.subs.inv.search": "விலைப்பட்டியல் அல்லது கடை தேடுக",
  "admin.subs.inv.count": "{count} விலைப்பட்டியல்கள்",
  "admin.subs.inv.col.number": "விலைப்பட்டியல்",
  "admin.subs.inv.col.shop": "கடை",
  "admin.subs.inv.col.date": "தேதி",
  "admin.subs.inv.col.total": "மொத்தம்",
  "admin.subs.inv.col.gst": "ஜிஎஸ்டி",
  "admin.subs.inv.col.status": "நிலை",
  "admin.subs.inv.status.paid": "செலுத்தப்பட்டது",
  "admin.subs.inv.status.void": "செல்லாது",
  "admin.subs.inv.gst.intra": "CGST + SGST",
  "admin.subs.inv.gst.inter": "IGST",
  "admin.subs.inv.pdf": "PDF பதிவிறக்கு",
  "admin.subs.inv.void": "செல்லாததாக்கு",
  "admin.subs.inv.voidTitle": "{number} செல்லாததாக்கவா?",
  "admin.subs.inv.voidBody": "விலைப்பட்டியல் வரிசையில் இருக்கும், ஆனால் செல்லாது எனக் குறிக்கப்படும். இதைத் திரும்பப் பெற முடியாது; தேவைப்பட்டால் புதியது வழங்குங்கள்.",
  "admin.subs.inv.voidReason": "காரணம்",
  "admin.subs.inv.voidReasonHint": "விலைப்பட்டியலுடனும் தணிக்கைப் பதிவிலும் வைக்கப்படும்.",
  "admin.subs.inv.voided": "{number} செல்லாததாக்கப்பட்டது",
  "admin.subs.inv.downloaded": "PDF பதிவிறக்கப்பட்டது",
  "admin.subs.inv.empty": "தள விலைப்பட்டியல்கள் இல்லை",
  "admin.subs.inv.emptyHint": "ஒவ்வொரு வெற்றிகரமான திட்டக் கட்டணத்துக்கும் விலைப்பட்டியல் வழங்கப்படும்.",
  "admin.subs.optional": "விருப்பம்",
};

export const subscriptionsMessages = { en, ta } as const;

/** Translator for admin.subs.* in `locale` (English fills any gap). */
export function subsTranslator(locale: Locale | string): Translator {
  return createTranslator(locale === "ta" ? subscriptionsMessages.ta : subscriptionsMessages.en, subscriptionsMessages.en, locale);
}

/** Nav label without a hook (the dashboard layout already has the locale). */
export const subsNavLabel = (locale: Locale | string) => subsTranslator(locale)("admin.subs.nav");

/** Translator for the current admin locale. */
export function useSubsT(): Translator {
  const { locale } = useI18n();
  return React.useMemo(() => subsTranslator(locale), [locale]);
}
