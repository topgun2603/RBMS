import type { FeatureDef, PermissionDef } from "@srirealtime/core";
import { z } from "zod";
import type { AiTier } from "./types";

/** The module feature (plan / app profile gate, owner can hide it in Settings > Features). The shop's own opt-in is settings `ai.enabled`. */
export const AI_FEATURE = "ai";
export const AI_FEATURES: FeatureDef[] = [
  {
    key: AI_FEATURE,
    module: "ai",
    label: "AI assistance",
    description: "AI helpers that draft text and answers for you to check (Ask your shop, HSN suggestions, product descriptions). Off until the owner switches it on in Settings > AI; plan credits apply.",
    shopToggle: true,
    defaultOn: true,
  },
];

export const AI_PERMISSION_KEYS = { use: "ai.use", manage: "ai.manage" } as const;
export const AI_PERMISSIONS: PermissionDef[] = [
  {
    key: AI_PERMISSION_KEYS.use,
    module: "ai",
    label: "Use AI helpers",
    description: "Run AI helpers (they spend the shop's AI credits) and say whether a suggestion was good. Owners and admins always can.",
  },
  {
    key: AI_PERMISSION_KEYS.manage,
    module: "ai",
    label: "Manage AI",
    description: "Switch AI on or off, choose which helpers are allowed, see usage and recent runs.",
  },
];

/** Plan limit key. `_per_month` makes it a monthly allowance (IST month) that credit packs top up (see docs/ai.md). */
export const AI_CREDITS_KEY = "ai_credits_per_month";

export type AiFeatureStatus = "live" | "soon";

export interface AiFeatureInfo {
  key: string;
  status: AiFeatureStatus;
  tier: AiTier;
  label: string;
  labelTa: string;
  description: string;
  descriptionTa: string;
}

/**
 * The single registry of AI helpers. A feature passes its `key` to `ai.run`; the shop's per-feature switch, the usage
 * breakdown and the settings page all read this list. Add a helper here first, set `status: "live"` when it ships.
 */
export const AI_FEATURE_REGISTRY: readonly AiFeatureInfo[] = [
  {
    key: "ping",
    status: "live",
    tier: "light",
    label: "Connection test",
    labelTa: "இணைப்புச் சோதனை",
    description: "A tiny test that checks AI is working for your shop (uses about 1 credit).",
    descriptionTa: "உங்கள் கடையில் AI வேலை செய்கிறதா என்று பார்க்கும் சிறிய சோதனை (சுமார் 1 கிரெடிட்).",
  },
  {
    key: "ask-shop",
    status: "soon",
    tier: "standard",
    label: "Ask your shop",
    labelTa: "உங்கள் கடையிடம் கேளுங்கள்",
    description: "Ask questions in Tamil or English: today's sales, who owes you money, what to reorder.",
    descriptionTa: "தமிழிலோ ஆங்கிலத்திலோ கேளுங்கள்: இன்றைய விற்பனை, யார் பணம் தர வேண்டும், எதை மீண்டும் வாங்க வேண்டும்.",
  },
  {
    key: "hsn-suggest",
    status: "soon",
    tier: "light",
    label: "HSN code suggestions",
    labelTa: "HSN குறியீடு பரிந்துரை",
    description: "Suggests the HSN code and GST rate from an item name. You confirm before it is saved.",
    descriptionTa: "பொருளின் பெயரிலிருந்து HSN குறியீடும் GST விகிதமும் பரிந்துரைக்கும். சேமிக்கும் முன் நீங்கள் உறுதி செய்வீர்கள்.",
  },
  {
    key: "product-description",
    status: "soon",
    tier: "standard",
    label: "Product descriptions",
    labelTa: "பொருள் விவரங்கள்",
    description: "Writes a short product description for your online store in English and Tamil.",
    descriptionTa: "உங்கள் ஆன்லைன் கடைக்கு ஆங்கிலத்திலும் தமிழிலும் சிறு பொருள் விவரம் எழுதும்.",
  },
  {
    key: "bill-scan",
    status: "soon",
    tier: "vision",
    label: "Scan supplier bills",
    labelTa: "சப்ளையர் பில் ஸ்கேன்",
    description: "Reads a photo or PDF of a supplier bill and fills in the purchase for you to check.",
    descriptionTa: "சப்ளையர் பில்லின் புகைப்படம் அல்லது PDF-ஐப் படித்து, நீங்கள் சரிபார்க்க கொள்முதலை நிரப்பும்.",
  },
  {
    key: "studio",
    status: "soon",
    tier: "vision",
    label: "Product photo studio",
    labelTa: "பொருள் புகைப்பட ஸ்டுடியோ",
    description: "Describes and tidies up product photos for your store.",
    descriptionTa: "உங்கள் கடைக்கான பொருள் புகைப்படங்களை விவரித்து, சீராக்க உதவும்.",
  },
];

export const featureInfo = (key: string) => AI_FEATURE_REGISTRY.find((f) => f.key === key);

// ------------------------------------------------------------------ settings namespace "ai"

export const AI_SETTINGS_SCHEMA = z.object({
  /** The owner's opt-in. Off by default: nothing is sent to an AI model until the owner switches it on. */
  enabled: z.boolean(),
  /** Per-helper switches by registry key. A helper missing here follows `enabled` (on once AI is on). */
  features: z.record(z.string().regex(/^[a-z][a-z0-9-]{0,39}$/), z.boolean()),
  /** Also hide GSTINs (keeping the state and check digits) in text sent to the model. Phones and emails are always masked. */
  maskGstin: z.boolean(),
  /** For debugging: keep the (masked) input and the reply of each run for 7 days. Off by default; nothing is stored otherwise. */
  storePrompts: z.boolean(),
});
export type AiSettings = z.infer<typeof AI_SETTINGS_SCHEMA>;
export const AI_SETTINGS_DEFAULTS: AiSettings = { enabled: false, features: {}, maskGstin: false, storePrompts: false };
