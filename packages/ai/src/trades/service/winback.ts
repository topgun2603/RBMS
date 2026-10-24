import { z } from "zod";
import type { AiRunner } from "../../assist/hsn";
import { DATA_RULES, dataBlock, filterClaims, neutralise, outputLooksInjected } from "../../assist/safety";
import { allowedNumbers, checkNumbers } from "../../insights/numbers";
import type { AiSchema } from "../../types";

/**
 * Phase 3 part C, salon / spa / gym: members and clients who are drifting away. WHO is at risk is computed in code from the
 * shop's own memberships, check-ins and appointments (a fixed clock makes it testable); the light tier only writes a short personal
 * message per person, and the owner reviews it and sends it through the WhatsApp path (or copies it). No offer is ever invented:
 * the only offer in a message is the one the owner typed. Opted-out people are listed (so the owner knows) but cannot be drafted.
 */
export const WINBACK_FEATURE = "winback-message";

export const AT_RISK_REASONS = ["expiring", "lapsed", "visits_dropped", "gone_quiet"] as const;
export type AtRiskReason = (typeof AT_RISK_REASONS)[number];

/** One person with what the shop knows about them (built by SQL in the API; dates are IST calendar days). */
export interface PersonHistory {
  /** Stable key: "m:<memberId>" for a member, "p:<phone>" for a booking client without a membership. */
  key: string;
  name: string;
  phone: string | null;
  kind: "member" | "client";
  /** The newest membership, when they have one. */
  plan: { name: string; start: string; end: string; status: "active" | "frozen" | "cancelled" } | null;
  /** True when a newer plan started after this one ended (they renewed). Set by the query by looking at later rows. */
  renewed: boolean;
  /** Visit days (check-ins and completed appointments), any order, last ~400 days. */
  visits: string[];
  /** Service names with how many times (appointments, plans), most frequent first. */
  services: { name: string; count: number }[];
  optedOut: boolean;
}

export interface AtRiskClient {
  key: string;
  name: string;
  phone: string | null;
  kind: "member" | "client";
  reasons: { code: AtRiskReason; days?: number; planName?: string; date?: string }[];
  /** Days since the last visit; null = never visited. */
  daysSinceLast: number | null;
  lastVisit: string | null;
  /** Median days between visits, when there are at least 3. */
  usualGapDays: number | null;
  visitsLast30: number;
  /** Visits per 30 days in the 90 days before that. */
  usualPer30: number | null;
  usualServices: string[];
  plan: { name: string; end: string } | null;
  optedOut: boolean;
  noPhone: boolean;
  /** Higher = more urgent. */
  score: number;
}

export const AT_RISK = { expiringDays: 14, lapsedDays: 60, gapMultiple: 2, maxQuietDays: 180, minVisitsForCadence: 3, droppedRatio: 0.5, baselineMin: 3 } as const;

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const dayDiff = (from: string, to: string) => Math.round((ms(to) - ms(from)) / DAY);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Visit gaps in days between consecutive distinct visit days. */
export function visitGaps(visits: string[]): number[] {
  const days = [...new Set(visits)].sort();
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) gaps.push(dayDiff(days[i - 1]!, days[i]!));
  return gaps;
}

/** Works out why (if at all) one person is at risk on `today`. Null = fine. Pure. */
export function assessPerson(p: PersonHistory, today: string): AtRiskClient | null {
  const days = [...new Set(p.visits)].filter((d) => d <= today).sort();
  const last = days.at(-1) ?? null;
  const daysSinceLast = last ? dayDiff(last, today) : null;
  const gaps = visitGaps(days.filter((d) => dayDiff(d, today) <= 400));
  const usualGap = gaps.length >= AT_RISK.minVisitsForCadence - 1 ? Math.max(3, median(gaps)) : null;
  const inRange = (from: number, to: number) => days.filter((d) => dayDiff(d, today) >= from && dayDiff(d, today) <= to).length;
  const visitsLast30 = inRange(0, 29);
  const prior90 = inRange(30, 119);
  const usualPer30 = prior90 > 0 ? Math.round((prior90 / 3) * 10) / 10 : null;

  const reasons: AtRiskClient["reasons"] = [];
  const plan = p.plan && p.plan.status !== "cancelled" ? p.plan : null;
  if (plan && plan.status === "active" && !p.renewed) {
    const left = dayDiff(today, plan.end);
    if (left >= 0 && left <= AT_RISK.expiringDays) reasons.push({ code: "expiring", days: left, planName: plan.name, date: plan.end });
    else if (left < 0 && -left <= AT_RISK.lapsedDays) reasons.push({ code: "lapsed", days: -left, planName: plan.name, date: plan.end });
  }
  if (usualPer30 !== null && prior90 >= AT_RISK.baselineMin && visitsLast30 <= usualPer30 * AT_RISK.droppedRatio && visitsLast30 < usualPer30) {
    reasons.push({ code: "visits_dropped" });
  }
  if (usualGap !== null && daysSinceLast !== null && daysSinceLast > usualGap * AT_RISK.gapMultiple && daysSinceLast <= AT_RISK.maxQuietDays) {
    reasons.push({ code: "gone_quiet", days: daysSinceLast });
  }
  // A frozen plan is a pause the member asked for; nothing to win back.
  if (reasons.length === 0 || (p.plan?.status === "frozen" && !reasons.some((r) => r.code === "gone_quiet"))) return null;

  const weight: Record<AtRiskReason, number> = { expiring: 50, lapsed: 40, gone_quiet: 30, visits_dropped: 20 };
  const score = reasons.reduce((s, r) => s + weight[r.code], 0) + (p.kind === "member" ? 5 : 0) + Math.min(10, Math.round((usualPer30 ?? 0) * 2));
  return {
    key: p.key,
    name: p.name,
    phone: p.phone,
    kind: p.kind,
    reasons,
    daysSinceLast,
    lastVisit: last,
    usualGapDays: usualGap === null ? null : Math.round(usualGap),
    visitsLast30,
    usualPer30,
    usualServices: [...p.services].sort((a, b) => b.count - a.count).slice(0, 3).map((s) => s.name),
    plan: p.plan ? { name: p.plan.name, end: p.plan.end } : null,
    optedOut: p.optedOut,
    noPhone: !p.phone,
    score,
  };
}

export function computeAtRisk(people: PersonHistory[], today: string): AtRiskClient[] {
  return people
    .map((p) => assessPerson(p, today))
    .filter((x): x is AtRiskClient => x !== null)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------ the message

export const WINBACK_SYSTEM = [
  "You write one short, warm WhatsApp message from a salon, spa or gym to a member or client who has not been coming lately. Write in the requested language (en = simple English, ta = natural spoken-style Tamil in Tamil script). Address the person with the placeholder {name} exactly once at the start (a greeting then {name}).",
  "Use only the facts given: the shop name, how long since the last visit, the usual services, the plan and its date. Say you miss them or invite them back; mention a usual service naturally if one is given. At most 3 short sentences and no more than 280 characters.",
  "NEVER invent or imply any offer, discount, free service, gift, price, package, deadline or promise. Only if a block called \"owner offer\" is given may you mention that offer, in its own words and numbers, and nothing else. Do not give phone numbers, links or addresses. Do not mention health, weight or body shape. Do not guilt or pressure the person.",
  DATA_RULES,
].join("\n");

const Out = z.object({ message: z.string() });
export type WinbackOut = z.infer<typeof Out>;
export const WINBACK_SCHEMA: AiSchema<WinbackOut> = {
  name: "winback_message",
  jsonSchema: { type: "object", additionalProperties: false, required: ["message"], properties: { message: { type: "string" } } },
  zod: Out,
};

export interface WinbackDraft {
  /** The message with the person's first name filled in, ready for the owner to edit. */
  message: string;
  /** The same message with {name} left in (for a template or campaign). */
  template: string;
  language: "en" | "ta";
  usedOffer: boolean;
  removed: { sentence: string; reason: string }[];
  fallback: boolean;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** The deterministic message used when the model's text is unusable. No offers, no numbers. */
export function templateWinback(c: Pick<AtRiskClient, "usualServices">, shop: string, language: "en" | "ta", offer: string | null): string {
  const svc = c.usualServices[0];
  const base =
    language === "ta"
      ? `வணக்கம் {name}, ${shop}-இல் உங்களைப் பார்த்து நாளாகிவிட்டது.${svc ? ` ${svc} செய்ய மீண்டும் வாருங்கள்.` : " மீண்டும் வாருங்கள்."}`
      : `Hi {name}, we miss you at ${shop}.${svc ? ` Come back soon for your ${svc}.` : " Hope to see you soon."}`;
  return offer ? `${base} ${offer}` : base;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f‎‏‪-‮<>]/g;
const CONTACT = /(https?:\/\/\S+|www\.\S+|\+?\d[\d\s-]{8,}\d|[\w.+-]+@[\w-]+\.\w+)/g;

/** Facts sheet for the number check and claims filter: only what the owner typed or the shop's data says. */
export function winbackFacts(c: AtRiskClient, shop: string, offer: string | null): string {
  const lines = [`Shop: ${shop}`];
  if (c.daysSinceLast !== null) lines.push(`Days since last visit: ${c.daysSinceLast}`);
  if (c.plan) lines.push(`Plan: ${c.plan.name} until ${c.plan.end}`);
  if (c.usualServices.length) lines.push(`Usual services: ${c.usualServices.join(", ")}`);
  if (offer) lines.push(`Offer: ${offer}`);
  return lines.join("\n");
}

export async function draftWinback(
  ai: AiRunner,
  req: { tenantId: string; userId?: string | null; client: AtRiskClient; shop: string; language: "en" | "ta"; offer?: string | null },
): Promise<{ draft: WinbackDraft; runId: string; credits: number; provider: "claude" | "mock" }> {
  const c = req.client;
  if (c.optedOut) throw new Error("opted_out");
  const offerN = req.offer ? neutralise(req.offer) : null;
  const offer = offerN && offerN.text ? offerN.text.slice(0, 160) : null;
  const facts = winbackFacts(c, req.shop, offer);
  const why = c.reasons.map((r) => (r.code === "expiring" ? `plan ends in ${r.days} days` : r.code === "lapsed" ? `plan ended ${r.days} days ago` : r.code === "gone_quiet" ? `no visit for ${r.days} days` : "visits have dropped")).join("; ");
  const text = [
    `Language: ${req.language}`,
    dataBlock("shop", neutralise(req.shop).text),
    dataBlock("client facts", [`why: ${why}`, c.daysSinceLast !== null ? `days since last visit: ${c.daysSinceLast}` : "", c.plan ? `plan: ${neutralise(c.plan.name).text} ends ${c.plan.end}` : "", c.usualServices.length ? `usual services: ${c.usualServices.map((s) => neutralise(s).text).join(", ")}` : ""].filter(Boolean).join("\n")),
    offer ? dataBlock("owner offer", offer) : "No owner offer: do not mention any offer, discount or free item.",
  ].join("\n");
  const r = await ai.run({
    tenantId: req.tenantId,
    userId: req.userId ?? null,
    feature: WINBACK_FEATURE,
    tier: "light",
    system: WINBACK_SYSTEM,
    input: { text },
    schema: WINBACK_SCHEMA,
    maxTokens: 2000,
    effort: "low",
  });
  const removed: WinbackDraft["removed"] = [];
  let msg = r.output.message.replace(CONTROL, " ").replace(CONTACT, "").replace(/[ \t]+/g, " ").trim();
  let fallback = false;
  if (outputLooksInjected(msg, [])) fallback = true;
  if (!fallback) {
    const claims = filterClaims(msg, facts);
    for (const x of claims.removed) removed.push({ sentence: x.sentence, reason: x.kinds.join("+") });
    msg = claims.text;
    const bad = checkNumbers(msg, allowedNumbers(facts, [1])).unknown;
    if (bad.length) {
      removed.push({ sentence: msg, reason: `numbers:${bad.join(",")}` });
      fallback = true;
    }
  }
  if (!fallback && (!msg.includes("{name}") || msg.length < 12)) {
    if (msg.length < 12) fallback = true;
    else msg = req.language === "ta" ? `வணக்கம் {name}, ${msg}` : `Hi {name}, ${msg}`;
  }
  if (fallback) msg = templateWinback(c, req.shop, req.language, offer);
  msg = msg.replace(/\{name\}/g, "{name}").slice(0, 600);
  return {
    draft: { template: msg, message: msg.replaceAll("{name}", firstName(c.name)), language: req.language, usedOffer: !!offer && msg.includes(offer.slice(0, 20)), removed, fallback },
    runId: r.runId,
    credits: r.credits,
    provider: r.provider,
  };
}
