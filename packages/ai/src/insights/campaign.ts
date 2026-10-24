import { z } from "zod";
import { AppError, badRequest } from "@srirealtime/core";
import type { AiRunner } from "../assist/hsn";
import { DATA_RULES, dataBlock, filterClaims, neutralise, outputLooksInjected, sentences } from "../assist/safety";
import { indianPhone } from "./daily-settings";
import { allowedNumbers, checkNumbers } from "./numbers";

/**
 * WhatsApp campaign writer. The AI drafts the wording only, from what the owner typed as the goal: any claim (offer,
 * discount, delivery, guarantee ...) and any number it writes must come from that goal, otherwise the sentence is removed.
 * The customer segment and the send time are worked out in code from purchase history; the AI only names the product
 * words (copied from the goal). Nothing is sent: the owner reviews and sends through the normal campaign screens.
 */

export const CAMPAIGN_FEATURE = "campaign-writer";

/** WhatsApp template bodies are limited to 1024 characters; shorter messages are read. */
export const LIMITS = { whatsapp: 600, smsEn: 160, smsTa: 200, name: 60 } as const;

export interface SegmentSpec {
  /** Product words (from the goal) a customer must have bought; empty = any purchase. */
  keywords: string[];
  sinceMonths: number;
  /** Visits (bill dates) in the window. */
  minVisits: number;
  /** Lapsed customers only: bought before but nothing in the last N days. */
  lapsedDays: number | null;
  /** Skip anyone messaged in the last N days. */
  notMessagedDays: number;
}

export type AudienceKind = "regular" | "all" | "lapsed";

export const DEFAULT_SINCE_MONTHS = 6;
export const DEFAULT_NOT_MESSAGED_DAYS = 14;

/** Builds the segment from the AI's audience pick and keywords. Keywords must really be in the goal. */
export function buildSegmentSpec(goal: string, audience: AudienceKind, keywords: string[]): SegmentSpec {
  const g = goal.toLowerCase();
  const kws = [...new Set(keywords.map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 3 && k.length <= 30))]
    .filter((k) => g.includes(k) || g.includes(stem(k)))
    .slice(0, 4);
  return {
    keywords: kws,
    sinceMonths: audience === "lapsed" ? 12 : DEFAULT_SINCE_MONTHS,
    minVisits: audience === "regular" ? 3 : 1,
    lapsedDays: audience === "lapsed" ? 90 : null,
    notMessagedDays: DEFAULT_NOT_MESSAGED_DAYS,
  };
}

/** "sarees" -> "saree", "shirts" -> "shirt": enough to match item names by substring. */
export function stem(w: string): string {
  const x = w.toLowerCase().trim();
  if (x.endsWith("ies") && x.length > 4) return `${x.slice(0, -3)}y`;
  if (x.endsWith("es") && x.length > 4 && /(ss|sh|ch|x|z)es$/.test(x)) return x.slice(0, -2);
  if (x.endsWith("s") && x.length > 3 && !x.endsWith("ss")) return x.slice(0, -1);
  return x;
}

/** One customer as the API summarises them from bills, messages and opt-outs. */
export interface SegCustomer {
  id: string;
  name: string;
  phone: string | null;
  /** Distinct bill dates in the window. */
  visits: number;
  /** Bought something matching the keywords inside the window. */
  matched: boolean;
  /** Date of the last bill (YYYY-MM-DD) or null. */
  lastVisit: string | null;
  /** Last time any campaign / marketing message reached them, or null. */
  lastMessagedAt: string | null;
  optedOut: boolean;
}

export interface SegmentResult {
  members: { id: string; name: string; phone: string }[];
  counts: { considered: number; matched: number; noPhone: number; optedOut: number; recentlyMessaged: number; final: number };
}

const DAY = 86_400_000;
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Applies the segment rules to the customers' summaries. Pure: opt-outs and recent messages are always excluded. */
export function applySegment(rows: SegCustomer[], spec: SegmentSpec, today: string): SegmentResult {
  const counts = { considered: rows.length, matched: 0, noPhone: 0, optedOut: 0, recentlyMessaged: 0, final: 0 };
  const members: SegmentResult["members"] = [];
  const t = dayMs(today);
  for (const c of rows) {
    if (spec.keywords.length > 0 && !c.matched) continue;
    if (c.visits < spec.minVisits) continue;
    if (spec.lapsedDays !== null) {
      if (!c.lastVisit || (t - dayMs(c.lastVisit)) / DAY < spec.lapsedDays) continue;
    }
    counts.matched++;
    const phone = indianPhone(c.phone);
    if (!phone) {
      counts.noPhone++;
      continue;
    }
    if (c.optedOut) {
      counts.optedOut++;
      continue;
    }
    if (c.lastMessagedAt && (t - dayMs(c.lastMessagedAt.slice(0, 10))) / DAY < spec.notMessagedDays) {
      counts.recentlyMessaged++;
      continue;
    }
    members.push({ id: c.id, name: c.name, phone });
  }
  // One row per phone (families share a number).
  const seen = new Set<string>();
  const unique = members.filter((m) => (seen.has(m.phone) ? false : (seen.add(m.phone), true)));
  counts.final = unique.length;
  return { members: unique, counts };
}

/** Best time to send: an hour before the shop's busiest billing hour, never before 9:00 or after 19:00 IST; always in the future. */
export function suggestSendTime(now: Date, peakHour: number | null): { iso: string; hour: number; basis: "peak" | "default" } {
  const hour = peakHour === null ? 11 : Math.min(19, Math.max(9, peakHour - 1));
  const IST = 330 * 60_000;
  const local = new Date(now.getTime() + IST);
  let at = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, 0, 0) - IST;
  if (at < now.getTime() + 30 * 60_000) at += DAY;
  return { iso: new Date(at).toISOString(), hour, basis: peakHour === null ? "default" : "peak" };
}

// ------------------------------------------------------------------ the AI draft

export const CAMPAIGN_SYSTEM = [
  "You write WhatsApp marketing messages for a small Indian shop, in English and in natural spoken Tamil (Tamil script, the way a shopkeeper would talk, not word-for-word translation).",
  "The owner's goal is the ONLY source of facts. You may mention an offer, discount, price, date, delivery, warranty or any other promise ONLY if the owner's goal states it, with exactly the same numbers. Never invent an offer, a percentage, a date, a deadline, a coupon code, free gifts, delivery, a price or a guarantee. If the goal is thin, write a short warm message without extra claims.",
  `Each WhatsApp message: a greeting that uses the placeholder {{1}} once for the customer's name (for example "Hi {{1}},"), then at most 3 short sentences, then a friendly closing line with the shop name. At most ${LIMITS.whatsapp} characters. No other placeholders, no links, no phone numbers, no emojis except at most one.`,
  `SMS versions: sms_en at most ${LIMITS.smsEn} characters in plain English letters; sms_ta at most ${LIMITS.smsTa} characters in Tamil. No placeholders in SMS.`,
  "name: a short internal campaign name (at most 50 characters).",
  "audience: 'regular' if the goal is for regular / loyal / repeat customers, 'lapsed' if it is to bring back customers who stopped coming, else 'all'. product_keywords: up to 4 product words copied from the goal (singular, lower case, for example 'saree'); empty if the goal names no product.",
  DATA_RULES,
].join("\n");

const Out = z.object({
  name: z.string(),
  message_en: z.string(),
  message_ta: z.string(),
  sms_en: z.string(),
  sms_ta: z.string(),
  audience: z.enum(["regular", "all", "lapsed"]),
  product_keywords: z.array(z.string()).max(6),
});
export type CampaignOutput = z.infer<typeof Out>;
const str = { type: "string" } as const;
const OUT_JSON = {
  type: "object",
  properties: {
    name: str,
    message_en: str,
    message_ta: str,
    sms_en: str,
    sms_ta: str,
    audience: { type: "string", enum: ["regular", "all", "lapsed"] },
    product_keywords: { type: "array", items: str },
  },
  required: ["name", "message_en", "message_ta", "sms_en", "sms_ta", "audience", "product_keywords"],
  additionalProperties: false,
} as const;

const CONTACT = /[\w.+-]+@[\w-]+\.[\w.-]+|https?:\/\/\S+|www\.\S+|(?:\+?\d[\d\s-]{7,}\d)|X{3,}\d{2,}|\w\*{3}@/;

export interface CampaignDraft {
  name: string;
  messageEn: string;
  messageTa: string;
  smsEn: string;
  smsTa: string;
  /** Sentences removed because the goal did not say them, with why. */
  removed: { sentence: string; reason: "not_in_goal" | "number_not_in_goal" | "contact" | "too_long" }[];
  /** Fields replaced by the plain template (nothing usable was left). */
  templated: ("en" | "ta" | "smsEn" | "smsTa")[];
}

/** Keeps only `{{1}}`; every other placeholder is removed. */
const onlyFirstPlaceholder = (s: string) => {
  let seen = false;
  return s
    .replace(/\{\{\s*([^}]*)\s*\}\}/g, (_m, g: string) => (g.trim() === "1" && !seen ? ((seen = true), "{{1}}") : ""))
    .replace(/\s{2,}/g, " ")
    .trim();
};

function fit(text: string, max: number): { text: string; cut: string[] } {
  const parts = sentences(text);
  const keep: string[] = [];
  const cut: string[] = [];
  for (const p of parts) {
    if ([...keep, p].join(" ").length <= max) keep.push(p);
    else cut.push(p);
  }
  return { text: keep.join(" "), cut };
}

/** The plain fallback message when nothing from the AI survives: the owner's own goal and the shop name. */
export function templateMessage(goal: string, shop: string, lang: "en" | "ta"): string {
  const g = neutralise(goal).text.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  return lang === "ta" ? `வணக்கம் {{1}}, ${g}. - ${shop}` : `Hi {{1}}, ${g}. - ${shop}`;
}

/**
 * Cleans a draft against the owner's goal (pure; tested): removes sentences that carry a claim the goal did not make, numbers
 * the goal does not contain, contact details; trims to the length limits; falls back to the template per field.
 */
export function cleanCampaign(out: CampaignOutput, goalText: string, shop: string): CampaignDraft {
  const removed: CampaignDraft["removed"] = [];
  // The whole goal is the owner's statement of fact, so words like "write" or "promise" in it must not hide it from the claims filter.
  const goal = goalText.replace(/\b(write|say|add|mention|include|put|state|claim|promise|tell)\b/gi, " ");
  const allowed = allowedNumbers(goal);
  const clean = (raw: string, max: number): { text: string; empty: boolean } => {
    const withoutVars = onlyFirstPlaceholder(raw);
    const kept: string[] = [];
    for (const s of sentences(withoutVars)) {
      if (CONTACT.test(s)) {
        removed.push({ sentence: s, reason: "contact" });
        continue;
      }
      if (!checkNumbers(s, allowed).ok) {
        removed.push({ sentence: s, reason: "number_not_in_goal" });
        continue;
      }
      const f = filterClaims(s.replace(/\{\{\s*1\s*\}\}/g, "NAME"), goal);
      if (f.removed.length) {
        removed.push({ sentence: s, reason: "not_in_goal" });
        continue;
      }
      kept.push(s);
    }
    const f = fit(kept.join(" "), max);
    for (const c of f.cut) removed.push({ sentence: c, reason: "too_long" });
    return { text: f.text, empty: f.text.trim().length === 0 };
  };
  const templated: CampaignDraft["templated"] = [];
  const en = clean(out.message_en, LIMITS.whatsapp);
  const ta = clean(out.message_ta, LIMITS.whatsapp);
  const sEn = clean(out.sms_en, LIMITS.smsEn);
  const sTa = clean(out.sms_ta, LIMITS.smsTa);
  const tpl = (lang: "en" | "ta", max: number) => fit(templateMessage(goalText, shop, lang), max).text || templateMessage(goalText, shop, lang).slice(0, max);
  const messageEn = en.empty ? (templated.push("en"), tpl("en", LIMITS.whatsapp)) : en.text;
  const messageTa = ta.empty ? (templated.push("ta"), tpl("ta", LIMITS.whatsapp)) : ta.text;
  const smsEn = sEn.empty ? (templated.push("smsEn"), tpl("en", LIMITS.smsEn).replace(/\{\{1\}\}/g, "").replace(/\s{2,}/g, " ").trim()) : sEn.text.replace(/\{\{1\}\}/g, "").replace(/\s{2,}/g, " ").trim();
  const smsTa = sTa.empty ? (templated.push("smsTa"), tpl("ta", LIMITS.smsTa).replace(/\{\{1\}\}/g, "").replace(/\s{2,}/g, " ").trim()) : sTa.text.replace(/\{\{1\}\}/g, "").replace(/\s{2,}/g, " ").trim();
  return { name: out.name.replace(/\s+/g, " ").trim().slice(0, LIMITS.name) || neutralise(goal).text.slice(0, LIMITS.name), messageEn, messageTa, smsEn, smsTa, removed, templated };
}

export interface CampaignDraftResult {
  draft: CampaignDraft;
  spec: SegmentSpec;
  audience: AudienceKind;
  runId: string;
  credits: number;
}

export async function draftCampaign(ai: AiRunner, req: { tenantId: string; userId?: string | null; goal: string; shop: string; trade?: string | null }): Promise<CampaignDraftResult> {
  const goal = req.goal.replace(/\s+/g, " ").trim();
  if (goal.length < 8) throw badRequest("Tell us what the campaign is for, for example: Pongal offer 10% on sarees for regular customers");
  if (goal.length > 600) throw badRequest("Please keep the goal under 600 characters");
  const n = neutralise(goal);
  const r = await ai.run<CampaignOutput>({
    tenantId: req.tenantId,
    userId: req.userId ?? null,
    feature: CAMPAIGN_FEATURE,
    tier: "standard",
    effort: "low",
    system: CAMPAIGN_SYSTEM,
    input: { text: [dataBlock("owner goal", n.text || goal), `Shop name: ${neutralise(req.shop).text}`, req.trade ? `Shop trade: ${req.trade}` : ""].filter(Boolean).join("\n") },
    schema: { name: "campaign_draft", jsonSchema: OUT_JSON as unknown as Record<string, unknown>, zod: Out },
    maxTokens: 3500,
  });
  if (outputLooksInjected(r.output, n.payloads)) {
    throw new AppError(502, "ai_invalid_output", "The AI gave an answer we could not use. Please try again.", { runId: r.runId });
  }
  // The claims filter reads the goal as the facts; instruction-looking sentences in it are not facts (safety.ts).
  const draft = cleanCampaign(r.output, goal, req.shop);
  return { draft, spec: buildSegmentSpec(goal, r.output.audience, r.output.product_keywords), audience: r.output.audience, runId: r.runId, credits: r.credits };
}
