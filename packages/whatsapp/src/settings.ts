import { z } from "zod";

/**
 * Settings namespace `whatsapp`. For apps/api:
 * `settings.define("whatsapp", WHATSAPP_SETTINGS_SCHEMA, WHATSAPP_SETTINGS_DEFAULTS)`.
 *
 * - `ratePerMinute`: campaign messages sent per minute (throttle). Meta allows far more; this protects the shop's
 *   quality rating and spreads replies over time.
 * - `optOutReply` / `optInReply`: sent (as free-form text, the customer just wrote so the 24 h window is open) after a
 *   STOP / START keyword. Empty string = no reply.
 * - `extraOptOutKeywords` / `extraOptInKeywords`: added to the built-in English + Tamil keywords.
 * - `sendReadReceipts`: tell Meta the message was read (blue ticks) when staff open the conversation.
 * - `defaultLanguage`: template language used when a send doesn't name one (Meta code, e.g. `en`, `en_US`, `ta`).
 */
export const WHATSAPP_SETTINGS_SCHEMA = z.object({
  ratePerMinute: z.number().int().min(1).max(1000),
  optOutReply: z.string().max(1000),
  optInReply: z.string().max(1000),
  extraOptOutKeywords: z.array(z.string().trim().min(1).max(40)).max(30),
  extraOptInKeywords: z.array(z.string().trim().min(1).max(40)).max(30),
  sendReadReceipts: z.boolean(),
  defaultLanguage: z.string().trim().min(2).max(10),
});
export type WhatsAppSettings = z.infer<typeof WHATSAPP_SETTINGS_SCHEMA>;

export const WHATSAPP_SETTINGS_DEFAULTS: WhatsAppSettings = {
  ratePerMinute: 60,
  optOutReply: "You will not get offers from us on WhatsApp any more. Reply START to subscribe again. / இனி WhatsApp-இல் சலுகைச் செய்திகள் வராது. மீண்டும் பெற START என அனுப்பவும்.",
  optInReply: "Thank you! You will get our updates on WhatsApp again. / நன்றி! மீண்டும் WhatsApp-இல் எங்கள் செய்திகள் வரும்.",
  extraOptOutKeywords: [],
  extraOptInKeywords: [],
  sendReadReceipts: true,
  defaultLanguage: "en",
};

/** Merges a stored (partial, possibly stale) settings object over the defaults; invalid keys fall back to defaults. */
export function resolveWhatsAppSettings(stored: Partial<Record<keyof WhatsAppSettings, unknown>> | null | undefined): WhatsAppSettings {
  const out: Record<string, unknown> = { ...WHATSAPP_SETTINGS_DEFAULTS };
  const shape = WHATSAPP_SETTINGS_SCHEMA.shape;
  for (const key of Object.keys(shape) as (keyof WhatsAppSettings)[]) {
    const v = stored?.[key];
    if (v === undefined || v === null) continue;
    const parsed = shape[key].safeParse(v);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as WhatsAppSettings;
}
