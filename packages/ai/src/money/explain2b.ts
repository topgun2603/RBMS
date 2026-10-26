import type { Lang } from "./risk";
import { z } from "zod";
import type { AiRunner } from "../assist/hsn";
import { DATA_RULES, dataBlock, neutralise } from "../assist/safety";
import { allowedNumbers, checkNumbers, rupees } from "../insights/numbers";

/**
 * GSTR-2B mismatch explanations. The reconciliation itself (matching the portal file with the shop's purchase bills) is the
 * GST filing module's; this only reads its computed result, groups the mismatches, works out the likely reasons in code
 * from the differences it recorded, and lets the AI word each group. It never says the return is right or wrong.
 */

export const EXPLAIN_2B_FEATURE = "gst-2b-explain";

export type MismatchGroup = "missing_in_2b" | "missing_in_books" | "amount_mismatch" | "fuzzy";
export const MISMATCH_GROUPS: readonly MismatchGroup[] = ["missing_in_2b", "missing_in_books", "amount_mismatch", "fuzzy"];

export interface MismatchRow {
  group: MismatchGroup;
  supplier: string;
  number: string;
  /** Tax (all heads) of the document in paise. */
  tax: number;
  date: string | null;
  /** For amount mismatches: [2B, books] pairs by field. */
  diff?: Record<string, [unknown, unknown]>;
  /** Books side only: the supplier GSTIN failed the format check. */
  gstinInvalid?: boolean;
}

export type Cause = "rounding" | "date_only" | "number_format" | "amount_differs" | "month_end" | "gstin_invalid" | "other";

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

/** Which cause an amount/number/date difference points to. Pure. */
export function causeOf(r: MismatchRow): Cause {
  if (r.group === "missing_in_2b") {
    if (r.gstinInvalid) return "gstin_invalid";
    if (r.date && /-(2[8-9]|3[01])$/.test(r.date)) return "month_end";
    return "other";
  }
  if (r.group === "missing_in_books") return "other";
  const keys = Object.keys(r.diff ?? {});
  if (!keys.length) return "other";
  const only = (ks: string[]) => keys.every((k) => ks.includes(k));
  if (only(["number"])) return "number_format";
  if (only(["date"])) return "date_only";
  const money = keys.filter((k) => ["taxable", "igst", "cgst", "sgst", "cess"].includes(k));
  if (money.length && keys.every((k) => money.includes(k) || k === "date" || k === "number")) {
    const worst = Math.max(...money.map((k) => Math.abs(num(r.diff![k]![0]) - num(r.diff![k]![1]))));
    // Up to Rs 2 on any head is rounding.
    return worst <= 200 ? "rounding" : "amount_differs";
  }
  return "other";
}

export interface GroupFacts {
  group: MismatchGroup;
  count: number;
  /** Tax in paise across the group. */
  tax: number;
  causes: Partial<Record<Cause, number>>;
  /** Up to 3 examples (largest tax first). */
  examples: { supplier: string; number: string; tax: number }[];
}

export function groupMismatches(rows: MismatchRow[], totals?: Partial<Record<MismatchGroup, { count: number; tax: number }>>): GroupFacts[] {
  const out: GroupFacts[] = [];
  for (const g of MISMATCH_GROUPS) {
    const mine = rows.filter((r) => r.group === g);
    const t = totals?.[g];
    if (!mine.length && !(t && t.count > 0)) continue;
    const causes: Partial<Record<Cause, number>> = {};
    for (const r of mine) {
      const c = causeOf(r);
      causes[c] = (causes[c] ?? 0) + 1;
    }
    out.push({
      group: g,
      count: t?.count ?? mine.length,
      tax: t?.tax ?? mine.reduce((a, r) => a + r.tax, 0),
      causes,
      examples: [...mine].sort((a, b) => b.tax - a.tax).slice(0, 3).map((r) => ({ supplier: r.supplier, number: r.number, tax: r.tax })),
    });
  }
  return out;
}

const CAUSE_EN: Record<Cause, string> = {
  rounding: "rounding differences of a rupee or two",
  date_only: "only the invoice date differs",
  number_format: "the invoice number is written differently (spaces, zeros or prefix)",
  amount_differs: "the taxable value or tax differs by more than rounding, which can be a credit note, a part-delivery or a wrong entry",
  month_end: "the bill is dated at the end of the month, so the supplier may report it in the next month",
  gstin_invalid: "the supplier GSTIN you entered does not pass the format check",
  other: "no single cause is clear from the data",
};
const CAUSE_TA: Record<Cause, string> = {
  rounding: "ஒரு ரூபாய், இரண்டு ரூபாய் அளவு ரவுண்டிங் வேறுபாடு",
  date_only: "பில் தேதி மட்டும் வேறுபடுகிறது",
  number_format: "பில் எண் வேறு விதமாக எழுதப்பட்டுள்ளது (இடைவெளி, பூஜ்யம் அல்லது முன்னொட்டு)",
  amount_differs: "வரிக்குட்பட்ட மதிப்பு அல்லது வரி ரவுண்டிங்கை விட அதிகம் வேறுபடுகிறது; கிரெடிட் நோட், பகுதி டெலிவரி அல்லது தவறான பதிவாக இருக்கலாம்",
  month_end: "பில் மாத இறுதியில் உள்ளது; சப்ளையர் அடுத்த மாதத்தில் காட்டியிருக்கலாம்",
  gstin_invalid: "நீங்கள் உள்ளிட்ட சப்ளையர் GSTIN வடிவச் சோதனையில் தேறவில்லை",
  other: "தரவிலிருந்து ஒரு காரணம் தெளிவாகத் தெரியவில்லை",
};

export const GROUP_TITLE: Record<MismatchGroup, { en: string; ta: string }> = {
  missing_in_2b: { en: "In your books, not in GSTR-2B", ta: "உங்கள் கணக்கில் உள்ளது, GSTR-2B-இல் இல்லை" },
  missing_in_books: { en: "In GSTR-2B, not in your books", ta: "GSTR-2B-இல் உள்ளது, உங்கள் கணக்கில் இல்லை" },
  amount_mismatch: { en: "Found in both, amounts differ", ta: "இரண்டிலும் உள்ளது, தொகை வேறுபடுகிறது" },
  fuzzy: { en: "Probably the same bill, check it", ta: "ஒரே பில்லாக இருக்கலாம், சரிபாருங்கள்" },
};

/** One group's facts as lines: the only source of numbers the AI may use for it. */
export function groupSheet(g: GroupFacts): string {
  const n = (s: string) => neutralise(s).text || s;
  const L = [`Group: ${g.group}`, `Documents: ${g.count}`, `Tax amount in this group: ${rupees(g.tax)}`];
  for (const [c, k] of Object.entries(g.causes)) L.push(`Likely cause: ${CAUSE_EN[c as Cause]}: ${k} documents`);
  for (const e of g.examples) L.push(`Example: supplier ${n(e.supplier)}, bill ${n(e.number)}, tax ${rupees(e.tax)}`);
  return L.join("\n");
}

const GENERIC_EN: Record<MismatchGroup, string> = {
  missing_in_2b: "The supplier may not have filed their GSTR-1 yet, may have used a different GSTIN or invoice number, or may report it in a later month. Check with the supplier before relying on this credit.",
  missing_in_books: "The supplier reported this bill but it is not in your purchases. It may not be entered yet, or entered under a different supplier, GSTIN or bill number.",
  amount_mismatch: "The same bill is in both places but the figures differ.",
  fuzzy: "The amounts match but the bill number or date is written differently, so it is probably the same bill.",
};
const GENERIC_TA: Record<MismatchGroup, string> = {
  missing_in_2b: "சப்ளையர் இன்னும் GSTR-1 தாக்கல் செய்திருக்காமல் இருக்கலாம், வேறு GSTIN அல்லது பில் எண் பயன்படுத்தியிருக்கலாம், அல்லது பிந்தைய மாதத்தில் காட்டலாம். இந்த வரவை நம்பும் முன் சப்ளையரிடம் கேளுங்கள்.",
  missing_in_books: "சப்ளையர் இந்த பில்லைத் தெரிவித்துள்ளார், ஆனால் உங்கள் கொள்முதலில் இல்லை. இன்னும் பதிவாகாமல் இருக்கலாம், அல்லது வேறு சப்ளையர், GSTIN அல்லது பில் எண்ணில் பதிவாகியிருக்கலாம்.",
  amount_mismatch: "அதே பில் இரண்டு இடங்களிலும் உள்ளது, ஆனால் தொகைகள் வேறுபடுகின்றன.",
  fuzzy: "தொகைகள் பொருந்துகின்றன, ஆனால் பில் எண் அல்லது தேதி வேறு விதமாக எழுதப்பட்டுள்ளது; எனவே அது அதே பில்லாக இருக்கலாம்.",
};

export function templateGroupLine(g: GroupFacts, lang: Lang): string {
  const ta = lang === "ta";
  const head = ta ? `${g.count} ஆவணம், வரி ${rupees(g.tax)}.` : `${g.count} ${g.count === 1 ? "document" : "documents"}, tax ${rupees(g.tax)}.`;
  const generic = ta ? GENERIC_TA[g.group] : GENERIC_EN[g.group];
  const top = Object.entries(g.causes).filter(([c]) => c !== "other").sort((a, b) => b[1]! - a[1]!)[0];
  const cause = top ? (ta ? ` அதிகம் காணப்படுவது: ${CAUSE_TA[top[0] as Cause]} (${top[1]}).` : ` Most common: ${CAUSE_EN[top[0] as Cause]} (${top[1]}).`) : "";
  return `${head} ${generic}${cause}`;
}

export const EXPLAIN_2B_SYSTEM = [
  "You explain, for a small Indian shop owner, why some purchase bills do not match the GSTR-2B statement from the GST portal. Each group of mismatches comes with a facts sheet the shop's software already worked out.",
  "Use ONLY the facts in each group's sheet. Every number you write must be copied exactly from that group's sheet. Never calculate or invent a number. Offer reasons as things to CHECK ('may', 'could'), never as certain; do not accuse a supplier, do not say the return is right or wrong, and do not tell the owner to claim or skip input tax credit: say to check with the supplier or fix the entry, and that the decision is theirs.",
  "One line per group, at most 45 words, plain words, in the requested language (en = simple English, ta = natural spoken Tamil in Tamil script). Keep supplier names and bill numbers as given.",
  DATA_RULES,
].join("\n");

const Lines = z.object({ lines: z.array(z.object({ group: z.string(), text: z.string() })).max(6) });
const LINES_JSON = {
  type: "object",
  properties: { lines: { type: "array", items: { type: "object", properties: { group: { type: "string" }, text: { type: "string" } }, required: ["group", "text"], additionalProperties: false } } },
  required: ["lines"],
  additionalProperties: false,
} as const;

export interface GroupLine {
  group: MismatchGroup;
  text: string;
  source: "ai" | "template";
}
export interface Explain2bResult {
  lines: GroupLine[];
  runId: string | null;
  credits: number;
  aiNote: string | null;
}

/** Words that would turn an explanation into a verdict or tax advice. */
const VERDICT = /\b(fraud\w*|fake|cheat\w*|evad\w*|illegal|penalt\w+|you (?:must|should) (?:claim|skip|reverse)|will be (?:rejected|disallowed)|is wrong|is incorrect|is correct|is right)\b|மோசடி|போலி|சட்டவிரோத/i;

export async function explain2b(ai: AiRunner | null, req: { tenantId: string; userId?: string | null; groups: GroupFacts[]; lang: Lang }): Promise<Explain2bResult> {
  const templates: GroupLine[] = req.groups.map((g) => ({ group: g.group, text: templateGroupLine(g, req.lang), source: "template" }));
  if (!req.groups.length || !ai) return { lines: templates, runId: null, credits: 0, aiNote: null };
  const sheets = new Map(req.groups.map((g) => [g.group as string, groupSheet(g)]));
  const text = [`Language: ${req.lang}`, ...req.groups.map((g) => dataBlock(`group ${g.group}`, sheets.get(g.group)!))].join("\n");
  try {
    const r = await ai.run<z.infer<typeof Lines>>({
      tenantId: req.tenantId,
      userId: req.userId ?? null,
      feature: EXPLAIN_2B_FEATURE,
      tier: "light",
      system: EXPLAIN_2B_SYSTEM,
      input: { text },
      schema: { name: "gst_2b_lines", jsonSchema: LINES_JSON as unknown as Record<string, unknown>, zod: Lines },
      maxTokens: 4500,
    });
    const lines = templates.map((t) => {
      const got = r.output.lines.find((l) => l.group === t.group)?.text?.replace(/\s+/g, " ").trim();
      if (!got || got.length > 420) return t;
      if (VERDICT.test(got)) return t;
      if (!checkNumbers(got, allowedNumbers(sheets.get(t.group)!)).ok) return t;
      return { group: t.group, text: got, source: "ai" as const };
    });
    return { lines, runId: r.runId, credits: r.credits, aiNote: null };
  } catch (e) {
    return { lines: templates, runId: null, credits: 0, aiNote: (e as { code?: string }).code ?? "ai_failed" };
  }
}

