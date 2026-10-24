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
    status: "live",
    tier: "light",
    label: "HSN code suggestions",
    labelTa: "HSN குறியீடு பரிந்துரை",
    description: "Suggests the HSN code and the usual GST rate from an item name, checked against the official HSN list (about 1 credit). You confirm before it is saved.",
    descriptionTa: "பொருளின் பெயரிலிருந்து HSN குறியீடும் வழக்கமான GST விகிதமும் பரிந்துரைக்கும்; அதிகாரப்பூர்வ HSN பட்டியலுடன் சரிபார்க்கப்படும் (சுமார் 1 கிரெடிட்). சேமிக்கும் முன் நீங்கள் உறுதி செய்வீர்கள்.",
  },
  {
    key: "product-description",
    status: "live",
    tier: "standard",
    label: "Product descriptions",
    labelTa: "பொருள் விவரங்கள்",
    description: "Writes a product description in English and Tamil from the facts you gave, and translates your catalogue into Tamil in bulk for you to approve (about 15 credits a product).",
    descriptionTa: "நீங்கள் தந்த தகவல்களிலிருந்து ஆங்கிலத்திலும் தமிழிலும் பொருள் விவரம் எழுதும்; பட்டியலை தமிழுக்கு மொத்தமாக மொழிபெயர்த்து நீங்கள் ஒப்புதல் அளிக்க வைக்கும் (ஒரு பொருளுக்கு சுமார் 15 கிரெடிட்).",
  },
  {
    key: "import-mapping",
    status: "live",
    tier: "light",
    label: "Smart column mapping for imports",
    labelTa: "இறக்குமதிக்கான தானியங்கி நெடுவரிசை பொருத்தம்",
    description: "Matches the columns of your spreadsheet to the import fields. Only the header row and 5 sample rows (phones, e-mails and GSTINs hidden) are sent. You confirm the mapping (about 2 credits).",
    descriptionTa: "உங்கள் ஸ்ப்ரெட்ஷீட் நெடுவரிசைகளை இறக்குமதி புலங்களுடன் பொருத்தும். தலைப்பு வரிசையும் 5 மாதிரி வரிசைகளும் மட்டுமே அனுப்பப்படும் (தொலைபேசி, மின்னஞ்சல், GSTIN மறைக்கப்படும்). மேப்பிங்கை நீங்கள் உறுதி செய்வீர்கள் (சுமார் 2 கிரெடிட்).",
  },
  {
    key: "help",
    status: "live",
    tier: "light",
    label: "Help assistant",
    labelTa: "உதவி உதவியாளர்",
    description: "Answers how-to questions in Tamil or English from the RBMS guides. It does not look at your shop's data (about 2 credits a question).",
    descriptionTa: "RBMS வழிகாட்டிகளிலிருந்து தமிழிலோ ஆங்கிலத்திலோ எப்படி செய்வது என்ற கேள்விகளுக்கு பதிலளிக்கும். உங்கள் கடையின் தரவைப் பார்க்காது (ஒரு கேள்விக்கு சுமார் 2 கிரெடிட்).",
  },
  {
    key: "bill-scan",
    status: "live",
    tier: "vision",
    label: "Scan supplier bills",
    labelTa: "சப்ளையர் பில் ஸ்கேன்",
    description: "Reads a photo or PDF of a supplier bill and fills in the purchase for you to check (about 40 credits a scan).",
    descriptionTa: "சப்ளையர் பில்லின் புகைப்படம் அல்லது PDF-ஐப் படித்து, நீங்கள் சரிபார்க்க கொள்முதலை நிரப்பும் (ஒரு ஸ்கேனுக்கு சுமார் 40 கிரெடிட்).",
  },
  {
    key: "receipt-scan",
    status: "live",
    tier: "vision",
    label: "Scan expense receipts",
    labelTa: "செலவு ரசீது ஸ்கேன்",
    description: "Reads a photo of a receipt and fills in the expense (vendor, date, amount, category) for you to check (about 15 credits a scan).",
    descriptionTa: "ரசீதின் புகைப்படத்தைப் படித்து, நீங்கள் சரிபார்க்க செலவை (விற்பனையாளர், தேதி, தொகை, வகை) நிரப்பும் (ஒரு ஸ்கேனுக்கு சுமார் 15 கிரெடிட்).",
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
  /** Suggest HSN and GST when the owner leaves the item name box (each suggestion uses about 1 credit). Off by default. */
  autoHsn: z.boolean().optional(),
});
export type AiSettings = z.infer<typeof AI_SETTINGS_SCHEMA>;
export const AI_SETTINGS_DEFAULTS: AiSettings = { enabled: false, features: {}, maskGstin: false, storePrompts: false };
