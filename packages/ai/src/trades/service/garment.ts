import { z } from "zod";
import { DATA_RULES, neutralise } from "../../assist/safety";
import type { AiRunner } from "../../assist/hsn";
import type { AiImageType, AiSchema } from "../../types";
import { VISION_SAFETY_RULES, jConf, jStr, zConf, zStr } from "../../vision/shared";

/**
 * Phase 3 part C, tailoring: read a printed or handwritten measurement card into the job card's garment measurements, and
 * turn a design reference photo into short design notes. The units and the mapping to the garment's keys are decided in code;
 * a value the model was unsure of, a value outside what a body can measure, or a sheet whose unit is unclear is shown but never
 * put into the form on its own.
 */
export const MEASURE_SHEET_FEATURE = "measurement-read";
export const DESIGN_NOTES_FEATURE = "design-notes";
export const MEASURE_CREDITS_HINT = 20;
export const DESIGN_CREDITS_HINT = 15;

export type GarmentKind = "blouse" | "salwar" | "shirt" | "pant" | "other";
/** The shop's garment template (mirrors @srirealtime/jobcards GARMENT_MEASUREMENTS). */
export const TEMPLATE_KEYS: Record<GarmentKind, readonly string[]> = {
  blouse: ["length", "bust", "waist", "shoulder", "armhole", "sleeveLength", "sleeveRound", "frontNeck", "backNeck"],
  salwar: ["length", "bust", "waist", "hip", "shoulder", "armhole", "sleeveLength", "sleeveRound", "frontNeck", "backNeck", "bottomLength", "bottomWaist", "ankle"],
  shirt: ["length", "chest", "waist", "shoulder", "sleeveLength", "cuff", "collar"],
  pant: ["length", "waist", "hip", "thigh", "knee", "bottom", "seat"],
  other: [],
};
const ALL_KEYS = [...new Set(Object.values(TEMPLATE_KEYS).flat())];
export const SHEET_FIELDS = [...new Set([...ALL_KEYS, "bust", "chest"]), "other"] as const;

/** Plausible range of each measurement in inches (anything outside is shown, not filled). */
export const RANGE_IN: Record<string, [number, number]> = {
  length: [10, 60],
  bust: [20, 70],
  chest: [20, 70],
  waist: [18, 70],
  hip: [24, 80],
  shoulder: [9, 25],
  armhole: [8, 30],
  sleeveLength: [2, 35],
  sleeveRound: [6, 25],
  frontNeck: [2, 15],
  backNeck: [1, 15],
  bottomLength: [25, 50],
  bottomWaist: [18, 60],
  ankle: [6, 20],
  cuff: [5, 15],
  collar: [11, 23],
  thigh: [14, 40],
  knee: [10, 30],
  bottom: [8, 30],
  seat: [24, 70],
};
const CM = 2.54;

export const MEASURE_SYSTEM = `You read a photo of a tailor's measurement card or sheet (printed form or handwritten, English or Tamil labels, possibly Tanglish) for a tailoring shop in India. The tailor will check your reading.

For every measurement written on the sheet return one row:
- field: which measurement it is, exactly one of: ${SHEET_FIELDS.join(", ")}. Use "other" for anything else (and put the written label in "label"). Tamil hints: மார்பு/மார்பளவு = bust (shirt: chest), இடுப்பு = waist, தோள்/தோள்பட்டை = shoulder, கை நீளம் = sleeveLength, கை சுற்று = sleeveRound, நீளம் = length, முன் கழுத்து = frontNeck, பின் கழுத்து = backNeck, ஆர்ம்ஹோல் = armhole, ஹிப் = hip.
- label: the label as written on the sheet.
- value: the number as written, as a plain number (36 1/2 is 36.5; 36.5 stays 36.5). null when unreadable. Never invent, estimate or average a value; never copy a value from another row.
- confidence: high only when the digits are clear; low when handwriting is ambiguous (1 vs 7, 3 vs 8), smudged or you guessed.
Sheet-level: unit is "in" (inches), "cm" or "unknown" when the sheet does not say and you cannot tell (a printed "in" / "inch" / "cm" / "இன்ச்" / "செ.மீ" counts as saying). garment is blouse, salwar, shirt, pant, other or unknown, only if the sheet says so. readable is false when the photo is not a measurement sheet or cannot be read.
${VISION_SAFETY_RULES}
${DATA_RULES}`;

export const MEASURE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["readable", "notes", "unit", "garment", "rows"],
  properties: {
    readable: { type: "boolean" },
    notes: jStr,
    unit: { type: "string", enum: ["in", "cm", "unknown"] },
    garment: { type: "string", enum: ["blouse", "salwar", "shirt", "pant", "other", "unknown"] },
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "label", "value", "confidence"],
        properties: { field: { type: "string", enum: [...SHEET_FIELDS] }, label: jStr, value: { type: ["number", "null"] }, confidence: jConf },
      },
    },
  },
} as const;

export const MeasureRawSchema = z.object({
  readable: z.boolean().catch(false),
  notes: zStr,
  unit: z.enum(["in", "cm", "unknown"]).catch("unknown"),
  garment: z.string().catch("unknown"),
  rows: z
    .array(z.object({ field: z.string().catch("other"), label: z.string().catch(""), value: z.number().nullable().catch(null), confidence: zConf }))
    .max(60)
    .catch([]),
});
export type MeasureRaw = z.infer<typeof MeasureRawSchema>;
export const MEASURE_SCHEMA: AiSchema<MeasureRaw> = { name: "measurement_sheet", jsonSchema: MEASURE_JSON_SCHEMA as unknown as Record<string, unknown>, zod: MeasureRawSchema as unknown as z.ZodType<MeasureRaw> };

export type MeasureIssue = "low_confidence" | "no_value" | "out_of_range" | "unit_mismatch" | "unit_unknown" | "duplicate" | "not_in_form";
export interface MeasureRow {
  /** The template key (shirt: chest; blouse: bust) or null when the row does not belong to this garment's form. */
  key: string | null;
  label: string;
  value: number | null;
  confidence: "high" | "medium" | "low";
  /** True only when the value may be put into the form without the tailor looking at it twice. */
  autofill: boolean;
  issue: MeasureIssue | null;
}
export interface MeasureDraft {
  unit: "in" | "cm" | null;
  /** The sheet itself says the unit (or the numbers can only be one unit). */
  unitSure: boolean;
  /** The unit the model said, kept when the numbers disagree with it. */
  unitSaid: "in" | "cm" | "unknown";
  garmentOnSheet: string | null;
  rows: MeasureRow[];
  /** key to value, ONLY the autofill rows. */
  fill: Record<string, number>;
  /** Template keys the sheet did not give a usable value for. */
  missing: string[];
  notes: string | null;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Which unit the numbers fit: "in" when most in-range values fit inches, "cm" when most fit centimetres, else null. */
export function inferUnit(rows: { key: string; value: number }[]): "in" | "cm" | null {
  let inch = 0;
  let cm = 0;
  for (const r of rows) {
    const range = RANGE_IN[r.key];
    if (!range) continue;
    if (r.value >= range[0] && r.value <= range[1]) inch++;
    if (r.value >= range[0] * CM && r.value <= range[1] * CM) cm++;
  }
  if (inch === 0 && cm === 0) return null;
  if (inch >= cm * 2) return "in";
  if (cm >= inch * 2) return "cm";
  return null;
}

/** Maps the reading onto the garment's form. Pure. */
export function processMeasurements(raw: MeasureRaw, garment: GarmentKind): MeasureDraft {
  const template = TEMPLATE_KEYS[garment];
  const keyFor = (field: string): string | null => {
    if (template.includes(field)) return field;
    if (field === "chest" && template.includes("bust")) return "bust";
    if (field === "bust" && template.includes("chest")) return "chest";
    return null;
  };
  const empty: MeasureDraft = { unit: null, unitSure: false, unitSaid: raw.unit, garmentOnSheet: null, rows: [], fill: {}, missing: [...template], notes: clipNote(raw.notes) };
  if (!raw.readable) return empty;

  const candidates = raw.rows.flatMap((r) => {
    const key = keyFor(r.field);
    return key && r.value !== null && r.value > 0 ? [{ key, value: r.value }] : [];
  });
  const fit = inferUnit(candidates);
  let unit: "in" | "cm" | null = raw.unit === "unknown" ? fit : raw.unit;
  let unitSure = raw.unit !== "unknown";
  let unitDisagrees = false;
  if (raw.unit !== "unknown" && fit && fit !== raw.unit) {
    // The sheet says one unit but the numbers fit the other: do not trust either; the tailor picks.
    unitDisagrees = true;
    unitSure = false;
  }
  if (raw.unit === "unknown" && fit) unitSure = false;

  const seen = new Set<string>();
  const rows: MeasureRow[] = raw.rows.map((r) => {
    const label = clipNote(r.label)?.slice(0, 40) ?? "";
    const base = { label: neutralise(label).suspicious ? "" : label, value: r.value, confidence: r.confidence };
    const key = keyFor(r.field);
    if (!key) return { key: null, ...base, autofill: false, issue: "not_in_form" as const };
    if (r.value === null || !(r.value > 0)) return { key, ...base, autofill: false, issue: "no_value" as const };
    if (seen.has(key)) return { key, ...base, autofill: false, issue: "duplicate" as const };
    seen.add(key);
    const range = RANGE_IN[key] ?? [0, 500];
    const useUnit = unit ?? "in";
    const inRange = useUnit === "in" ? r.value >= range[0] && r.value <= range[1] : r.value >= range[0] * CM && r.value <= range[1] * CM;
    const otherFits = useUnit === "in" ? r.value >= range[0] * CM && r.value <= range[1] * CM : r.value >= range[0] && r.value <= range[1];
    if (!inRange) return { key, ...base, autofill: false, issue: otherFits ? ("unit_mismatch" as const) : ("out_of_range" as const) };
    if (!unit || !unitSure) return { key, ...base, autofill: false, issue: "unit_unknown" as const };
    if (r.confidence === "low") return { key, ...base, autofill: false, issue: "low_confidence" as const };
    return { key, ...base, autofill: true, issue: null };
  });
  if (unitDisagrees) unit = null;
  const fill: Record<string, number> = {};
  for (const r of rows) if (r.autofill && r.key && r.value !== null) fill[r.key] = round(r.value);
  const g = raw.garment && raw.garment !== "unknown" ? raw.garment : null;
  return {
    unit,
    unitSure,
    unitSaid: raw.unit,
    garmentOnSheet: g && ["blouse", "salwar", "shirt", "pant", "other"].includes(g) ? g : null,
    rows,
    fill,
    missing: template.filter((k) => !(k in fill)),
    notes: clipNote(raw.notes),
  };
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f‎‏‪-‮<>]/g;
function clipNote(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return s || null;
}

// ------------------------------------------------------------------ design reference

export const DESIGN_SYSTEM = `You look at a photo a customer brought to a tailoring shop in India (a picture of a blouse, salwar, kurta, shirt or other garment design) and write short design notes for the tailor. The tailor checks and edits them.

Describe only what you can see, each in a few words, in the requested language (en or ta; Tamil tailoring terms are fine): neck (neck shape and depth), sleeve (style and length), lining (visible lining or none), piping (piping, border or patti), work (embroidery, zari, beads, mirror, print, bead work, placement), fit (fit and length: fitted, A-line, long), other (back design, closures, anything else notable). Use "" for what cannot be seen. Never guess measurements, fabric prices, brand or stitching time, and never promise a result. If the photo is not a garment or design, set readable false.
${VISION_SAFETY_RULES}
${DATA_RULES}`;

export const DESIGN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["readable", "neck", "sleeve", "lining", "piping", "work", "fit", "other"],
  properties: { readable: { type: "boolean" }, neck: jStr, sleeve: jStr, lining: jStr, piping: jStr, work: jStr, fit: jStr, other: jStr },
} as const;
export const DesignRawSchema = z.object({
  readable: z.boolean().catch(false),
  neck: z.string().catch(""),
  sleeve: z.string().catch(""),
  lining: z.string().catch(""),
  piping: z.string().catch(""),
  work: z.string().catch(""),
  fit: z.string().catch(""),
  other: z.string().catch(""),
});
export type DesignRaw = z.infer<typeof DesignRawSchema>;
export const DESIGN_SCHEMA: AiSchema<DesignRaw> = { name: "design_notes", jsonSchema: DESIGN_JSON_SCHEMA as unknown as Record<string, unknown>, zod: DesignRawSchema as unknown as z.ZodType<DesignRaw> };

export const DESIGN_PARTS = ["neck", "sleeve", "lining", "piping", "work", "fit", "other"] as const;
const DESIGN_LABEL = {
  en: { neck: "Neck", sleeve: "Sleeve", lining: "Lining", piping: "Piping", work: "Work", fit: "Fit", other: "Other" },
  ta: { neck: "கழுத்து", sleeve: "கை", lining: "லைனிங்", piping: "பைப்பிங்", work: "வேலைப்பாடு", fit: "அளவு/பாணி", other: "மற்றவை" },
} as const;
const PROMISE_OR_PRICE = /(₹|\brs\.?\s*\d|\brupees?\b|ரூ|guarantee|promise|will be ready|days?\b.*\bready)/i;

export interface DesignDraft {
  parts: Partial<Record<(typeof DESIGN_PARTS)[number], string>>;
  /** The notes as one block of text for the job card's style box. */
  text: string;
  suspicious: boolean;
  readable: boolean;
}

/** Cleans the notes and builds the text for the style box. Pure. */
export function processDesignNotes(raw: DesignRaw, language: "en" | "ta"): DesignDraft {
  if (!raw.readable) return { parts: {}, text: "", suspicious: false, readable: false };
  const parts: DesignDraft["parts"] = {};
  let suspicious = false;
  for (const p of DESIGN_PARTS) {
    const v = raw[p].replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, 140);
    if (!v) continue;
    if (neutralise(v).suspicious) {
      suspicious = true;
      continue;
    }
    if (PROMISE_OR_PRICE.test(v)) continue;
    parts[p] = v;
  }
  const text = DESIGN_PARTS.filter((p) => parts[p]).map((p) => `${DESIGN_LABEL[language][p]}: ${parts[p]}`).join(". ");
  return { parts, text: text ? `${text}.` : "", suspicious, readable: true };
}

type Photos = { tenantId: string; userId?: string | null; images: { mediaType: AiImageType; data: string }[] };

/** One vision call on the measurement sheet, then the mapping to the garment's keys. `draft` is null when the sheet is unreadable. */
export async function readMeasurementSheet(ai: AiRunner, req: Photos & { garment: GarmentKind }) {
  const r = await ai.run({
    tenantId: req.tenantId,
    userId: req.userId ?? null,
    feature: MEASURE_SHEET_FEATURE,
    tier: "vision",
    system: MEASURE_SYSTEM,
    input: { text: `Read the measurement sheet in the attached photo. The shop is filling a ${req.garment} form. Return the JSON structure only.`, images: req.images },
    schema: MEASURE_SCHEMA,
    maxTokens: 6000,
    effort: "low",
  });
  return { raw: r.output, draft: r.output.readable ? processMeasurements(r.output, req.garment) : null, runId: r.runId, credits: r.credits, provider: r.provider };
}

/** One vision call on the design photo, then the cleaning. `draft` is null when the photo is not a garment design. */
export async function readDesignNotes(ai: AiRunner, req: Photos & { language: "en" | "ta" }) {
  const r = await ai.run({
    tenantId: req.tenantId,
    userId: req.userId ?? null,
    feature: DESIGN_NOTES_FEATURE,
    tier: "vision",
    system: DESIGN_SYSTEM,
    input: { text: `Write the design notes in ${req.language === "ta" ? "Tamil" : "English"} (language code ${req.language}). Return the JSON structure only.`, images: req.images },
    schema: DESIGN_SCHEMA,
    maxTokens: 3000,
    effort: "low",
  });
  return { raw: r.output, draft: r.output.readable ? processDesignNotes(r.output, req.language) : null, runId: r.runId, credits: r.credits, provider: r.provider };
}
