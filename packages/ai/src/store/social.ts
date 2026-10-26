import { z } from "zod";
import type { AiRunner } from "../assist/hsn";
import { DATA_RULES, dataBlock, filterClaims, neutralise, outputLooksInjected, sentences } from "../assist/safety";
import { hasTamil, inr } from "./common";

/**
 * Social posts for new arrivals (feature `social-posts`, light tier): Instagram and WhatsApp Status captions in English and
 * Tamil plus hashtags, written from the product's own facts and the shop's name. Nothing invented: promises and offers are
 * removed unless the shop's own facts state them (`filterClaims`), the only price is the product's, and "new" is only said
 * for a product that really is recent. The image is composed in code (packages/uploads `composeSocialImage`). No auto-posting:
 * the owner downloads or shares it.
 */
export const SOCIAL_FEATURE = "social-posts";
export const NEW_ARRIVAL_DAYS = 14;

export const SOCIAL_SYSTEM = [
  "You write social media captions for a small Indian shop to post about one product, in English and in natural, friendly Tamil (Tamil script, the way a shopkeeper would speak, not word for word).",
  "Use ONLY the facts you are given (product name, category, brand, attributes, price, whether it is a new arrival, the shop name and the shop's stated policies). Do not invent features, materials, quality, origin, offers, discounts, free delivery, returns, warranty, certifications, health benefits, 'limited stock' or 'last pieces'. A price may be written only exactly as given. Say 'new arrival' only when the facts say it is new.",
  "- instagram_en / instagram_ta: 2 to 4 short sentences, warm and clear, may use up to 2 fitting emojis, mention the shop name once, end with a simple invitation to visit, message or order (no phone numbers, no links, no @handles).",
  "- whatsapp_en / whatsapp_ta: ONE or two short lines for a WhatsApp Status: name, price if given, shop name.",
  "- hashtags: 6 to 10 relevant hashtags WITHOUT the # sign, letters and digits only (no spaces), mixing English words and a few Tamil-script words; never promotional ones (sale, offer, discount, free, cheap, best).",
  DATA_RULES,
].join("\n");

const Out = z.object({
  instagram_en: z.string(),
  instagram_ta: z.string(),
  whatsapp_en: z.string(),
  whatsapp_ta: z.string(),
  hashtags: z.array(z.string()),
});
export type SocialOutput = z.infer<typeof Out>;
const str = { type: "string" } as const;
export const SOCIAL_JSON = {
  type: "object",
  properties: { instagram_en: str, instagram_ta: str, whatsapp_en: str, whatsapp_ta: str, hashtags: { type: "array", items: str } },
  required: ["instagram_en", "instagram_ta", "whatsapp_en", "whatsapp_ta", "hashtags"],
  additionalProperties: false,
} as const;

export interface SocialProduct {
  id: string;
  name: string;
  category?: string | null;
  brand?: string | null;
  attributes?: Record<string, string> | null;
  tags?: string[] | null;
  /** Paise (cheapest variant). */
  price: number | null;
  /** Paise, when above the price. */
  mrp?: number | null;
  /** More than one price (variants). */
  priceFrom?: boolean;
  description?: string | null;
  imageUrl?: string | null;
  createdAt?: string | null;
}
export interface SocialShop {
  name: string;
  /** What the shop itself stated in its storefront settings (delivery, returns, pickup). Promises may repeat these and nothing else. */
  policies: string[];
}

export const isNewArrival = (createdAt: string | null | undefined, now: Date): boolean => !!createdAt && now.getTime() - Date.parse(createdAt) <= NEW_ARRIVAL_DAYS * 86_400_000 && Date.parse(createdAt) <= now.getTime() + 86_400_000;

/** Facts the model sees (and the claims filter treats as the shop's statements). */
export function socialFacts(p: SocialProduct, shop: SocialShop, now: Date): string {
  const lines = [
    `Product: ${neutralise(p.name).text}`,
    p.category ? `Category: ${neutralise(p.category).text}` : "",
    p.brand ? `Brand: ${neutralise(p.brand).text}` : "",
    ...Object.entries(p.attributes ?? {}).slice(0, 6).map(([k, v]) => `${neutralise(k).text}: ${neutralise(v).text}`),
    p.price != null ? `Price: ${p.priceFrom ? "from " : ""}${inr(p.price)}` : "",
    p.mrp && p.price != null && p.mrp > p.price ? `MRP: ${inr(p.mrp)}` : "",
    `New arrival: ${isNewArrival(p.createdAt, now) ? "yes" : "no"}`,
    p.description ? `About: ${neutralise(p.description.replace(/\s+/g, " ").slice(0, 280)).text}` : "",
    `Shop: ${neutralise(shop.name).text}`,
    ...shop.policies.map((x) => `Shop policy: ${x}`),
  ];
  return lines.filter(Boolean).join("\n");
}

const CONTACT = /@\w|https?:|www\.|\.com\b|\.in\b|(?:\+?91[- ]?)?\b\d{10}\b|\b\d{6,}\b/i;
const NEW_CLAIM = /\bnew (?:arrival|launch|stock|collection|in)s?\b|\bjust (?:arrived|landed|in)\b|புதிய வரவு|புதிதாக வந்த|புது வரவு/i;
const SCARCITY = /\b(limited (?:stock|time|edition|pieces)|last (?:few )?pieces|hurry|only \d+ (?:left|pieces)|while stocks last)\b|குறைந்த (?:கையிருப்பு|எண்ணிக்கை)|விரைவில் தீர/i;
const BAD_TAG = /^(sale|offer|offers|discount|free|cheap|cheapest|best|bestprice|lowestprice|giveaway|follow4follow|like4like)$/i;

/** One caption cleaned: contact details and scarcity lines out, unsupported promises out, "new" only for a new product. */
function cleanCaption(text: string, facts: string, isNew: boolean, removed: SocialDraft["removed"]): string {
  const kept: string[] = [];
  for (const s of sentences(text)) {
    if (CONTACT.test(s)) {
      removed.push({ sentence: s, reason: "contact" });
      continue;
    }
    if (SCARCITY.test(s)) {
      removed.push({ sentence: s, reason: "scarcity" });
      continue;
    }
    if (!isNew && NEW_CLAIM.test(s)) {
      removed.push({ sentence: s, reason: "not_new" });
      continue;
    }
    kept.push(s);
  }
  const f = filterClaims(kept.join(" "), facts);
  for (const r of f.removed) removed.push({ sentence: r.sentence, reason: r.reason });
  return f.text.replace(/\s{2,}/g, " ").trim();
}

/** Numbers in a caption other than the product's price/MRP and the shop's stated policy numbers are dropped with their sentence. */
function numbersOk(s: string, allowed: Set<string>): boolean {
  return (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).every((n) => allowed.has(n.replace(/,/g, "")));
}

export interface SocialDraft {
  instagram: { en: string; ta: string };
  whatsapp: { en: string; ta: string };
  hashtags: string[];
  /** Sentences taken out and why (for the review panel). */
  removed: { sentence: string; reason: string }[];
  /** The facts that went to the model (numbers the text may use). */
  isNew: boolean;
}

export function cleanSocial(o: SocialOutput, p: SocialProduct, shop: SocialShop, now: Date): SocialDraft {
  const facts = socialFacts(p, shop, now);
  const isNew = isNewArrival(p.createdAt, now);
  const removed: SocialDraft["removed"] = [];
  const allowed = new Set((facts.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "")));
  const caption = (t: string) => {
    const c = cleanCaption(t, facts, isNew, removed);
    return sentences(c)
      .filter((s) => {
        if (numbersOk(s, allowed)) return true;
        removed.push({ sentence: s, reason: "number_not_in_facts" });
        return false;
      })
      .join(" ");
  };
  const tags: string[] = [];
  for (const raw of o.hashtags.slice(0, 20)) {
    const t = raw.normalize("NFC").replace(/^#+/, "").replace(/[^\p{L}\p{M}\p{N}_]+/gu, "");
    if (t.length < 2 || t.length > 30 || BAD_TAG.test(t) || tags.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
    tags.push(t);
  }
  return {
    instagram: { en: caption(o.instagram_en), ta: caption(o.instagram_ta) },
    whatsapp: { en: caption(o.whatsapp_en), ta: caption(o.whatsapp_ta) },
    hashtags: tags.slice(0, 10),
    removed,
    isNew,
  };
}

/** The plain text used when the AI is off, empty after cleaning, or a language is missing: name, price, shop. */
export function templateSocial(p: SocialProduct, shop: SocialShop, now: Date): SocialDraft {
  const price = p.price != null ? `${p.priceFrom ? "from " : ""}${inr(p.price)}` : "";
  const tail = shop.name;
  const isNew = isNewArrival(p.createdAt, now);
  return {
    instagram: {
      en: `${isNew ? "New arrival: " : ""}${p.name}${price ? ` - ${price}` : ""}. Available at ${tail}. Visit us or send a message to order.`,
      ta: `${isNew ? "புதிய வரவு: " : ""}${p.name}${price ? ` - ${p.priceFrom ? "தொடக்க விலை " : ""}${inr(p.price!)}` : ""}. ${tail} கடையில் கிடைக்கும். நேரில் வாருங்கள் அல்லது செய்தி அனுப்புங்கள்.`,
    },
    whatsapp: {
      en: `${p.name}${price ? ` - ${price}` : ""}\n${tail}`,
      ta: `${p.name}${price ? ` - ${inr(p.price!)}` : ""}\n${tail}`,
    },
    hashtags: [],
    removed: [],
    isNew,
  };
}

export interface SocialResult {
  draft: SocialDraft;
  source: "ai" | "template";
  runId: string | null;
  credits: number;
}

/** Captions for one product. Falls back per field to the plain template when cleaning emptied it or Tamil is not Tamil. */
export async function writeSocial(ai: AiRunner, p: { tenantId: string; userId?: string | null; product: SocialProduct; shop: SocialShop; now: Date }): Promise<SocialResult> {
  const facts = socialFacts(p.product, p.shop, p.now);
  const payloads = [...neutralise(p.product.name).payloads, ...(p.product.description ? neutralise(p.product.description).payloads : [])];
  const r = await ai.run<SocialOutput>({
    tenantId: p.tenantId,
    userId: p.userId ?? null,
    feature: SOCIAL_FEATURE,
    tier: "light",
    effort: "low",
    system: SOCIAL_SYSTEM,
    input: { text: dataBlock("product and shop facts", facts) },
    schema: { name: "social_post", jsonSchema: SOCIAL_JSON as unknown as Record<string, unknown>, zod: Out },
    maxTokens: 3000,
  });
  const tpl = templateSocial(p.product, p.shop, p.now);
  if (outputLooksInjected(r.output, payloads)) return { draft: tpl, source: "template", runId: r.runId, credits: r.credits };
  const c = cleanSocial(r.output, p.product, p.shop, p.now);
  const pick = (got: string, fallback: string, needTamil = false) => (got && (!needTamil || hasTamil(got)) ? got : fallback);
  const draft: SocialDraft = {
    instagram: { en: pick(c.instagram.en, tpl.instagram.en), ta: pick(c.instagram.ta, tpl.instagram.ta, true) },
    whatsapp: { en: pick(c.whatsapp.en, tpl.whatsapp.en), ta: pick(c.whatsapp.ta, tpl.whatsapp.ta, true) },
    hashtags: c.hashtags,
    removed: c.removed,
    isNew: c.isNew,
  };
  return { draft, source: "ai", runId: r.runId, credits: r.credits };
}
