"use client";

import * as React from "react";
import { createTranslator, type Locale, type Messages, type Translator } from "@srirealtime/i18n/client";
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
};

export const aiMessages = { en, ta } as const;

/** Translator for admin.ai.* in `locale` (English fills any gap). */
export function aiTranslator(locale: Locale | string): Translator {
  return createTranslator(locale === "ta" ? aiMessages.ta : aiMessages.en, aiMessages.en, locale);
}

/** Nav label without a hook (the dashboard layout already has the locale). */
export const aiNavLabel = (locale: Locale | string) => aiTranslator(locale)("admin.ai.nav");

/** Translator for the current admin locale. */
export function useAiT(): Translator {
  const { locale } = useI18n();
  return React.useMemo(() => aiTranslator(locale), [locale]);
}
