import type { Channel } from "./types";
import type { TemplateContent } from "./templates";

/**
 * AI helper messages (docs/ai.md, Phase 2 part B). `daily.summary` goes to the shop's own owner and chosen staff, not to
 * customers. WhatsApp only delivers a business-initiated message through an approved template, so the text follows the
 * rules Meta checks: static words before the first and after the last variable, no line breaks inside a variable, and
 * the whole body under 1,024 characters (the AI narrative is cut to 700). Register the approved template per language with
 * `PUT /v1/notify/templates` (`providerRef.waTemplate`, `waLanguage`) like every other template.
 *
 * Vars — daily.summary: shop, date ("24 Oct"), narrative (one line: the summary and its 1 or 2 suggestions).
 */
const SUMMARY = {
  en: {
    body: "Daily summary from {{shop}} for {{date}}: {{narrative}} Open the app for the full details.",
    subject: "{{shop}}: daily summary for {{date}}",
  },
  ta: {
    body: "{{shop}} கடையின் {{date}} தினசரி சுருக்கம்: {{narrative}} முழு விவரங்களுக்கு ஆப்பைத் திறக்கவும்.",
    subject: "{{shop}}: {{date}} தினசரி சுருக்கம்",
  },
} as const;

export const AI_TEMPLATE_KEYS: readonly string[] = ["daily.summary"];

/** Built-in rows (whatsapp, email x en, ta). No SMS: promotional-style long text needs a DLT template per shop. */
export function aiTemplates(): TemplateContent[] {
  return (["en", "ta"] as const).flatMap((locale) =>
    (["whatsapp", "email"] as Channel[]).map((channel) => ({
      key: "daily.summary",
      channel,
      locale,
      subject: channel === "email" ? SUMMARY[locale].subject : null,
      body: SUMMARY[locale].body,
      providerRef: null,
    })),
  );
}
