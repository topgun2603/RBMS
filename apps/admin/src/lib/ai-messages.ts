"use client";

import * as React from "react";
import { createTranslator, type Locale, type Messages, type Translator } from "@rbms/i18n/client";
import { useI18n } from "./i18n";

/** admin.ai.* strings for the platform AI usage table. Kept apart from admin-messages.ts like the KYC screen. */
const en: Messages = {
  "admin.ai.nav": "AI usage",
  "admin.ai.title": "AI usage",
  "admin.ai.subtitle": "What every shop used in a month: calls, model cost and credits. Prompts and answers are not stored.",
  "admin.ai.month": "Month",
  "admin.ai.provider": "Provider",
  "admin.ai.providerMock": "Sample (no API key)",
  "admin.ai.providerClaude": "Claude",
  "admin.ai.providerNone": "None",
  "admin.ai.totalRuns": "Calls",
  "admin.ai.totalCost": "Model cost",
  "admin.ai.totalCredits": "Credits charged",
  "admin.ai.col.shop": "Shop",
  "admin.ai.col.runs": "Calls",
  "admin.ai.col.failed": "Failed",
  "admin.ai.col.blocked": "Blocked",
  "admin.ai.col.tokens": "Tokens in / out",
  "admin.ai.col.cost": "Model cost",
  "admin.ai.col.credits": "Credits",
  "admin.ai.col.last": "Last used",
  "admin.ai.empty": "No AI use this month",
  "admin.ai.emptyHint": "Shops show up here after they switch AI on and use a helper.",
  "admin.ai.studio.nav": "Feature requests",
  "admin.ai.studio.title": "Studio feature requests",
  "admin.ai.studio.subtitle": "Things shop owners asked the Studio assistant for that the platform cannot do yet, counted by theme. Request text is masked.",
  "admin.ai.studio.total": "Requests",
  "admin.ai.studio.themes": "Shops asking",
  "admin.ai.studio.byTheme": "By theme",
  "admin.ai.studio.recent": "Latest requests",
  "admin.ai.studio.range": "Period",
  "admin.ai.studio.range30": "Last 30 days",
  "admin.ai.studio.range90": "Last 90 days",
  "admin.ai.studio.rangeAll": "All time",
  "admin.ai.studio.col.shop": "Shop",
  "admin.ai.studio.col.request": "Asked for",
  "admin.ai.studio.col.missing": "What is missing",
  "admin.ai.studio.col.theme": "Theme",
  "admin.ai.studio.col.when": "When",
  "admin.ai.studio.empty": "No requests yet",
  "admin.ai.studio.emptyHint": "When Studio cannot do something an owner asks for, it is listed here.",
  "admin.ai.studio.theme.storefront-look": "Store look",
  "admin.ai.studio.theme.home-page": "Home page",
  "admin.ai.studio.theme.store-settings": "Store settings",
  "admin.ai.studio.theme.bills-documents": "Bills and documents",
  "admin.ai.studio.theme.team-permissions": "Team and permissions",
  "admin.ai.studio.theme.sign-in": "Sign-in",
  "admin.ai.studio.theme.marketing-engagement": "Marketing and engagement",
  "admin.ai.studio.theme.integrations": "Integrations",
  "admin.ai.studio.theme.catalogue-products": "Catalogue and products",
  "admin.ai.studio.theme.reports-accounting": "Reports and accounting",
  "admin.ai.studio.theme.other": "Other",
};

const ta: Messages = {
  "admin.ai.nav": "AI பயன்பாடு",
  "admin.ai.title": "AI பயன்பாடு",
  "admin.ai.subtitle": "ஒரு மாதத்தில் ஒவ்வொரு கடையும் பயன்படுத்தியவை: அழைப்புகள், மாடல் செலவு, கிரெடிட்கள். கேள்விகளும் பதில்களும் சேமிக்கப்படுவதில்லை.",
  "admin.ai.month": "மாதம்",
  "admin.ai.provider": "வழங்குநர்",
  "admin.ai.providerMock": "மாதிரி (API key இல்லை)",
  "admin.ai.providerClaude": "Claude",
  "admin.ai.providerNone": "இல்லை",
  "admin.ai.totalRuns": "அழைப்புகள்",
  "admin.ai.totalCost": "மாடல் செலவு",
  "admin.ai.totalCredits": "வசூலித்த கிரெடிட்கள்",
  "admin.ai.col.shop": "கடை",
  "admin.ai.col.runs": "அழைப்புகள்",
  "admin.ai.col.failed": "தோல்வி",
  "admin.ai.col.blocked": "தடுக்கப்பட்டவை",
  "admin.ai.col.tokens": "டோக்கன்கள் உள்/வெளி",
  "admin.ai.col.cost": "மாடல் செலவு",
  "admin.ai.col.credits": "கிரெடிட்கள்",
  "admin.ai.col.last": "கடைசியாகப் பயன்படுத்தியது",
  "admin.ai.empty": "இந்த மாதம் AI பயன்பாடு இல்லை",
  "admin.ai.emptyHint": "கடைகள் AI-ஐ இயக்கி உதவியாளரைப் பயன்படுத்திய பிறகு இங்கே தோன்றும்.",
  "admin.ai.studio.nav": "அம்சக் கோரிக்கைகள்",
  "admin.ai.studio.title": "Studio அம்சக் கோரிக்கைகள்",
  "admin.ai.studio.subtitle": "கடை உரிமையாளர்கள் Studio உதவியாளரிடம் கேட்டு, தளத்தால் இன்னும் செய்ய முடியாதவை; தலைப்பு வாரியாக எண்ணிக்கையுடன். கோரிக்கை உரை மறைக்கப்பட்டது.",
  "admin.ai.studio.total": "கோரிக்கைகள்",
  "admin.ai.studio.themes": "கேட்ட கடைகள்",
  "admin.ai.studio.byTheme": "தலைப்பு வாரியாக",
  "admin.ai.studio.recent": "சமீபத்திய கோரிக்கைகள்",
  "admin.ai.studio.range": "காலம்",
  "admin.ai.studio.range30": "கடந்த 30 நாட்கள்",
  "admin.ai.studio.range90": "கடந்த 90 நாட்கள்",
  "admin.ai.studio.rangeAll": "எல்லா நேரமும்",
  "admin.ai.studio.col.shop": "கடை",
  "admin.ai.studio.col.request": "கேட்டது",
  "admin.ai.studio.col.missing": "என்ன இல்லை",
  "admin.ai.studio.col.theme": "தலைப்பு",
  "admin.ai.studio.col.when": "எப்போது",
  "admin.ai.studio.empty": "இன்னும் கோரிக்கைகள் இல்லை",
  "admin.ai.studio.emptyHint": "உரிமையாளர் கேட்டதை Studio-வால் செய்ய முடியாதபோது இங்கே பட்டியலிடப்படும்.",
  "admin.ai.studio.theme.storefront-look": "கடையின் தோற்றம்",
  "admin.ai.studio.theme.home-page": "முகப்புப் பக்கம்",
  "admin.ai.studio.theme.store-settings": "கடை அமைப்புகள்",
  "admin.ai.studio.theme.bills-documents": "பில்கள், ஆவணங்கள்",
  "admin.ai.studio.theme.team-permissions": "குழு, அனுமதிகள்",
  "admin.ai.studio.theme.sign-in": "உள்நுழைவு",
  "admin.ai.studio.theme.marketing-engagement": "சந்தைப்படுத்தல், ஈடுபாடு",
  "admin.ai.studio.theme.integrations": "ஒருங்கிணைப்புகள்",
  "admin.ai.studio.theme.catalogue-products": "பட்டியல், பொருட்கள்",
  "admin.ai.studio.theme.reports-accounting": "அறிக்கைகள், கணக்கு",
  "admin.ai.studio.theme.other": "மற்றவை",
};

export const aiMessages = { en, ta } as const;

/** Translator for admin.ai.* in `locale` (English fills any gap). */
export function aiTranslator(locale: Locale | string): Translator {
  return createTranslator(locale === "ta" ? aiMessages.ta : aiMessages.en, aiMessages.en, locale);
}

/** Nav label without a hook (the dashboard layout already has the locale). */
export const aiNavLabel = (locale: Locale | string) => aiTranslator(locale)("admin.ai.nav");

export const aiStudioNavLabel = (locale: Locale | string) => aiTranslator(locale)("admin.ai.studio.nav");

/** Translator for the current admin locale. */
export function useAiT(): Translator {
  const { locale } = useI18n();
  return React.useMemo(() => aiTranslator(locale), [locale]);
}
