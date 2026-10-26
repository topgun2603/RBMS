import type { FeatureDef, PermissionDef } from "@srirealtime/core";
import { z } from "zod";
import { DAILY_SUMMARY_SCHEMA } from "./insights/daily-settings";
import { MONEY_REGISTRY } from "./money/registry";
import { STORE_REGISTRY } from "./store/registry";
import { COUNTER_REGISTRY } from "./counter/registry";
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
  /** Module feature keys (any one of them) the shop must have on for the helper to be listed ("medicines", "dining"...). Omitted = every shop. */
  requires?: readonly string[];
  /** Sends sensitive data (health records): off until the owner switches this helper on by name, even when AI is on. */
  optIn?: boolean;
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
    status: "live",
    tier: "standard",
    label: "Ask your shop",
    labelTa: "உங்கள் கடையிடம் கேளுங்கள்",
    description: "Ask about your sales, dues, stock, expenses and GST in Tamil or English and get an answer from your own numbers (about 15 to 40 credits a question). Needs permission to view reports. Every number is checked against your reports.",
    descriptionTa: "உங்கள் விற்பனை, நிலுவை, இருப்பு, செலவு, GST பற்றி தமிழிலோ ஆங்கிலத்திலோ கேளுங்கள்; உங்கள் சொந்த கணக்கிலிருந்து பதில் கிடைக்கும் (ஒரு கேள்விக்கு சுமார் 15 முதல் 40 கிரெடிட்). அறிக்கைகளைப் பார்க்கும் அனுமதி தேவை. ஒவ்வொரு எண்ணும் உங்கள் அறிக்கைகளுடன் சரிபார்க்கப்படும்.",
  },
  {
    key: "gst-explain",
    status: "live",
    tier: "light",
    label: "Explain this month's GST",
    labelTa: "இந்த மாத GST விளக்கம்",
    description: "On Reports > GST, writes a short note on what changed since last month, anything unusual and what to check in your bills before filing (about 2 credits). Figures only: it never tells you to file or says the return is correct.",
    descriptionTa: "அறிக்கைகள் > GST-இல், கடந்த மாதத்திலிருந்து என்ன மாறியது, வழக்கத்துக்கு மாறானது என்ன, தாக்கல் செய்யும் முன் பில்களில் எதைப் பார்க்க வேண்டும் என்று சிறு குறிப்பு எழுதும் (சுமார் 2 கிரெடிட்). புள்ளிவிவரங்கள் மட்டும்: தாக்கல் செய்யச் சொல்லாது, ரிட்டர்ன் சரி என்றும் சொல்லாது.",
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
    key: "daily-summary",
    status: "live",
    tier: "light",
    label: "Daily summary",
    labelTa: "தினசரி சுருக்கம்",
    description: "Every evening, a short note on today's sales, low stock, dues and what to do tomorrow, on WhatsApp and your dashboard. All numbers are worked out by the software; the AI only writes the words (about 1 credit a day).",
    descriptionTa: "தினமும் மாலை இன்றைய விற்பனை, குறைந்த கையிருப்பு, நிலுவை, நாளை செய்ய வேண்டியவை பற்றிய சிறு குறிப்பு WhatsApp-இலும் டாஷ்போர்டிலும். எல்லா எண்களும் மென்பொருளே கணக்கிடும்; AI வார்த்தைகளை மட்டும் எழுதும் (ஒரு நாளுக்கு சுமார் 1 கிரெடிட்).",
  },
  {
    key: "reorder",
    status: "live",
    tier: "light",
    label: "Reorder suggestions",
    labelTa: "மீண்டும் வாங்கும் பரிந்துரை",
    description: "Suggests what to buy and how much, from your sales, stock and last year's festival rush (Pongal, Deepavali...). Quantities are calculated by the software; the AI writes a one-line reason per group (about 2 credits). You create the purchase order yourself.",
    descriptionTa: "உங்கள் விற்பனை, கையிருப்பு, கடந்த ஆண்டு பண்டிகை விற்பனை (பொங்கல், தீபாவளி...) அடிப்படையில் எதை எவ்வளவு வாங்குவது என்று பரிந்துரைக்கும். அளவுகளை மென்பொருள் கணக்கிடும்; AI ஒவ்வொரு குழுவுக்கும் ஒரு வரி காரணம் எழுதும் (சுமார் 2 கிரெடிட்). கொள்முதல் ஆர்டரை நீங்களே உருவாக்குவீர்கள்.",
  },
  {
    key: "campaign-writer",
    status: "live",
    tier: "standard",
    label: "WhatsApp campaign writer",
    labelTa: "WhatsApp பிரச்சார எழுத்தாளர்",
    description: "Drafts your campaign message in English and Tamil from your goal, suggests which customers to send it to (from purchase history, leaving out opt-outs) and a good time. It never adds offers you did not write. You review and send (about 10 credits).",
    descriptionTa: "உங்கள் நோக்கத்திலிருந்து ஆங்கிலத்திலும் தமிழிலும் பிரச்சார செய்தியை எழுதி, வாங்கிய வரலாற்றிலிருந்து (விலகியவர்களை நீக்கி) யாருக்கு அனுப்பலாம், எப்போது அனுப்பலாம் என்று பரிந்துரைக்கும். நீங்கள் எழுதாத சலுகைகளை சேர்க்காது. நீங்கள் பார்த்து அனுப்புவீர்கள் (சுமார் 10 கிரெடிட்).",
  },
  {
    key: "review-reply",
    status: "live",
    tier: "light",
    label: "Review replies and themes",
    labelTa: "விமர்சன பதில்கள் மற்றும் தலைப்புகள்",
    description: "Drafts a polite reply to a customer review in its own language (no promises unless you write them) and sums up what customers praise and complain about (about 1 to 2 credits). You edit and post.",
    descriptionTa: "வாடிக்கையாளர் விமர்சனத்துக்கு அதே மொழியில் பணிவான பதிலை எழுதும் (நீங்கள் எழுதாமல் வாக்குறுதி எதுவும் இருக்காது); வாடிக்கையாளர்கள் எதைப் பாராட்டுகிறார்கள், எதைக் குறை சொல்கிறார்கள் என்று சுருக்கும் (சுமார் 1-2 கிரெடிட்). நீங்கள் திருத்தி பதிவிடுவீர்கள்.",
  },
  // ---- Phase 3 part A: pharmacy and restaurant packs (docs/ai.md "Phase 3 part A")
  {
    key: "rx-scan",
    status: "live",
    tier: "vision",
    requires: ["medicines"],
    optIn: true,
    label: "Read a prescription",
    labelTa: "மருந்துச் சீட்டு வாசிப்பு",
    description: "Reads a photo or PDF of a prescription and drafts the bill and the prescription record for the pharmacist to check (about 40 credits a scan). Unclear lines are left for you to type; Schedule X and narcotics are never filled in.",
    descriptionTa: "மருந்துச் சீட்டின் புகைப்படம் அல்லது PDF-ஐப் படித்து, மருந்தாளர் சரிபார்க்க பில்லையும் மருந்துச் சீட்டுப் பதிவையும் வரைவாக நிரப்பும் (ஒரு ஸ்கேனுக்கு சுமார் 40 கிரெடிட்). தெளிவில்லாத வரிகளை நீங்களே தட்டச்சு செய்ய விடும்; ஷெட்யூல் X, போதை மருந்துகள் தானாக நிரப்பப்படாது.",
  },
  {
    key: "drug-interactions",
    status: "live",
    tier: "light",
    requires: ["medicines"],
    label: "Interaction and duplicate-salt warnings",
    labelTa: "மருந்து இடைவினை மற்றும் இரட்டை உப்பு எச்சரிக்கை",
    description: "On a bill with two or more medicines, flags the same salt twice and well-known major interactions from a short reference table, and explains a found pair in simple Tamil or English (about 1 credit). Advisory only: the pharmacist decides; it never blocks a sale or gives doses.",
    descriptionTa: "இரண்டு அல்லது அதற்கு மேற்பட்ட மருந்துகள் உள்ள பில்லில், ஒரே உப்பு இரு முறை வருவதையும், சிறு குறிப்பு அட்டவணையிலுள்ள முக்கிய மருந்து இடைவினைகளையும் காட்டி, கண்ட ஜோடியை எளிய தமிழ் அல்லது ஆங்கிலத்தில் விளக்கும் (சுமார் 1 கிரெடிட்). ஆலோசனை மட்டுமே: மருந்தாளரே முடிவு செய்வார்; விற்பனையைத் தடுக்காது, அளவு சொல்லாது.",
  },
  {
    key: "expiry-plan",
    status: "live",
    tier: "light",
    requires: ["medicines"],
    label: "Near-expiry plan",
    labelTa: "காலாவதி நெருங்கும் மருந்துகளுக்கான திட்டம்",
    description: "For batches expiring soon, works out quantity, value and days of stock against days to expiry, and suggests sell first, discount, return to supplier or write off, with a one-line reason per group (about 2 credits). You do the action.",
    descriptionTa: "விரைவில் காலாவதியாகும் பேட்ச்களுக்கு அளவு, மதிப்பு, காலாவதிக்கான நாட்களுக்கு எதிராக கையிருப்பு நாட்கள் ஆகியவற்றைக் கணக்கிட்டு, முதலில் விற்க, தள்ளுபடி, சப்ளையருக்குத் திருப்பி அனுப்ப அல்லது வெட்டிவிட பரிந்துரைக்கும்; ஒவ்வொரு குழுவுக்கும் ஒரு வரி காரணம் (சுமார் 2 கிரெடிட்). செயலை நீங்களே செய்வீர்கள்.",
  },
  {
    key: "menu-photo",
    status: "live",
    tier: "vision",
    requires: ["dining"],
    label: "Import menu from photo",
    labelTa: "புகைப்படத்திலிருந்து மெனு இறக்குமதி",
    description: "Reads 1 to 6 photos or a PDF of a printed menu and drafts the dishes with portions and prices for you to review, edit or skip before anything is created (about 40 to 120 credits).",
    descriptionTa: "அச்சிட்ட மெனுவின் 1 முதல் 6 புகைப்படங்கள் அல்லது PDF-ஐப் படித்து, உணவுகளை அளவுகள் மற்றும் விலைகளுடன் வரைவாகத் தரும்; எதுவும் உருவாக்கும் முன் நீங்கள் பார்த்து, திருத்தி, தவிர்க்கலாம் (சுமார் 40 முதல் 120 கிரெடிட்).",
  },
  {
    key: "dish-cost",
    status: "live",
    tier: "standard",
    requires: ["dining"],
    label: "Recipes and dish food cost",
    labelTa: "சமையல் குறிப்பு மற்றும் உணவு செலவு",
    description: "Drafts typical ingredients and quantities for a dish for you to edit (about 10 credits), then works out the cost per portion from your latest purchase rates and flags dishes above your target food-cost percentage. Costs are calculated by the software; a one-line summary is about 1 credit.",
    descriptionTa: "ஒரு உணவுக்கான வழக்கமான பொருட்களையும் அளவுகளையும் நீங்கள் திருத்த வரைவாகத் தரும் (சுமார் 10 கிரெடிட்); பின்னர் உங்கள் சமீபத்திய கொள்முதல் விலையிலிருந்து ஒரு பரிமாறலுக்கான செலவைக் கணக்கிட்டு, உங்கள் இலக்கு உணவுச் செலவு சதவீதத்தை மீறும் உணவுகளைக் காட்டும். செலவுகளை மென்பொருள் கணக்கிடும்; ஒரு வரி சுருக்கம் சுமார் 1 கிரெடிட்.",
  },
  {
    key: "prep-forecast",
    status: "live",
    tier: "light",
    requires: ["dining"],
    label: "Daily prep forecast",
    labelTa: "தினசரி தயாரிப்பு முன்னறிவிப்பு",
    description: "How many portions of each dish to prepare tomorrow, from the last 8 same weekdays' sales, the trend and the festival calendar, with ingredient totals when recipes exist, and a kitchen note in Tamil or English (about 1 credit). Numbers are calculated by the software.",
    descriptionTa: "கடந்த 8 ஒரே கிழமை விற்பனை, போக்கு, பண்டிகை நாட்காட்டி ஆகியவற்றிலிருந்து நாளை ஒவ்வொரு உணவிலும் எத்தனை பரிமாறல் தயாரிக்க வேண்டும் என்றும், சமையல் குறிப்புகள் இருந்தால் பொருள் மொத்தங்களையும், சமையலறைக்கான தமிழ் அல்லது ஆங்கிலக் குறிப்பையும் தரும் (சுமார் 1 கிரெடிட்). எண்களை மென்பொருள் கணக்கிடும்.",
  },
  {
    key: "fault-note",
    status: "live",
    tier: "light",
    label: "Repair fault notes",
    labelTa: "பழுது குறிப்பு",
    description: "On a new device job card, turns the customer's complaint (Tamil, Tanglish or English) into a fault summary, possible causes, things to check and the parts and labour from YOUR catalogue with a price range from your own rates (about 1 credit). The technician edits it; nothing is quoted to the customer.",
    descriptionTa: "புதிய சாதன ஜாப் கார்டில், வாடிக்கையாளரின் புகாரை (தமிழ், தங்கிலிஷ் அல்லது ஆங்கிலம்) பழுது சுருக்கம், சாத்தியமான காரணங்கள், சரிபார்க்க வேண்டியவை, உங்கள் பட்டியலிலிருந்து பாகங்கள் மற்றும் உங்கள் சொந்த விலைகளின் அடிப்படையில் விலை வரம்பாக மாற்றும் (சுமார் 1 கிரெடிட்). தொழில்நுட்பர் திருத்துவார்; வாடிக்கையாளருக்கு எதுவும் தானாக விலை சொல்லப்படாது.",
    requires: ["jobcards"],
  },
  {
    key: "device-label-read",
    status: "live",
    tier: "vision",
    label: "Read serial and IMEI from a photo",
    labelTa: "புகைப்படத்திலிருந்து சீரியல் மற்றும் IMEI வாசிப்பு",
    description: "Reads brand, model, serial number and IMEI from a photo of a box label, a phone's About screen or a sticker. The IMEI check digit is verified by the software and a failing number is never filled in. Warranty comes only from your own sales records (about 15 credits).",
    descriptionTa: "பெட்டி லேபிள், போனின் About திரை அல்லது ஸ்டிக்கரின் புகைப்படத்திலிருந்து பிராண்ட், மாடல், சீரியல் எண், IMEI ஆகியவற்றைப் படிக்கும். IMEI சரிபார்ப்பு இலக்கத்தை மென்பொருள் சரிபார்க்கும்; தவறான எண் நிரப்பப்படாது. உத்தரவாதம் உங்கள் சொந்த விற்பனைப் பதிவுகளிலிருந்து மட்டுமே (சுமார் 15 கிரெடிட்).",
    requires: ["jobcards", "serials"],
  },
  {
    key: "measurement-read",
    status: "live",
    tier: "vision",
    label: "Read measurement sheet",
    labelTa: "அளவுத் தாள் வாசிப்பு",
    description: "Reads a printed or handwritten measurement card into the garment's measurements (inches or cm detected). Unsure or out-of-range values are shown but never filled in on their own (about 20 credits).",
    descriptionTa: "அச்சிட்ட அல்லது கையால் எழுதிய அளவு அட்டையை ஆடையின் அளவுகளாகப் படிக்கும் (அங்குலம் அல்லது செ.மீ கண்டறியப்படும்). உறுதியில்லாத அல்லது வரம்புக்கு வெளியே உள்ள மதிப்புகள் காட்டப்படும், ஆனால் தானாக நிரப்பப்படாது (சுமார் 20 கிரெடிட்).",
    requires: ["jobcards"],
  },
  {
    key: "design-notes",
    status: "live",
    tier: "vision",
    label: "Design reference notes",
    labelTa: "வடிவமைப்பு குறிப்புகள்",
    description: "Looks at a design photo the customer brought and drafts short notes (neck, sleeve, lining, piping, work) for the job card (about 15 credits). The tailor edits.",
    descriptionTa: "வாடிக்கையாளர் கொண்டுவந்த வடிவமைப்பு புகைப்படத்தைப் பார்த்து ஜாப் கார்டுக்கு சிறு குறிப்புகளை (கழுத்து, கை, லைனிங், பைப்பிங், வேலைப்பாடு) எழுதும் (சுமார் 15 கிரெடிட்). தையல்காரர் திருத்துவார்.",
    requires: ["jobcards"],
  },
  {
    key: "winback-message",
    status: "live",
    tier: "light",
    label: "Member and client win-back",
    labelTa: "உறுப்பினர் மற்றும் வாடிக்கையாளரை மீட்டெடுத்தல்",
    description: "Finds members and clients who are drifting away (plan ending, lapsed, fewer visits, quiet for too long) from your own records and drafts a personal message for each. It never invents an offer: only one you type. You review and send, opted-out people are left out (about 1 credit a message).",
    descriptionTa: "உங்கள் சொந்த பதிவுகளிலிருந்து விலகிச் செல்லும் உறுப்பினர்கள் மற்றும் வாடிக்கையாளர்களை (திட்டம் முடியப்போவது, காலாவதியானது, வருகை குறைவது, நீண்ட நாள் வராதது) கண்டறிந்து ஒவ்வொருவருக்கும் தனிப்பட்ட செய்தியை எழுதும். சலுகையை இது உருவாக்காது: நீங்கள் எழுதியது மட்டுமே. நீங்கள் பார்த்து அனுப்புவீர்கள்; விலகியவர்கள் சேர்க்கப்படமாட்டார்கள் (ஒரு செய்திக்கு சுமார் 1 கிரெடிட்).",
    requires: ["memberships", "bookings"],
  },
  {
    key: "hardware-quote",
    status: "live",
    tier: "standard",
    label: "Material quotation builder",
    labelTa: "பொருள் விலைப்புள்ளி உருவாக்கி",
    description: "Describe a job (for example a 900 sq ft house with plumbing and electricals) and get a draft quotation using only items from your catalogue, with rough quantity estimates, the assumptions and a list of what you do not stock. Prices come from your items. No structural advice (about 40 to 80 credits).",
    descriptionTa: "வேலையை விவரியுங்கள் (எ.கா. பிளம்பிங், மின் வேலையுடன் 900 சதுர அடி வீடு); உங்கள் பட்டியலில் உள்ள பொருட்களை மட்டும் பயன்படுத்தி, தோராய அளவுகள், அனுமானங்கள், உங்களிடம் இல்லாதவற்றின் பட்டியலுடன் வரைவு விலைப்புள்ளி கிடைக்கும். விலைகள் உங்கள் பொருட்களிலிருந்து. கட்டமைப்பு ஆலோசனை இல்லை (சுமார் 40 முதல் 80 கிரெடிட்).",
    requires: ["invoices.quotations"],
  },
  // ---- Phase 3 part B: catalogue from photos, textile tags, jewellery, counter pack identify (docs/ai.md "Phase 3 part B")
  {
    key: "catalogue-photos",
    status: "live",
    tier: "vision",
    label: "Add products from photos",
    labelTa: "புகைப்படங்களிலிருந்து பொருட்களைச் சேர்",
    description: "Reads up to 20 photos of shelves, product packs or a price list and drafts the items (name, brand, size, MRP, category, HSN and the usual GST rate) in a grid where you edit, skip or merge before anything is created (about 25 credits a photo).",
    descriptionTa: "அலமாரிகள், பொருள் பேக்குகள் அல்லது விலைப் பட்டியலின் 20 வரை புகைப்படங்களைப் படித்து, பொருட்களை (பெயர், பிராண்ட், அளவு, MRP, வகை, HSN, வழக்கமான GST விகிதம்) ஒரு கட்டத்தில் வரைவாகத் தரும்; எதுவும் உருவாக்கும் முன் நீங்கள் திருத்தலாம், தவிர்க்கலாம், இணைக்கலாம் (ஒரு புகைப்படத்துக்கு சுமார் 25 கிரெடிட்).",
  },
  {
    key: "pack-identify",
    status: "live",
    tier: "vision",
    label: "Identify a product from its pack (counter)",
    labelTa: "பேக்கின் புகைப்படத்திலிருந்து பொருளை அடையாளம் காண் (கவுண்டர்)",
    description: "At the counter, a photo of an unknown pack fills the quick-add form (name, brand, size, MRP, category, HSN) for the cashier to confirm (about 12 credits).",
    descriptionTa: "கவுண்டரில், தெரியாத பேக்கின் புகைப்படம் விரைவுச் சேர்ப்பு படிவத்தை (பெயர், பிராண்ட், அளவு, MRP, வகை, HSN) நிரப்பும்; காசாளர் உறுதி செய்வார் (சுமார் 12 கிரெடிட்).",
  },
  {
    key: "product-tags",
    status: "live",
    tier: "vision",
    label: "Auto-tag product photos (clothing shops)",
    labelTa: "பொருள் புகைப்பட தானியங்கி குறிச்சொற்கள் (துணிக்கடைகள்)",
    description: "For clothing and textile shops: looks at product photos and drafts tags (colour, fabric, pattern, occasion, work, sleeve, neck) so shoppers can search and filter, for example \"red silk saree for wedding\". You approve each product; attributes you set yourself are never overwritten without your say (about 18 credits a photo).",
    descriptionTa: "துணிக்கடைகளுக்கு: பொருள் புகைப்படங்களைப் பார்த்து குறிச்சொற்களை (நிறம், துணி, வடிவம், நிகழ்வு, வேலைப்பாடு, கை, கழுத்து) வரைவாகத் தரும்; வாடிக்கையாளர்கள் \"திருமணத்துக்கு சிவப்பு பட்டுப்புடவை\" போலத் தேடலாம். ஒவ்வொரு பொருளையும் நீங்கள் ஒப்புக்கொள்வீர்கள்; நீங்களே அமைத்த பண்புகள் உங்கள் சம்மதமின்றி மாற்றப்படாது (ஒரு புகைப்படத்துக்கு சுமார் 18 கிரெடிட்).",
  },
  {
    key: "jewellery-huid",
    status: "live",
    tier: "vision",
    requires: ["jewellery"],
    label: "Read HUID from a hallmark photo",
    labelTa: "ஹால்மார்க் புகைப்படத்திலிருந்து HUID வாசிப்பு",
    description: "Reads the 6-character HUID and the purity mark from a close-up photo of the hallmark and fills the piece's HUID field as a draft (about 15 credits). The format is checked by the software; it never says a piece is BIS verified: check on the BIS CARE app.",
    descriptionTa: "ஹால்மார்க்கின் அருகில் எடுத்த புகைப்படத்திலிருந்து 6 எழுத்து HUID-யையும் தூய்மைக் குறியையும் படித்து, நகையின் HUID புலத்தை வரைவாக நிரப்பும் (சுமார் 15 கிரெடிட்). வடிவத்தை மென்பொருள் சரிபார்க்கும்; BIS சரிபார்க்கப்பட்டது என்று ஒருபோதும் சொல்லாது: BIS CARE செயலியில் சரிபார்க்கவும்.",
  },
  {
    key: "jewellery-breakup",
    status: "live",
    tier: "light",
    requires: ["jewellery"],
    label: "Jewellery price breakup for the customer",
    labelTa: "வாடிக்கையாளருக்கான நகை விலை விவரம்",
    description: "Shows how a piece's price is made up (metal at today's rate, wastage, making, stones, GST) and writes a friendly English and Tamil explanation to print or share (about 2 credits). Every number is worked out by the software and checked; no price predictions.",
    descriptionTa: "ஒரு நகையின் விலை எப்படி அமைகிறது (இன்றைய விலையில் உலோகம், வீணாக்கு, செய்கூலி, கற்கள், GST) என்பதைக் காட்டி, அச்சிட அல்லது பகிர நட்பான ஆங்கில, தமிழ் விளக்கத்தை எழுதும் (சுமார் 2 கிரெடிட்). எல்லா எண்களையும் மென்பொருள் கணக்கிட்டுச் சரிபார்க்கும்; விலை முன்னறிவிப்பு இல்லை.",
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
  // ---- Phase 4 part C: product photo cleanup (on our own server, no model call) and live try-on (on the shopper's phone)
  {
    key: "image-cleanup",
    status: "live",
    tier: "light",
    label: "Clean up product photos",
    labelTa: "பொருள் புகைப்படங்களைச் சுத்தம் செய்",
    description:
      "Removes the background from a product photo and puts the product on pure white, a soft shadow or a festive colour, centred and squared for your store. Runs on our own server (no AI model is called); your original is always kept and you choose which to use. Free by default.",
    descriptionTa:
      "பொருள் புகைப்படத்தின் பின்னணியை நீக்கி, பொருளை வெண்மை, மென்மையான நிழல் அல்லது பண்டிகை நிறத்தில் நடுவில் சதுரமாக அமைக்கும். எங்கள் சர்வரிலேயே நடக்கும் (AI மாடல் அழைக்கப்படாது); உங்கள் அசல் படம் எப்போதும் சேமிக்கப்படும். இயல்பாக இலவசம்.",
  },
  {
    key: "ar-tryon",
    status: "live",
    tier: "light",
    label: "Try it on (glasses and jewellery)",
    labelTa: "அணிந்து பார் (கண்ணாடி மற்றும் நகை)",
    description:
      "Lets shoppers try glasses, earrings, nose pins and necklaces on with their phone camera on your store's product page. It all happens on the shopper's phone: no camera picture or selfie is ever uploaded. Needs a try-on image on the product. No credits.",
    descriptionTa:
      "உங்கள் கடையின் பொருள் பக்கத்தில் வாடிக்கையாளர்கள் தங்கள் போன் கேமராவில் கண்ணாடி, காதணி, மூக்குத்தி, கழுத்தணியை அணிந்து பார்க்கலாம். எல்லாம் வாடிக்கையாளரின் போனிலேயே நடக்கும்: கேமரா படமோ செல்ஃபியோ பதிவேற்றப்படாது. பொருளில் try-on படம் தேவை. கிரெடிட் இல்லை.",
  },
  // ---- Phase 4 part A: the Studio assistant (changes how the shop looks and works, only through existing settings)
  {
    key: "studio-assistant",
    status: "live",
    tier: "standard",
    label: "Studio assistant",
    labelTa: "ஸ்டுடியோ உதவியாளர்",
    description:
      "Tell it in Tamil, Tanglish or English how you want your shop to look or work (theme, home page sections, menus, store settings, bills, roles, discount limits, sign-in). It shows a plan and a preview, changes nothing until you confirm, and can undo. It only uses settings the app already has, never code (about 15 to 40 credits a request; applying and undoing are free).",
    descriptionTa:
      "உங்கள் கடை எப்படித் தெரிய வேண்டும், எப்படி வேலை செய்ய வேண்டும் என்பதை தமிழ், தங்கிலிஷ் அல்லது ஆங்கிலத்தில் சொல்லுங்கள் (தீம், முகப்புப் பக்கப் பகுதிகள், மெனுக்கள், கடை அமைப்புகள், பில்கள், பணிகள், தள்ளுபடி வரம்பு, உள்நுழைவு). திட்டத்தையும் முன்னோட்டத்தையும் காட்டும்; நீங்கள் உறுதி செய்யும் வரை எதையும் மாற்றாது; Undo செய்யலாம். செயலியில் ஏற்கனவே உள்ள அமைப்புகளை மட்டுமே பயன்படுத்தும், குறியீட்டை ஒருபோதும் எழுதாது (ஒரு கோரிக்கைக்கு சுமார் 15 முதல் 40 கிரெடிட்; பயன்படுத்துதல், Undo இலவசம்).",
  },
  // ---- Phase 4 part B: store features (docs/ai.md "Phase 4 part B")
  ...STORE_REGISTRY,
  // ---- Phase 5 part B: money (credit risk, cash-flow forecast, loan pack, GSTR-2B explanations)
  ...MONEY_REGISTRY,
  // ---- Phase 5 part A: the counter (Tamil voice billing, unusual-activity alerts, staff coaching, shift planning)
  ...COUNTER_REGISTRY,
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
  /** Credits one run of an on-server helper costs (no model call), by registry key. Missing = free. Today: `image-cleanup`. */
  localCredits: z.record(z.string().regex(/^[a-z][a-z0-9-]{0,39}$/), z.number().int().min(0).max(20)).optional(),
  /** Daily summary: switch, time (IST), language and extra phones (see insights/daily-settings.ts). */
  dailySummary: DAILY_SUMMARY_SCHEMA.optional(),
  /** Shopper chat on the store: the most credits it may use a day (IST). Missing = 300. At the cap the chat goes back to the shop's people. */
  shopperChat: z.object({ dailyCredits: z.number().int().min(0).max(100_000) }).optional(),
  /** Counter helpers (Phase 5 part A): bills one person handles in an hour (shift planning; missing = the shop's own median) and whether the daily summary also lists unusual activity. */
  counter: z.object({ billsPerStaffHour: z.number().min(1).max(200).optional(), alertsInSummary: z.boolean().optional() }).optional(),
  /** Cash-flow forecast: cash and bank in hand on `asOf` (paise; null = not entered) and the warning level (paise). */
  cashflow: z.object({ openingBalance: z.number().int().nullable(), asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), asOfAt: z.string().nullable().optional(), minBalance: z.number().int().min(0) }).optional(),
});
export type AiSettings = z.infer<typeof AI_SETTINGS_SCHEMA>;
export const AI_SETTINGS_DEFAULTS: AiSettings = { enabled: false, features: {}, maskGstin: false, storePrompts: false };
