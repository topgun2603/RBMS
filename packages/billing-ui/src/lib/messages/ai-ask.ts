import type { Messages } from "@srirealtime/i18n/client";

/** billing.gstr1.explain.* strings: "Explain this month" on the GSTR-1 card (docs/ai.md, Phase 2). Keep en and ta key sets identical. */
export const en: Messages = {
  "billing.gstr1.explain.button": "Explain this month",
  "billing.gstr1.explain.busy": "Reading the figures...",
  "billing.gstr1.explain.title": "AI note on {month}",
  "billing.gstr1.explain.changed": "What changed",
  "billing.gstr1.explain.unusual": "Anything unusual",
  "billing.gstr1.explain.fix": "Check in your bills",
  "billing.gstr1.explain.fallback": "I could not match the numbers in my written note to your figures, so here are the figures themselves.",
  "billing.gstr1.explain.disclaimer": "A note written from your computed figures. It does not say your return is correct and does not tell you when or whether to file: check with your accountant.",
  "billing.gstr1.explain.credits": "{count, plural, one {# AI credit} other {# AI credits}} used",
  "billing.gstr1.explain.hint": "About 2 AI credits.",
};

export const ta: Messages = {
  "billing.gstr1.explain.button": "இந்த மாதத்தை விளக்கு",
  "billing.gstr1.explain.busy": "புள்ளிவிவரங்களைப் படிக்கிறது...",
  "billing.gstr1.explain.title": "{month} பற்றிய AI குறிப்பு",
  "billing.gstr1.explain.changed": "என்ன மாறியது",
  "billing.gstr1.explain.unusual": "வழக்கத்துக்கு மாறானவை",
  "billing.gstr1.explain.fix": "உங்கள் பில்களில் சரிபார்க்க",
  "billing.gstr1.explain.fallback": "எழுதிய குறிப்பில் உள்ள எண்களை உங்கள் புள்ளிவிவரங்களுடன் பொருத்த முடியவில்லை, அதனால் புள்ளிவிவரங்களையே தருகிறேன்.",
  "billing.gstr1.explain.disclaimer": "கணக்கிடப்பட்ட உங்கள் புள்ளிவிவரங்களிலிருந்து எழுதப்பட்ட குறிப்பு. உங்கள் ரிட்டர்ன் சரி என்று இது சொல்லாது, எப்போது அல்லது தாக்கல் செய்ய வேண்டுமா என்றும் சொல்லாது: உங்கள் கணக்காளரிடம் கேளுங்கள்.",
  "billing.gstr1.explain.credits": "{count} AI கிரெடிட் பயன்படுத்தப்பட்டது",
  "billing.gstr1.explain.hint": "சுமார் 2 AI கிரெடிட்.",
};
