/**
 * Read a prescription (photo or PDF) into a DRAFT for the pharmacist.
 *
 * The vision model only transcribes what is written. Everything after that is code: cleaning, dates, matching each line
 * to the shop's stock (by salt, strength and brand), in-stock substitutes with the same composition and strength, quantity
 * from dose x days, and the rules that keep a person in charge:
 *   - a line is auto-selected only when it is clearly read, matched to ONE formulation and in stock;
 *   - a low-confidence or unreadable line is never added ("could not read - type it");
 *   - Schedule X / narcotic medicines are never filled in: flagged for the pharmacist;
 *   - Schedule H1 lines require the patient and doctor record (the H1 register), which the draft fills from the photo.
 * Prescriptions are health data: this helper is opt-in by name (registry `optIn`) and the photo is never stored.
 */
import { z } from "zod";
import type { AiSchema } from "../../types";
import { VISION_SAFETY_RULES, jConf, jNum, jStr, zConf, zNum, zStr } from "../../vision/shared";
import { Flags, addDays, cleanText, isRealDate, round3, safeText, type Flag } from "../common";
import { BRAND_SALTS, CONTROLLED_SALTS } from "./brands";
import { ingredientsOf, strengthsOf } from "./salts";

export const RX_FEATURE = "rx-scan";
export const RX_CREDITS_HINT = 40;

export const RX_SYSTEM = `You transcribe a photo or PDF of a doctor's prescription from India so a pharmacist can prepare the bill after checking. You only copy what is written. You are not a doctor and you never advise.

Fields:
- doctorName, doctorRegNo (medical council registration number), doctorClinic (address or clinic name): as printed or written, "" when missing.
- date: the prescription date as YYYY-MM-DD ("" if missing or unreadable). Indian prescriptions write day first.
- patientName and patientAge (number of years, null when missing).
- medicines: one entry per prescribed medicine, in order. For each:
  - written: the medicine name exactly as written (brand or generic), without the strength or the form. "" only if you cannot read it.
  - generic: the generic/salt name ONLY if it is written on the prescription (for example in brackets); otherwise "". Never fill it from your own knowledge.
  - strength: as written, e.g. "650 mg", "500/125", "" if not written.
  - form: Tab, Cap, Syp, Inj, Oint, Drops, Cream... as written ("" if not written).
  - dose: how often as written, e.g. "1-0-1", "BD", "twice daily", "SOS", "" if not written.
  - duration: as written, e.g. "5 days", "1 week", "" if not written.
  - qty: a quantity only if one is written (for example "#10", "x 10", "1 bottle"), else null.
  - legible: false when you cannot read the medicine name with reasonable certainty. If handwriting is unclear, do not guess: set legible false and put what you can see in "written".
  - confidence: high / medium / low for that line.
- confidence: high / medium / low for the doctor details, the date and the patient details.
- readable: false when the image is not a prescription or cannot be read at all; explain briefly in "notes".
Do not add medicines that are not written. Do not correct spelling into a different drug. Do not infer doses.
${VISION_SAFETY_RULES}`;

export const RX_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["readable", "notes", "doctorName", "doctorRegNo", "doctorClinic", "date", "patientName", "patientAge", "medicines", "confidence"],
  properties: {
    readable: { type: "boolean" },
    notes: jStr,
    doctorName: jStr,
    doctorRegNo: jStr,
    doctorClinic: jStr,
    date: jStr,
    patientName: jStr,
    patientAge: jNum,
    medicines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["written", "generic", "strength", "form", "dose", "duration", "qty", "legible", "confidence"],
        properties: { written: jStr, generic: jStr, strength: jStr, form: jStr, dose: jStr, duration: jStr, qty: jNum, legible: { type: "boolean" }, confidence: jConf },
      },
    },
    confidence: {
      type: "object",
      additionalProperties: false,
      required: ["doctor", "date", "patient"],
      properties: { doctor: jConf, date: jConf, patient: jConf },
    },
  },
} as const;

export const RxRawSchema = z.object({
  readable: z.boolean().catch(false),
  notes: zStr,
  doctorName: zStr,
  doctorRegNo: zStr,
  doctorClinic: zStr,
  date: zStr,
  patientName: zStr,
  patientAge: zNum,
  medicines: z
    .array(
      z.object({
        written: zStr,
        generic: zStr,
        strength: zStr,
        form: zStr,
        dose: zStr,
        duration: zStr,
        qty: zNum,
        legible: z.boolean().catch(false),
        confidence: zConf,
      }),
    )
    .max(40)
    .catch([]),
  confidence: z.object({ doctor: zConf, date: zConf, patient: zConf }).catch({ doctor: "low", date: "low", patient: "low" }),
});
export type RxRaw = z.infer<typeof RxRawSchema>;
export const RX_SCHEMA: AiSchema<RxRaw> = { name: "prescription", jsonSchema: RX_JSON_SCHEMA as unknown as Record<string, unknown>, zod: RxRawSchema as unknown as z.ZodType<RxRaw> };

// ------------------------------------------------------------------ stock + matching

export type Schedule = "otc" | "G" | "H" | "H1" | "X" | "narcotic";

/** A medicine in the shop (details + usable stock + price), as the API port supplies them. */
export interface StockMed {
  itemId: string;
  name: string;
  composition: string | null;
  manufacturer: string | null;
  schedule: Schedule;
  packSize: number;
  packUnit: string;
  /** Usable (unexpired) quantity in sold units. */
  stock: number;
  /** GST-exclusive paise per sold unit (billing items' `rate`). */
  rate: number;
  gstRate: number;
  hsn: string | null;
  unit: string;
}

export type LineStatus = "matched" | "choose" | "out_of_stock" | "no_match" | "unreadable" | "blocked";

export interface MatchRef {
  itemId: string;
  name: string;
  composition: string | null;
  schedule: Schedule;
  stock: number;
  rate: number;
  gstRate: number;
  hsn: string | null;
  unit: string;
  packSize: number;
  packUnit: string;
  manufacturer: string | null;
}

export interface RxLine {
  n: number;
  written: string | null;
  strength: string | null;
  form: string | null;
  dose: string | null;
  duration: string | null;
  confidence: "high" | "medium" | "low";
  status: LineStatus;
  /** Tick the line in the draft by default. Only a clear, single, in-stock, non-controlled match. */
  select: boolean;
  /** Why it is not selected, for the screen: a flag code. */
  why: string | null;
  schedule: Schedule | null;
  /** The best match (null when none). */
  match: MatchRef | null;
  /** In stock, same composition and strength as `match` (or as the wanted medicine when `match` is out of stock). */
  substitutes: MatchRef[];
  /** Same salt but another strength or an unclear choice: the pharmacist picks. */
  candidates: MatchRef[];
  /** Units (tablets...) from the dose x days written, null when not computable. */
  units: number | null;
  /** Quantity to bill in the item's sold unit (strips...). */
  qty: number | null;
  qtyNote: { units: number; fromDose: boolean; packSize: number } | null;
}

export interface RxDraft {
  readable: boolean;
  notes: string | null;
  doctor: { name: string | null; regNo: string | null; clinic: string | null };
  date: string | null;
  patient: { name: string | null; age: number | null };
  lines: RxLine[];
  flags: Flag[];
  lowFields: string[];
}

const FORM_WORDS = /\b(tab(?:let)?s?|cap(?:sule)?s?|syp|syrup|susp(?:ension)?|inj(?:ection)?|oint(?:ment)?|cream|gel|drops?|lotion|inhaler|sachet|powder|strip|bottle|tube)\b\.?/gi;
const NUMBERISH = /\b\d+(?:[./]\d+)?\s*(?:mg|mcg|µg|ug|g|gm|ml|iu|%)?\b/gi;

/** The brand/name words of what was written, without form words and strengths: "Tab Dolo 650" -> "dolo". */
export function nameWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(FORM_WORDS, " ")
    .replace(NUMBERISH, " ")
    .replace(/[^a-z஀-௿\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

const toRef = (m: StockMed): MatchRef => ({
  itemId: m.itemId,
  name: m.name,
  composition: m.composition,
  schedule: m.schedule,
  stock: m.stock,
  rate: m.rate,
  gstRate: m.gstRate,
  hsn: m.hsn,
  unit: m.unit,
  packSize: m.packSize,
  packUnit: m.packUnit,
  manufacturer: m.manufacturer,
});

/** Same salts and strengths: what makes two products substitutes. */
export function formulationKey(m: Pick<StockMed, "name" | "composition">): string {
  const ing = ingredientsOf(m.composition).sort().join("+");
  const str = strengthsOf(m.composition ?? m.name).sort().join("+");
  return `${ing}|${str}`;
}

/** Salts we can read from a written line: the generic if written, the brand table, or the words themselves when they are known salts. */
export function wantedIngredients(written: string, generic: string | null, knownIngredients: Set<string>): string[] {
  const out: string[] = [];
  const add = (x: string) => {
    if (!out.includes(x)) out.push(x);
  };
  for (const g of ingredientsOf(generic)) add(g);
  const words = nameWords(written);
  const joined = written.toLowerCase().replace(FORM_WORDS, " ").replace(NUMBERISH, " ").trim().split(/\s+/)[0] ?? "";
  const firstTwo = words.slice(0, 2).join("-");
  const brand = BRAND_SALTS[firstTwo] ?? BRAND_SALTS[joined] ?? BRAND_SALTS[words[0] ?? ""];
  if (brand) for (const b of brand) add(b);
  if (out.length === 0) for (const part of written.split(/\s*(?:\+|\/|&|\band\b)\s*/i)) {
    for (const i of ingredientsOf(part.replace(FORM_WORDS, " "))) if (knownIngredients.has(i)) add(i);
  }
  return out;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Dose x days to units (tablets...). Only when both are written in a form we can read. */
export function unitsFromDose(dose: string | null, duration: string | null): number | null {
  if (!dose || !duration) return null;
  const d = dose.toLowerCase();
  let perDay: number | null = null;
  const t = /(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?|½)/.source;
  const pattern = d.match(new RegExp(`${t}\\s*-\\s*${t}\\s*-\\s*${t}(?:\\s*-\\s*${t})?`));
  const num = (s: string) => {
    if (s === "½") return 0.5;
    const f = s.match(/^(\d+)\s*\/\s*(\d+)$/);
    return f ? Number(f[1]) / Number(f[2]) : Number(s);
  };
  if (pattern) perDay = [pattern[1], pattern[2], pattern[3], pattern[4]].filter((x): x is string => !!x).reduce((a, x) => a + num(x), 0);
  else if (/\b(qid|four times|4 times)\b/.test(d)) perDay = 4;
  else if (/\b(tds|tid|thrice|three times|3 times)\b/.test(d)) perDay = 3;
  else if (/\b(bd|bid|twice|two times|2 times)\b/.test(d)) perDay = 2;
  else if (/\b(od|qd|once|daily|hs|at night|bedtime|morning)\b/.test(d)) perDay = 1;
  if (perDay === null || perDay <= 0 || /\b(sos|prn|as needed|if needed)\b/.test(d)) return null;
  const m = duration.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(d|day|days|w|wk|wks|week|weeks|m|mo|month|months)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  const days = /^d/.test(m[2]!) ? n : /^w/.test(m[2]!) ? n * 7 : n * 30;
  if (!(days > 0) || days > 365) return null;
  return round3(perDay * days);
}

/** Units to the item's sold unit: 10 tablets of a strip of 15 = 1 strip. Liquids, tubes, inhalers: written count or 1. */
export function soldQty(units: number | null, packSize: number, packUnit: string, form: string | null, writtenQty: number | null): number | null {
  const liquidOrTopical = /syp|syrup|susp|drops?|oint|cream|gel|lotion|inhaler|inj/i.test(form ?? "");
  if (liquidOrTopical || packSize <= 1 || !/strip|pack|box/i.test(packUnit)) return writtenQty && writtenQty > 0 && writtenQty <= 20 ? Math.ceil(writtenQty) : 1;
  const u = writtenQty && writtenQty > 0 ? writtenQty : units;
  if (u === null || u <= 0) return null;
  return Math.max(1, Math.ceil(u / packSize));
}

export interface RxContext {
  /** IST today, YYYY-MM-DD. */
  today: string;
  meds: StockMed[];
}

/** Numbers a strength is made of: "650 mg" -> 650, "500/125" -> 500 and 125. A bare number is taken as it is. */
export function strengthNumbers(text: string | null | undefined): number[] {
  if (!text) return [];
  return [...text.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
}
/** The strength the prescription asks for: the strength field, else a strength written with a unit in the name. */
const wantedStrength = (strength: string | null, written: string | null): number[] => {
  const own = strengthNumbers(strength);
  return own.length ? own : strengthsOf(written ?? "").flatMap((x) => strengthNumbers(x));
};
const itemNumbers = (m: Pick<StockMed, "name" | "composition">) => new Set([...strengthNumbers(m.composition), ...strengthNumbers(m.name)]);
const isControlled = (ing: string[]) => ing.some((i) => CONTROLLED_SALTS.includes(i));

/** Match one transcribed line to the stock. Pure. */
export function matchLine(
  line: { written: string | null; generic: string | null; strength: string | null; form: string | null },
  meds: StockMed[],
  known: Set<string>,
): Pick<RxLine, "status" | "match" | "substitutes" | "candidates" | "schedule" | "why"> {
  const text = `${line.written ?? ""}`;
  const want = wantedIngredients(text, line.generic, known);
  const spelled = nameWords(`${text} ${line.generic ?? ""}`);
  if (isControlled(want) || CONTROLLED_SALTS.some((c) => spelled.includes(c))) return { status: "blocked", match: null, substitutes: [], candidates: [], schedule: "narcotic", why: "schedule_x" };
  const words = nameWords(text);
  const scored = meds
    .map((m) => {
      const ing = ingredientsOf(m.composition);
      const nameHit = words.length ? words.filter((w) => m.name.toLowerCase().includes(w) || (m.composition ?? "").toLowerCase().includes(w) || (m.manufacturer ?? "").toLowerCase().includes(w)).length / words.length : 0;
      const ingFull = want.length > 0 && sameSet(want, ing);
      const ingPart = want.length > 0 && want.some((w) => ing.includes(w));
      const score = (ingFull ? 3 : ingPart ? 1 : 0) + (nameHit >= 1 ? 1.5 : nameHit >= 0.5 ? 0.5 : 0);
      return { m, ing, score, ingFull };
    })
    .filter((x) => x.ingFull || (x.score >= 1.5 && x.ing.length > 0));
  if (scored.length === 0) return { status: "no_match", match: null, substitutes: [], candidates: [], schedule: null, why: "no_match" };
  const strengths = wantedStrength(line.strength, text);
  const best = Math.max(...scored.map((s) => s.score));
  const pool = scored.filter((s) => s.score >= Math.max(1.5, best - 1.5));
  const withStrength = strengths.length ? pool.filter((s) => strengths.every((w) => itemNumbers(s.m).has(w))) : pool;
  const controlledItem = (s: { m: StockMed }) => s.m.schedule === "X" || s.m.schedule === "narcotic";
  if (pool.some(controlledItem) && (withStrength.length === 0 || withStrength.some(controlledItem))) {
    const c = (withStrength.length ? withStrength : pool).find(controlledItem)!;
    return { status: "blocked", match: toRef(c.m), substitutes: [], candidates: [], schedule: c.m.schedule, why: "schedule_x" };
  }
  if (withStrength.length === 0) {
    // Same salt, different strength: the pharmacist chooses; never auto-pick a strength.
    return { status: "choose", match: null, substitutes: [], candidates: pool.slice(0, 6).map((s) => toRef(s.m)), schedule: null, why: strengths.length ? "strength_not_in_stock_list" : "strength_unclear" };
  }
  const forms = new Map<string, typeof withStrength>();
  for (const s of withStrength) forms.set(formulationKey(s.m), [...(forms.get(formulationKey(s.m)) ?? []), s]);
  if (forms.size > 1 && strengths.length === 0) {
    return { status: "choose", match: null, substitutes: [], candidates: withStrength.slice(0, 6).map((s) => toRef(s.m)), schedule: null, why: "strength_unclear" };
  }
  // One formulation (or several equal-scoring ones where the strength is written): take the formulation with the best name fit.
  const key = [...forms.entries()].sort((a, b) => Math.max(...b[1].map((x) => x.score)) - Math.max(...a[1].map((x) => x.score)))[0]![0];
  const group = forms.get(key)!.sort((a, b) => b.score - a.score || (b.m.stock > 0 ? 1 : 0) - (a.m.stock > 0 ? 1 : 0) || b.m.stock - a.m.stock);
  const inStock = group.filter((g) => g.m.stock > 0);
  const primary = inStock[0] ?? group[0]!;
  const schedule = primary.m.schedule;
  if (inStock.length === 0) {
    return { status: "out_of_stock", match: toRef(primary.m), substitutes: [], candidates: [], schedule, why: "out_of_stock" };
  }
  return { status: "matched", match: toRef(primary.m), substitutes: inStock.slice(1, 5).map((g) => toRef(g.m)), candidates: [], schedule, why: null };
}

/** Everything after the transcription: cleaning, dates, matching, quantities and the rules above. */
export function processRx(raw: RxRaw, ctx: RxContext): RxDraft {
  const flags = new Flags();
  const low: string[] = [];
  const known = new Set<string>();
  for (const m of ctx.meds) for (const i of ingredientsOf(m.composition)) known.add(i);

  const doctorName = safeText(raw.doctorName, 120, flags, "doctor.name");
  const doctorRegNo = safeText(raw.doctorRegNo, 40, flags, "doctor.regNo");
  const doctorClinic = safeText(raw.doctorClinic, 300, flags, "doctor.clinic");
  const patientName = safeText(raw.patientName, 120, flags, "patient.name");
  const age = raw.patientAge !== null && Number.isFinite(raw.patientAge) && raw.patientAge >= 0 && raw.patientAge <= 120 ? Math.round(raw.patientAge) : null;
  let date: string | null = null;
  const d = cleanText(raw.date, 10);
  if (d && isRealDate(d)) {
    if (d > ctx.today) flags.add("future_date", "warn", { field: "date" });
    else date = d;
    if (date && date < addDays(ctx.today, -365)) flags.add("old_prescription", "info", { field: "date" });
  } else if (d) flags.add("date_unreadable", "warn", { field: "date" });
  if (!doctorName) low.push("doctor.name");
  if (!patientName) low.push("patient.name");
  if (raw.confidence.doctor === "low") low.push("doctor.name", "doctor.regNo");
  if (raw.confidence.patient === "low") low.push("patient.name", "patient.age");
  if (raw.confidence.date === "low" || !date) low.push("date");

  const lines: RxLine[] = raw.medicines.map((r, i): RxLine => {
    const written = safeText(r.written, 120, flags, "written", i);
    const strength = safeText(r.strength, 40, flags, "strength", i);
    const form = safeText(r.form, 20, flags, "form", i);
    const dose = safeText(r.dose, 40, flags, "dose", i);
    const duration = safeText(r.duration, 40, flags, "duration", i);
    const generic = safeText(r.generic, 120, flags, "generic", i);
    const writtenQty = r.qty !== null && r.qty > 0 && r.qty <= 1000 ? r.qty : null;
    const base = { n: i + 1, written, strength, form, dose, duration, confidence: r.confidence, schedule: null as Schedule | null, match: null as MatchRef | null, substitutes: [] as MatchRef[], candidates: [] as MatchRef[], units: null as number | null, qty: null as number | null, qtyNote: null as RxLine["qtyNote"] };
    if (!written || !r.legible) return { ...base, status: "unreadable", select: false, why: "unreadable" };
    const m = matchLine({ written, generic, strength, form }, ctx.meds, known);
    const units = unitsFromDose(dose, duration);
    let qty: number | null = null;
    let qtyNote: RxLine["qtyNote"] = null;
    if (m.match) {
      qty = soldQty(units, m.match.packSize, m.match.packUnit, form, writtenQty);
      const u = writtenQty ?? units;
      if (u !== null && m.match.packSize > 1) qtyNote = { units: u, fromDose: writtenQty === null, packSize: m.match.packSize };
    }
    const lowConf = r.confidence === "low";
    let select = m.status === "matched" && !lowConf && qty !== null;
    let why = m.why;
    if (m.status === "matched" && lowConf) why = "low_confidence";
    else if (m.status === "matched" && qty === null) why = "qty_unclear";
    if (m.status === "blocked") select = false;
    if (m.status === "matched" && !lowConf && qty !== null) why = null;
    return { ...base, ...m, why, select, units, qty, qtyNote };
  });

  const unreadable = lines.filter((l) => l.status === "unreadable").length;
  const lowLines = lines.filter((l) => l.confidence === "low" && l.status !== "unreadable").length;
  if (unreadable) flags.add("unreadable_lines", "warn", { params: { count: unreadable } });
  if (lowLines) flags.add("low_confidence_lines", "warn", { params: { count: lowLines } });
  if (lines.some((l) => l.status === "blocked")) flags.add("schedule_x_present", "error");
  const h1 = lines.some((l) => l.schedule === "H1" || (l.match?.schedule === "H1"));
  if (h1 && (!patientName || !doctorName)) flags.add("h1_record_incomplete", "error");
  else if (h1) flags.add("h1_record", "info");
  if (lines.some((l) => l.schedule === "H") && !doctorName) flags.add("doctor_missing", "warn");
  if (lines.length === 0 && raw.readable) flags.add("no_medicines", "warn");
  return {
    readable: raw.readable,
    notes: cleanText(raw.notes, 300),
    doctor: { name: doctorName, regNo: doctorRegNo, clinic: doctorClinic },
    date,
    patient: { name: patientName, age },
    lines,
    flags: flags.list,
    lowFields: [...new Set(low)],
  };
}
