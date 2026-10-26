import { z } from "zod";
import { DATA_RULES, dataBlock, neutralise, outputLooksInjected } from "../assist/safety";
import type { AiRunner } from "../assist/hsn";
import { allowedNumbers, checkNumbers, qtyText, rupees } from "./numbers";

/**
 * Daily summary. All figures are computed in code (`SummaryFacts`, built by the API from the shop's own tables). The light
 * tier writes a short friendly narrative and 1 or 2 suggested actions from a "facts sheet"; every number in what it wrote
 * must be in that sheet, otherwise the deterministic template text is used instead.
 */

export const SUMMARY_FEATURE = "daily-summary";
export type SummaryLang = "en" | "ta";

export interface SummaryFacts {
  /** IST date being summarised, YYYY-MM-DD. */
  date: string;
  /** 0 = Sunday. */
  weekday: number;
  today: { bills: number; amount: number; cash: number; upi: number; card: number; other: number };
  /** Same weekday last week. */
  lastWeek: { date: string; bills: number; amount: number };
  /** Percent change of today's amount against last week's; null when last week had no sales. */
  vsLastWeekPct: number | null;
  topItems: { name: string; qty: number; amount: number }[];
  lowStock: { count: number; top: { name: string; qty: number; reorderLevel: number }[] };
  /** Items in stock that were not sold for 30 days. */
  deadStock: { count: number; top: { name: string; qty: number }[] };
  dues: { count: number; amount: number; overdue: { name: string; phoneMasked: string | null; amount: number; days: number }[] };
  /** Pharmacy / batch shops only; null when the shop does not track expiry. */
  expiring: { batches: number; qty: number; value: number; days: number } | null;
  purchases: { count: number; amount: number };
  expenses: { count: number; amount: number };
  /** Phase 5 part A: top unusual-activity lines (en + ta), only when the owner switched them into the summary. */
  unusual?: { en: string; ta: string }[];
}

const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_TA = ["ஞாயிறு", "திங்கள்", "செவ்வாய்", "புதன்", "வியாழன்", "வெள்ளி", "சனி"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_TA = ["ஜன.", "பிப்.", "மார்.", "ஏப்.", "மே", "ஜூன்", "ஜூலை", "ஆக.", "செப்.", "அக்.", "நவ.", "டிச."];

/** "24 Oct" / "24 அக்." */
export function shortDate(date: string, lang: SummaryLang): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${d} ${(lang === "ta" ? MONTHS_TA : MONTHS_EN)[m - 1]}`;
}
export const weekdayName = (weekday: number, lang: SummaryLang) => (lang === "ta" ? WEEKDAYS_TA : WEEKDAYS_EN)[weekday]!;

/** Percent change, rounded, or null. */
export function pctChange(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

/**
 * The facts as plain lines: this is what the model sees, and the only source of numbers it may use. Item and customer names
 * are untrusted text (they are neutralised and the whole sheet goes inside a data block).
 */
export function factsSheet(f: SummaryFacts): string {
  const L: string[] = [];
  const n = (s: string) => neutralise(s).text || s;
  L.push(`Date: ${shortDate(f.date, "en")} (${weekdayName(f.weekday, "en")})`);
  L.push(`Sales today: ${rupees(f.today.amount)} from ${f.today.bills} bills`);
  if (f.today.amount > 0) L.push(`Paid by: cash ${rupees(f.today.cash)}, UPI ${rupees(f.today.upi)}, card ${rupees(f.today.card)}${f.today.other ? `, other ${rupees(f.today.other)}` : ""}`);
  L.push(`Same weekday last week (${shortDate(f.lastWeek.date, "en")}): ${rupees(f.lastWeek.amount)} from ${f.lastWeek.bills} bills`);
  if (f.vsLastWeekPct !== null) L.push(`Change against last week: ${f.vsLastWeekPct >= 0 ? "up" : "down"} ${Math.abs(f.vsLastWeekPct)}%`);
  if (f.topItems.length) L.push(`Top items today: ${f.topItems.map((t) => `${n(t.name)} (${qtyText(t.qty)} sold, ${rupees(t.amount)})`).join("; ")}`);
  L.push(`Low stock items: ${f.lowStock.count}${f.lowStock.top.length ? ` (${f.lowStock.top.map((t) => `${n(t.name)} ${qtyText(t.qty)} left`).join("; ")})` : ""}`);
  L.push(`Items not sold in 30 days: ${f.deadStock.count}${f.deadStock.top.length ? ` (${f.deadStock.top.map((t) => n(t.name)).join("; ")})` : ""}`);
  L.push(`Money to collect: ${rupees(f.dues.amount)} from ${f.dues.count} customers`);
  if (f.dues.overdue.length) L.push(`Most overdue: ${f.dues.overdue.map((d) => `${n(d.name)} ${rupees(d.amount)} (${d.days} days late)`).join("; ")}`);
  if (f.expiring) L.push(`Expiring within ${f.expiring.days} days: ${f.expiring.batches} batches, ${rupees(f.expiring.value)} of stock`);
  L.push(`Purchases today: ${rupees(f.purchases.amount)} (${f.purchases.count} bills)`);
  L.push(`Expenses today: ${rupees(f.expenses.amount)} (${f.expenses.count} entries)`);
  if (f.unusual?.length) L.push(`Counter activity worth a look (say it gently, never as blame): ${f.unusual.map((u) => n(u.en)).join("; ")}`);
  return L.join("\n");
}

const names = (xs: { name: string }[], max = 3) => xs.slice(0, max).map((x) => x.name).join(", ");

export interface SummaryText {
  narrative: string;
  actions: string[];
}

/** The deterministic summary: same facts, fixed wording, en or ta. Only numbers from the facts. */
export function templateSummary(f: SummaryFacts, lang: SummaryLang): SummaryText {
  const ta = lang === "ta";
  const parts: string[] = [];
  const day = `${weekdayName(f.weekday, lang)} ${shortDate(f.date, lang)}`;
  if (f.today.bills === 0) {
    parts.push(ta ? `${day}: இன்று விற்பனை பதிவாகவில்லை.` : `${day}: no sales were recorded today.`);
  } else {
    let s = ta
      ? `${day}: இன்று ${f.today.bills} பில்களில் ${rupees(f.today.amount)} விற்பனை (ரொக்கம் ${rupees(f.today.cash)}, UPI ${rupees(f.today.upi)}, கார்டு ${rupees(f.today.card)}).`
      : `${day}: sales ${rupees(f.today.amount)} from ${f.today.bills} bills (cash ${rupees(f.today.cash)}, UPI ${rupees(f.today.upi)}, card ${rupees(f.today.card)}).`;
    if (f.vsLastWeekPct !== null) {
      const up = f.vsLastWeekPct >= 0;
      s += ta ? ` கடந்த வாரத்தை விட ${Math.abs(f.vsLastWeekPct)}% ${up ? "அதிகம்" : "குறைவு"}.` : ` That is ${Math.abs(f.vsLastWeekPct)}% ${up ? "up on" : "down on"} the same day last week.`;
    }
    parts.push(s);
  }
  if (f.topItems.length) parts.push(ta ? `அதிகம் விற்றவை: ${names(f.topItems)}.` : `Top sellers: ${names(f.topItems)}.`);
  if (f.lowStock.count > 0) parts.push(ta ? `குறைந்த கையிருப்பு: ${f.lowStock.count} பொருள் (${names(f.lowStock.top)}).` : `Low stock: ${f.lowStock.count} items (${names(f.lowStock.top)}).`);
  if (f.deadStock.count > 0) parts.push(ta ? `30 நாளாக விற்காதவை: ${f.deadStock.count} பொருள்.` : `${f.deadStock.count} items have not sold in 30 days.`);
  if (f.dues.count > 0) parts.push(ta ? `வசூலிக்க வேண்டியது ${rupees(f.dues.amount)} (${f.dues.count} வாடிக்கையாளர்).` : `To collect: ${rupees(f.dues.amount)} from ${f.dues.count} customers.`);
  if (f.expiring && f.expiring.batches > 0) parts.push(ta ? `${f.expiring.days} நாளுக்குள் காலாவதி: ${f.expiring.batches} பேட்ச் (${rupees(f.expiring.value)}).` : `Expiring within ${f.expiring.days} days: ${f.expiring.batches} batches (${rupees(f.expiring.value)}).`);
  if (f.purchases.amount > 0 || f.expenses.amount > 0) {
    parts.push(ta ? `கொள்முதல் ${rupees(f.purchases.amount)}, செலவு ${rupees(f.expenses.amount)}.` : `Purchases ${rupees(f.purchases.amount)}, expenses ${rupees(f.expenses.amount)}.`);
  }
  if (f.unusual?.length) parts.push(ta ? `ஒரு முறை பார்க்கலாம்: ${f.unusual.map((u) => u.ta).join(" ")}` : `Worth a look: ${f.unusual.map((u) => u.en).join("; ")}.`);

  const actions: string[] = [];
  if (f.dues.overdue.length) {
    const top = f.dues.overdue.slice(0, 2).map((d) => d.name).join(", ");
    actions.push(ta ? `நிலுவை வசூலிக்க இவர்களை அழைக்கவும்: ${top}.` : `Call ${top} about the overdue payment.`);
  }
  if (f.lowStock.count > 0) actions.push(ta ? `குறைந்த கையிருப்புள்ள பொருட்களை ஆர்டர் செய்யுங்கள்: ${names(f.lowStock.top, 2)}.` : `Reorder the low-stock items, starting with ${names(f.lowStock.top, 2)}.`);
  if (f.expiring && f.expiring.batches > 0 && actions.length < 2) actions.push(ta ? "காலாவதியாகும் பேட்ச்களை முதலில் விற்கவும்." : "Sell the expiring batches first.");
  if (f.deadStock.count > 0 && actions.length < 2) actions.push(ta ? "விற்காத பொருட்களுக்கு சிறிய சலுகை கொடுப்பதைப் பரிசீலிக்கவும்." : "Think about a small offer to move the slow stock.");
  return { narrative: parts.join(" "), actions: actions.slice(0, 2) };
}

export const SUMMARY_SYSTEM = [
  "You write the end-of-day message for a small Indian shop owner, from a facts sheet the shop's software already worked out. Be warm, brief and plain, like a trusted assistant speaking to the owner.",
  "Use ONLY the facts in the sheet. Every number you write (rupee amounts, counts, percentages, dates) must be copied exactly from the sheet. Never calculate, round, add or invent a number. If a fact is not in the sheet, do not mention it. Do not promise anything and do not give financial, legal or tax advice.",
  "narrative: 3 to 5 short sentences (at most 90 words) covering today's sales against last week, what sold, and the one or two things that need attention. Plain text, no markdown, no emojis, no line breaks.",
  "actions: one or two short suggestions the owner can do tomorrow (each at most 20 words), based on the sheet (for example reorder low-stock items, call an overdue customer, push slow stock). A suggestion may name items and customers from the sheet.",
  "Write in the requested language: en = simple English, ta = natural spoken Tamil in Tamil script, the way a shopkeeper talks (not a stiff word-for-word translation). Keep item and customer names as given. Rupee amounts keep the ₹ sign and the same digits.",
  DATA_RULES,
].join("\n");

const Out = z.object({ narrative: z.string(), actions: z.array(z.string()).max(3) });
const OUT_JSON = {
  type: "object",
  properties: { narrative: { type: "string" }, actions: { type: "array", items: { type: "string" } } },
  required: ["narrative", "actions"],
  additionalProperties: false,
} as const;

export type SummarySource = "ai" | "template";

export interface SummaryResult extends SummaryText {
  source: SummarySource;
  /** Why the template was used: the AI error code, or "numbers" / "injected" / "empty". */
  fallbackReason: string | null;
  runId: string | null;
  credits: number;
}

/** Strips markdown, control characters and line breaks; one clean paragraph. */
export function cleanLine(s: string, max: number): string {
  const t = s
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮]/g, " ")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The narrative for one day. Calls the light tier once; keeps the AI text only when it passes the number check, else the
 * template. AI errors (off, no credits, busy...) are returned to the caller through `onAiError` semantics: they propagate
 * unless `fallbackOnError` is set, in which case the template is used and the code is in `fallbackReason`.
 */
export async function writeSummary(
  ai: AiRunner,
  req: { tenantId: string; userId?: string | null; facts: SummaryFacts; lang: SummaryLang; fallbackOnError?: (code: string) => boolean },
): Promise<SummaryResult> {
  const template = templateSummary(req.facts, req.lang);
  const sheet = factsSheet(req.facts);
  const fallback = (reason: string, runId: string | null = null, credits = 0): SummaryResult => ({ ...template, source: "template", fallbackReason: reason, runId, credits });
  let r;
  try {
    r = await ai.run<z.infer<typeof Out>>({
      tenantId: req.tenantId,
      userId: req.userId ?? null,
      feature: SUMMARY_FEATURE,
      tier: "light",
      system: SUMMARY_SYSTEM,
      input: { text: `Language: ${req.lang}\n${dataBlock("facts sheet", sheet)}` },
      schema: { name: "daily_summary", jsonSchema: OUT_JSON as unknown as Record<string, unknown>, zod: Out },
      maxTokens: 2500,
    });
  } catch (e) {
    const code = (e as { code?: string }).code ?? "ai_failed";
    if (req.fallbackOnError?.(code)) return fallback(code);
    throw e;
  }
  const narrative = cleanLine(r.output.narrative, 700);
  const actions = r.output.actions.map((a) => cleanLine(a, 220)).filter(Boolean).slice(0, 2);
  if (!narrative) return fallback("empty", r.runId, r.credits);
  if (outputLooksInjected(r.output, [])) return fallback("injected", r.runId, r.credits);
  const allowed = allowedNumbers(sheet);
  if (!checkNumbers([narrative, ...actions].join(" "), allowed).ok) return fallback("numbers", r.runId, r.credits);
  return { narrative, actions, source: "ai", fallbackReason: null, runId: r.runId, credits: r.credits };
}

/** The WhatsApp template variable: one line (no line breaks, no runs of spaces), narrative then actions, at most `max` chars. */
export function whatsappText(t: SummaryText, max = 700): string {
  const joined = [t.narrative, ...t.actions.map((a, i) => `${i + 1}) ${a}`)].join(" ");
  return cleanLine(joined, max);
}
