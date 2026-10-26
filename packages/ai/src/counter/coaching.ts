import { z } from "zod";
import type { AiRunner } from "../assist/hsn";
import { DATA_RULES, dataBlock, neutralise, outputLooksInjected } from "../assist/safety";
import { cleanLine } from "../insights/summary";
import { allowedNumbers, checkNumbers, rupees } from "../insights/numbers";
import { hourLabel } from "./shifts";
import { sum } from "./stats";

/**
 * Weekly staff coaching notes (feature `staff-coaching`, light tier). The facts (bills, average bill, items per bill, cancelled
 * bills, discounts against the shop's average, busiest hours) are counted in code. The model only turns a facts sheet into two
 * or three constructive sentences; every number in them must be in the sheet, and wording that judges the person (lazy,
 * careless, suspicious...) throws the text away for a plain template. Owners and managers see these notes; nobody else does.
 */

export const COACHING_FEATURE = "staff-coaching";
export type CoachLang = "en" | "ta";

/** One person's week, counted from the database. */
export interface StaffWeek {
  staff: string;
  name: string;
  bills: number;
  /** Paise: sum of the bills' totals. */
  amount: number;
  /** Item lines on those bills. */
  lines: number;
  voids: number;
  returns: number;
  discountAmount: number;
  grossAmount: number;
  /** Bills by hour of day (IST), 24 entries. */
  hourBills: number[];
  daysWorked: number;
}

export interface CoachFacts {
  weekStart: string;
  weekEnd: string;
  person: StaffWeek;
  /** The same person the week before (null when none). */
  previous: StaffWeek | null;
  /** All people with bills that week (this person included). */
  team: StaffWeek[];
}

export interface CoachMetrics {
  enough: boolean;
  bills: number;
  billsPerDay: number;
  avgBill: number;
  itemsPerBill: number;
  voidRatePct: number;
  discountSharePct: number;
  returnsRatePct: number;
  busiest: number[];
  shop: { people: number; billsPerPerson: number; avgBill: number; itemsPerBill: number; voidRatePct: number; discountSharePct: number };
  billsVsLastWeekPct: number | null;
}

export const MIN_BILLS = 20;
const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

export function coachMetrics(f: CoachFacts): CoachMetrics {
  const p = f.person;
  const team = f.team.length ? f.team : [p];
  const tBills = sum(team.map((t) => t.bills));
  const tLines = sum(team.map((t) => t.lines));
  const tAmount = sum(team.map((t) => t.amount));
  const busiest = p.hourBills
    .map((n, h) => ({ n, h }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.h - b.h)
    .slice(0, 2)
    .map((x) => x.h)
    .sort((a, b) => a - b);
  return {
    enough: p.bills >= MIN_BILLS,
    bills: p.bills,
    billsPerDay: r1(p.daysWorked > 0 ? p.bills / p.daysWorked : 0),
    avgBill: p.bills > 0 ? Math.round(p.amount / p.bills) : 0,
    itemsPerBill: r1(p.bills > 0 ? p.lines / p.bills : 0),
    voidRatePct: r1(pct(p.voids, p.bills)),
    discountSharePct: r1(pct(p.discountAmount, p.grossAmount)),
    returnsRatePct: r1(pct(p.returns, p.bills)),
    busiest,
    shop: {
      people: team.length,
      billsPerPerson: r1(tBills / team.length),
      avgBill: tBills > 0 ? Math.round(tAmount / tBills) : 0,
      itemsPerBill: r1(tBills > 0 ? tLines / tBills : 0),
      voidRatePct: r1(pct(sum(team.map((t) => t.voids)), tBills)),
      discountSharePct: r1(pct(sum(team.map((t) => t.discountAmount)), sum(team.map((t) => t.grossAmount)))),
    },
    billsVsLastWeekPct: f.previous && f.previous.bills > 0 ? Math.round(((p.bills - f.previous.bills) / f.previous.bills) * 100) : null,
  };
}

/** The facts as plain lines. The model sees only this, and may only use these numbers. */
export function coachSheet(f: CoachFacts, m: CoachMetrics): string {
  const L: string[] = [];
  const name = neutralise(f.person.name).text || "this person";
  L.push(`Person: ${name}`);
  L.push(`Week: ${f.weekStart} to ${f.weekEnd}`);
  L.push(`Bills: ${m.bills} over ${f.person.daysWorked} days (${m.billsPerDay} a day)`);
  L.push(`Average bill: ${rupees(m.avgBill)} (shop average ${rupees(m.shop.avgBill)})`);
  L.push(`Items per bill: ${m.itemsPerBill} (shop average ${m.shop.itemsPerBill})`);
  L.push(`Cancelled bills: ${f.person.voids} (${m.voidRatePct}% of their bills; shop ${m.shop.voidRatePct}%)`);
  L.push(`Discounts: ${m.discountSharePct}% of sales value (shop ${m.shop.discountSharePct}%)`);
  if (f.person.returns > 0) L.push(`Returns taken: ${f.person.returns}`);
  if (m.busiest.length) L.push(`Busiest hours: ${m.busiest.map((h) => hourLabel(h)).join(" and ")}`);
  if (m.billsVsLastWeekPct !== null) L.push(`Bills compared with last week: ${m.billsVsLastWeekPct >= 0 ? "up" : "down"} ${Math.abs(m.billsVsLastWeekPct)}%`);
  return L.join("\n");
}

export interface CoachText {
  notes: string[];
}

/** The plain-wording notes: same facts, fixed sentences, en or ta. Constructive and about the work, never the person. */
export function templateCoach(f: CoachFacts, m: CoachMetrics, lang: CoachLang): CoachText {
  const ta = lang === "ta";
  const n = neutralise(f.person.name).text || (ta ? "இவர்" : "This person");
  if (!m.enough) {
    return { notes: [ta ? `இந்த வாரம் ${m.bills} பில்கள் மட்டுமே; பயனுள்ள குறிப்புகளுக்கு இன்னும் சிறிது தரவு தேவை.` : `Only ${m.bills} bills this week, which is too few for useful notes yet.`] };
  }
  const notes: string[] = [];
  notes.push(
    ta
      ? `${n} இந்த வாரம் ${m.bills} பில்கள் போட்டார் (நாளுக்கு சுமார் ${m.billsPerDay}), சராசரி பில் ${rupees(m.avgBill)}.`
      : `${n} rang ${m.bills} bills this week (about ${m.billsPerDay} a day) with an average bill of ${rupees(m.avgBill)}.`,
  );
  if (m.busiest.length) {
    const hours = m.busiest.map((h) => hourLabel(h, ta)).join(ta ? " மற்றும் " : " and ");
    notes.push(ta ? `மிகவும் பரபரப்பான நேரங்கள் ${hours}; அப்போது அதிக உதவி இருந்தால் வரிசை குறையும்.` : `The busiest hours were ${hours}; having a second pair of hands then would shorten the queue.`);
  }
  if (m.itemsPerBill < m.shop.itemsPerBill) {
    notes.push(ta ? `ஒரு பில்லுக்கு ${m.itemsPerBill} பொருட்கள் (கடை சராசரி ${m.shop.itemsPerBill}); பொருத்தமான கூடுதல் பொருளை நினைவூட்டுவது உதவும்.` : `Items per bill were ${m.itemsPerBill} (shop average ${m.shop.itemsPerBill}); mentioning a matching item can help.`);
  } else {
    notes.push(ta ? `ஒரு பில்லுக்கு ${m.itemsPerBill} பொருட்கள், கடை சராசரியை (${m.shop.itemsPerBill}) விட நன்றாக உள்ளது.` : `Items per bill were ${m.itemsPerBill}, at or above the shop average of ${m.shop.itemsPerBill}.`);
  }
  return { notes: notes.slice(0, 3) };
}

/** Wording that judges a person. Not allowed in coaching notes, in either language. */
const JUDGEMENT =
  /\b(lazy|laziness|careless|negligent|dishonest|dishonesty|cheat\w*|steal\w*|stole|theft|thief|fraud\w*|suspici\w*|suspect\w*|guilty|incompetent|useless|poor performer|bad (?:worker|employee|cashier)|untrustworthy|slack\w*|should be (?:fired|warned)|warning letter|punish\w*|blame\w*|irresponsible|unreliable)\b|சோம்பேறி|திருட்டு|திருடு|மோசடி|ஏமாற்று|சந்தேக|அலட்சிய|பொறுப்பற்ற|நம்பகமற்ற|தண்டி|குற்றம்|கெட்ட|மோசமான/i;
/** Promises and orders a note must not make (pay, firing, targets). */
const PROMISE = /\b(bonus|pay raise|salary|pay cut|promotion|promoted|fired?|terminate\w*|incentive|commission|penalty|fine)\b|போனஸ்|சம்பளம்|வேலை நீக்க|அபராதம்|பதவி உயர்வு/i;

export const noJudgement = (text: string) => !JUDGEMENT.test(text) && !PROMISE.test(text);

export const COACH_SYSTEM = [
  "You write a short weekly note for ONE cashier in a small Indian shop, to be read by the shop owner and optionally shared with that cashier. The numbers come from a facts sheet the shop's software already worked out.",
  "Write 2 or 3 short, friendly, constructive sentences about the WORK: what went well, what the busiest hours were, and one practical idea (for example more help in the busy hours, mentioning a matching item when a bill has only one item). Use ONLY facts in the sheet.",
  "Every number you write (counts, rupees, percentages, hours) must be copied exactly from the sheet. Never calculate, round or invent a number. If a fact is not in the sheet, do not mention it.",
  "Do NOT judge or label the person (no lazy, careless, dishonest, suspicious, bad, good worker), do not hint at cheating or theft, do not mention cancelled bills or discounts as a problem, do not compare them harshly with others, and do not promise or threaten anything (pay, bonus, warning, firing). Cancelled bills and returns are normal work: mention them only if the sheet shows they are above the shop's figure, and then only as 'worth checking together'.",
  "Write in the requested language: en = simple English, ta = natural spoken Tamil in Tamil script. Keep the person's name as given. Rupee amounts keep the ₹ sign and digits.",
  "notes: an array of 2 or 3 strings, each one sentence, at most 28 words, plain text, no markdown, no emojis.",
  DATA_RULES,
].join("\n");

const Out = z.object({ notes: z.array(z.string()).min(1).max(4) });
const OUT_JSON = {
  type: "object",
  properties: { notes: { type: "array", items: { type: "string" } } },
  required: ["notes"],
  additionalProperties: false,
} as const;

export interface CoachResult extends CoachText {
  source: "ai" | "template";
  fallbackReason: string | null;
  runId: string | null;
  credits: number;
  metrics: CoachMetrics;
  sheet: string;
  /** The model's sentences when they were thrown away (kept in memory for evals and debugging; never stored or shown). */
  rejected?: string[];
}

/** The notes for one person. The AI text is kept only when its numbers are in the sheet and it does not judge the person. */
export async function writeCoaching(
  ai: AiRunner,
  req: { tenantId: string; userId?: string | null; facts: CoachFacts; lang: CoachLang; useAi?: boolean; fallbackOnError?: (code: string) => boolean },
): Promise<CoachResult> {
  const m = coachMetrics(req.facts);
  const sheet = coachSheet(req.facts, m);
  const template = templateCoach(req.facts, m, req.lang);
  const fallback = (reason: string, runId: string | null = null, credits = 0): CoachResult => ({ ...template, source: "template", fallbackReason: reason, runId, credits, metrics: m, sheet });
  if (!m.enough) return fallback("too_few_bills");
  if (req.useAi === false) return fallback("ai_not_used");
  let r;
  try {
    r = await ai.run<z.infer<typeof Out>>({
      tenantId: req.tenantId,
      userId: req.userId ?? null,
      feature: COACHING_FEATURE,
      tier: "light",
      system: COACH_SYSTEM,
      input: { text: `Language: ${req.lang}\n${dataBlock("facts sheet", sheet)}` },
      schema: { name: "staff_coaching", jsonSchema: OUT_JSON as unknown as Record<string, unknown>, zod: Out },
      maxTokens: 2000,
    });
  } catch (e) {
    const code = (e as { code?: string }).code ?? "ai_failed";
    if (req.fallbackOnError?.(code)) return fallback(code);
    throw e;
  }
  const notes = r.output.notes.map((x) => cleanLine(x, 260)).filter(Boolean).slice(0, 3);
  if (!notes.length) return fallback("empty", r.runId, r.credits);
  if (outputLooksInjected(r.output, [])) return fallback("injected", r.runId, r.credits);
  const joined = notes.join(" ");
  if (!noJudgement(joined)) return { ...fallback("judgement", r.runId, r.credits), rejected: notes };
  if (!checkNumbers(joined, allowedNumbers(sheet)).ok) return { ...fallback("numbers", r.runId, r.credits), rejected: notes };
  return { notes, source: "ai", fallbackReason: null, runId: r.runId, credits: r.credits, metrics: m, sheet };
}
