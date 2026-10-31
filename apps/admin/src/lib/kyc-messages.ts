"use client";

import * as React from "react";
import { createTranslator, type Locale, type Messages, type Translator } from "@rbms/i18n/client";
import { useI18n } from "./i18n";

/**
 * admin.kyc.* strings for the platform KYC review queue. Kept apart from admin-messages.ts so this screen can ship on
 * its own. Copy into packages/i18n/src/bundles/{en,ta}.ts when the server bundles take them.
 */
const en: Messages = {
  "admin.kyc.nav": "KYC review",
  "admin.kyc.title": "KYC review queue",
  "admin.kyc.subtitle": "Checks across every shop that a person needs to look at — usually a low name match on a payout account.",
  "admin.kyc.waiting": "{count} waiting",

  "admin.kyc.col.shop": "Shop",
  "admin.kyc.col.subject": "Subject",
  "admin.kyc.col.check": "Check",
  "admin.kyc.col.match": "Name match",
  "admin.kyc.col.status": "Status",
  "admin.kyc.col.submitted": "Submitted",

  "admin.kyc.filter.shop": "Shop",
  "admin.kyc.filter.allShops": "All shops",
  "admin.kyc.filter.status": "Status",
  "admin.kyc.filter.allStatuses": "All checks",
  "admin.kyc.search": "Search names",
  "admin.kyc.count": "{count, plural, one {# check} other {# checks}}",

  "admin.kyc.empty": "Nothing to review",
  "admin.kyc.emptyHint": "Checks that need a person show up here.",

  "admin.kyc.subject.vendor": "Vendor",
  "admin.kyc.subject.shop": "Shop",
  "admin.kyc.subject.user": "User",

  "admin.kyc.type.pan": "PAN",
  "admin.kyc.type.gstin": "GSTIN",
  "admin.kyc.type.bank_account": "Bank account",
  "admin.kyc.type.upi": "UPI",
  "admin.kyc.type.digilocker_aadhaar": "Aadhaar (DigiLocker)",
  "admin.kyc.type.selfie": "Selfie",

  "admin.kyc.status.pending": "Pending",
  "admin.kyc.status.verified": "Verified",
  "admin.kyc.status.failed": "Failed",
  "admin.kyc.status.manual_review": "Needs review",
  "admin.kyc.status.none": "Not started",

  "admin.kyc.match.none": "No score",
  "admin.kyc.match.strong": "Strong",
  "admin.kyc.match.weak": "Weak",
  "admin.kyc.match.poor": "Poor",
  "admin.kyc.match.value": "{score}% · {band}",
  "admin.kyc.match.aria": "Name match score",

  "admin.kyc.detail.title": "{type} check",
  "admin.kyc.detail.description": "{shop} · {subject}",
  "admin.kyc.detail.subjectStatus": "Subject status",
  "admin.kyc.detail.subjectId": "Subject ID",
  "admin.kyc.detail.verifiedName": "Verified name",
  "admin.kyc.detail.inputs": "Submitted details",
  "admin.kyc.detail.masked": "Identifiers are masked. Full numbers are never stored or shown.",
  "admin.kyc.detail.names": "Names",
  "admin.kyc.detail.nameOnRecord": "Name on record",
  "admin.kyc.detail.comparedWith": "Compared with",
  "admin.kyc.detail.score": "Name match",
  "admin.kyc.detail.scoreExplain":
    "Bank and UPI names are compared with the verified PAN name. A score of {threshold} or more passes on its own; below that a reviewer decides. Initials and word order don't lower the score much.",
  "admin.kyc.detail.scoreExplainOther": "Shown for reference. The pass mark for payout checks is {threshold}.",
  "admin.kyc.detail.provider": "Provider",
  "admin.kyc.detail.error": "Provider message",
  "admin.kyc.detail.result": "Provider result",
  "admin.kyc.detail.noResult": "No result fields",
  "admin.kyc.detail.review": "Previous review",
  "admin.kyc.detail.reviewApproved": "Approved",
  "admin.kyc.detail.reviewRejected": "Rejected",
  "admin.kyc.detail.reviewReason": "Reason",
  "admin.kyc.detail.reviewBy": "By",
  "admin.kyc.detail.reviewAt": "When",
  "admin.kyc.detail.created": "Submitted",
  "admin.kyc.detail.updated": "Last updated",
  "admin.kyc.detail.empty": "—",
  "admin.kyc.detail.notReviewable": "This check is no longer waiting for review.",

  "admin.kyc.approve": "Approve",
  "admin.kyc.reject": "Reject",
  "admin.kyc.approveTitle": "Approve this check?",
  "admin.kyc.approveDescription": "The check is marked verified and the subject's KYC status is recalculated.",
  "admin.kyc.rejectTitle": "Reject this check?",
  "admin.kyc.rejectDescription": "The check is marked failed. The shop sees the reason and can submit again.",
  "admin.kyc.reason": "Reason",
  "admin.kyc.optional": "optional",
  "admin.kyc.reasonApproveHint": "Kept in the audit log, e.g. \"Name differs only by initial\".",
  "admin.kyc.reasonRejectHint": "Shown to the shop. Say what to fix.",
  "admin.kyc.reasonRequired": "Enter a reason",
  "admin.kyc.reasonTooLong": "Keep it to {max} characters",
  "admin.kyc.counter": "{count}/{max}",
  "admin.kyc.approved": "Check approved",
  "admin.kyc.rejected": "Check rejected",
  "admin.kyc.cancel": "Cancel",
};

const ta: Messages = {
  "admin.kyc.nav": "KYC சரிபார்ப்பு",
  "admin.kyc.title": "KYC சரிபார்ப்பு வரிசை",
  "admin.kyc.subtitle": "எல்லாக் கடைகளிலும் ஒருவர் பார்க்க வேண்டிய சரிபார்ப்புகள் — பெரும்பாலும் பணம் பெறும் கணக்கில் பெயர் பொருத்தம் குறைவாக இருப்பவை.",
  "admin.kyc.waiting": "{count} காத்திருக்கின்றன",

  "admin.kyc.col.shop": "கடை",
  "admin.kyc.col.subject": "யாருக்கு",
  "admin.kyc.col.check": "சரிபார்ப்பு",
  "admin.kyc.col.match": "பெயர் பொருத்தம்",
  "admin.kyc.col.status": "நிலை",
  "admin.kyc.col.submitted": "சமர்ப்பித்தது",

  "admin.kyc.filter.shop": "கடை",
  "admin.kyc.filter.allShops": "எல்லாக் கடைகளும்",
  "admin.kyc.filter.status": "நிலை",
  "admin.kyc.filter.allStatuses": "எல்லாச் சரிபார்ப்புகளும்",
  "admin.kyc.search": "பெயர்களைத் தேடு",
  "admin.kyc.count": "{count} சரிபார்ப்புகள்",

  "admin.kyc.empty": "சரிபார்க்க எதுவும் இல்லை",
  "admin.kyc.emptyHint": "ஒருவர் பார்க்க வேண்டிய சரிபார்ப்புகள் இங்கே தோன்றும்.",

  "admin.kyc.subject.vendor": "விற்பனையாளர்",
  "admin.kyc.subject.shop": "கடை",
  "admin.kyc.subject.user": "பயனர்",

  "admin.kyc.type.pan": "PAN",
  "admin.kyc.type.gstin": "GSTIN",
  "admin.kyc.type.bank_account": "வங்கிக் கணக்கு",
  "admin.kyc.type.upi": "UPI",
  "admin.kyc.type.digilocker_aadhaar": "ஆதார் (DigiLocker)",
  "admin.kyc.type.selfie": "சுயபடம்",

  "admin.kyc.status.pending": "நிலுவையில்",
  "admin.kyc.status.verified": "சரிபார்க்கப்பட்டது",
  "admin.kyc.status.failed": "தோல்வி",
  "admin.kyc.status.manual_review": "சரிபார்ப்பு தேவை",
  "admin.kyc.status.none": "தொடங்கவில்லை",

  "admin.kyc.match.none": "மதிப்பெண் இல்லை",
  "admin.kyc.match.strong": "வலுவானது",
  "admin.kyc.match.weak": "பலவீனமானது",
  "admin.kyc.match.poor": "மிகக் குறைவு",
  "admin.kyc.match.value": "{score}% · {band}",
  "admin.kyc.match.aria": "பெயர் பொருத்த மதிப்பெண்",

  "admin.kyc.detail.title": "{type} சரிபார்ப்பு",
  "admin.kyc.detail.description": "{shop} · {subject}",
  "admin.kyc.detail.subjectStatus": "KYC நிலை",
  "admin.kyc.detail.subjectId": "அடையாள எண்",
  "admin.kyc.detail.verifiedName": "சரிபார்த்த பெயர்",
  "admin.kyc.detail.inputs": "சமர்ப்பித்த விவரங்கள்",
  "admin.kyc.detail.masked": "அடையாள எண்கள் மறைக்கப்பட்டுள்ளன. முழு எண்கள் சேமிக்கப்படுவதோ காட்டப்படுவதோ இல்லை.",
  "admin.kyc.detail.names": "பெயர்கள்",
  "admin.kyc.detail.nameOnRecord": "பதிவில் உள்ள பெயர்",
  "admin.kyc.detail.comparedWith": "ஒப்பிட்ட பெயர்",
  "admin.kyc.detail.score": "பெயர் பொருத்தம்",
  "admin.kyc.detail.scoreExplain":
    "வங்கி, UPI பெயர்கள் சரிபார்த்த PAN பெயருடன் ஒப்பிடப்படுகின்றன. {threshold} அல்லது அதற்கு மேல் தானாகவே ஏற்கப்படும்; அதற்குக் கீழ் என்றால் சரிபார்ப்பவர் முடிவு செய்வார். முதலெழுத்துகளும் சொல் வரிசையும் மதிப்பெண்ணை அதிகம் குறைக்காது.",
  "admin.kyc.detail.scoreExplainOther": "தகவலுக்காக மட்டும். பணம் பெறும் சரிபார்ப்புகளுக்கான தேர்ச்சி மதிப்பெண் {threshold}.",
  "admin.kyc.detail.provider": "சேவை வழங்குநர்",
  "admin.kyc.detail.error": "வழங்குநர் செய்தி",
  "admin.kyc.detail.result": "வழங்குநர் முடிவு",
  "admin.kyc.detail.noResult": "முடிவு விவரங்கள் இல்லை",
  "admin.kyc.detail.review": "முந்தைய சரிபார்ப்பு",
  "admin.kyc.detail.reviewApproved": "ஏற்கப்பட்டது",
  "admin.kyc.detail.reviewRejected": "நிராகரிக்கப்பட்டது",
  "admin.kyc.detail.reviewReason": "காரணம்",
  "admin.kyc.detail.reviewBy": "யாரால்",
  "admin.kyc.detail.reviewAt": "எப்போது",
  "admin.kyc.detail.created": "சமர்ப்பித்தது",
  "admin.kyc.detail.updated": "கடைசியாகப் புதுப்பித்தது",
  "admin.kyc.detail.empty": "—",
  "admin.kyc.detail.notReviewable": "இந்தச் சரிபார்ப்பு இனி காத்திருப்பில் இல்லை.",

  "admin.kyc.approve": "ஏற்கவும்",
  "admin.kyc.reject": "நிராகரிக்கவும்",
  "admin.kyc.approveTitle": "இந்தச் சரிபார்ப்பை ஏற்கவா?",
  "admin.kyc.approveDescription": "சரிபார்ப்பு வெற்றி எனக் குறிக்கப்பட்டு KYC நிலை மீண்டும் கணக்கிடப்படும்.",
  "admin.kyc.rejectTitle": "இந்தச் சரிபார்ப்பை நிராகரிக்கவா?",
  "admin.kyc.rejectDescription": "சரிபார்ப்பு தோல்வி எனக் குறிக்கப்படும். கடை காரணத்தைப் பார்த்து மீண்டும் சமர்ப்பிக்கலாம்.",
  "admin.kyc.reason": "காரணம்",
  "admin.kyc.optional": "விருப்பம்",
  "admin.kyc.reasonApproveHint": "தணிக்கைப் பதிவில் வைக்கப்படும், எ.கா. \"முதலெழுத்தில் மட்டும் வேறுபாடு\".",
  "admin.kyc.reasonRejectHint": "கடைக்குக் காட்டப்படும். எதைச் சரிசெய்ய வேண்டும் என்று சொல்லுங்கள்.",
  "admin.kyc.reasonRequired": "காரணத்தை உள்ளிடவும்",
  "admin.kyc.reasonTooLong": "{max} எழுத்துகளுக்குள் வைக்கவும்",
  "admin.kyc.counter": "{count}/{max}",
  "admin.kyc.approved": "சரிபார்ப்பு ஏற்கப்பட்டது",
  "admin.kyc.rejected": "சரிபார்ப்பு நிராகரிக்கப்பட்டது",
  "admin.kyc.cancel": "ரத்து",
};

export const kycMessages = { en, ta } as const;

/** Translator for admin.kyc.* in `locale` (English fills any gap). */
export function kycTranslator(locale: Locale | string): Translator {
  return createTranslator(locale === "ta" ? kycMessages.ta : kycMessages.en, kycMessages.en, locale);
}

/** Nav label without a hook (the dashboard layout already has the locale). */
export const kycNavLabel = (locale: Locale | string) => kycTranslator(locale)("admin.kyc.nav");

/** Translator for the current admin locale. */
export function useKycT(): Translator {
  const { locale } = useI18n();
  return React.useMemo(() => kycTranslator(locale), [locale]);
}
