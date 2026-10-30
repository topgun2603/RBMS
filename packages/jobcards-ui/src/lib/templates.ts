import type { JobTemplate } from "./types";

/*
 * The forms behind each job template, mirroring @rbms/jobcards' templates.ts. A draft keeps what the inputs
 * hold (strings); `draftToFields` turns it into the API's `fields` (numbers, nulls) or names the first problem.
 */

export const GARMENT_TYPES = ["blouse", "salwar", "shirt", "pant", "other"] as const;
export type GarmentType = (typeof GARMENT_TYPES)[number];

/** The measurements a tailor takes for each garment, in order. Labels: `jobcards.measure.<key>`. */
export const GARMENT_MEASUREMENTS: Record<GarmentType, readonly string[]> = {
  blouse: ["length", "bust", "waist", "shoulder", "armhole", "sleeveLength", "sleeveRound", "frontNeck", "backNeck"],
  salwar: ["length", "bust", "waist", "hip", "shoulder", "armhole", "sleeveLength", "sleeveRound", "frontNeck", "backNeck", "bottomLength", "bottomWaist", "ankle"],
  shirt: ["length", "chest", "waist", "shoulder", "sleeveLength", "cuff", "collar"],
  pant: ["length", "waist", "hip", "thigh", "knee", "bottom", "seat"],
  other: [],
};
/** Every measurement key with a translated label. */
export const MEASURE_KEYS = [...new Set(Object.values(GARMENT_MEASUREMENTS).flat())];

export const LENS_TYPES = ["single_vision", "bifocal", "progressive", "reading", "other"] as const;
export type LensType = (typeof LENS_TYPES)[number];

export const EYES = ["right", "left"] as const;
export type Eye = (typeof EYES)[number];
export const RX_FIELDS = ["sph", "cyl", "axis", "add"] as const;
export type RxField = (typeof RX_FIELDS)[number];

export interface DeviceDraft {
  brand: string;
  model: string;
  serial: string;
  issue: string;
  /** Comma-separated in the input. */
  accessories: string;
  condition: string;
}
export interface GarmentDraft {
  garmentType: GarmentType;
  garmentName: string;
  fabricReceived: boolean;
  style: string;
  unit: "in" | "cm";
  measurements: { key: string; value: string }[];
  trialDate: string;
}
export type EyeDraft = Record<RxField, string>;
export interface EyewearDraft {
  right: EyeDraft;
  left: EyeDraft;
  pd: string;
  lensType: LensType | "";
  coating: string;
  frame: string;
}
export interface GeneralDraft {
  description: string;
}
export interface FieldsDraft {
  device: DeviceDraft;
  garment: GarmentDraft;
  eyewear: EyewearDraft;
  general: GeneralDraft;
}

const emptyEye = (): EyeDraft => ({ sph: "", cyl: "", axis: "", add: "" });
export const measurementRows = (type: GarmentType) => GARMENT_MEASUREMENTS[type].map((key) => ({ key, value: "" }));

export function emptyDraft(): FieldsDraft {
  return {
    device: { brand: "", model: "", serial: "", issue: "", accessories: "", condition: "" },
    garment: { garmentType: "blouse", garmentName: "", fabricReceived: true, style: "", unit: "in", measurements: measurementRows("blouse"), trialDate: "" },
    eyewear: { right: emptyEye(), left: emptyEye(), pd: "", lensType: "", coating: "", frame: "" },
    general: { description: "" },
  };
}

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** A draft filled from a saved job's `fields` (other templates stay empty). */
export function draftFromFields(template: JobTemplate, fields: Record<string, unknown>): FieldsDraft {
  const d = emptyDraft();
  const f = fields ?? {};
  if (template === "device") {
    d.device = {
      brand: str(f.brand),
      model: str(f.model),
      serial: str(f.serial),
      issue: str(f.issue),
      accessories: Array.isArray(f.accessories) ? f.accessories.map(str).join(", ") : "",
      condition: str(f.condition),
    };
  } else if (template === "garment") {
    const type = (GARMENT_TYPES as readonly string[]).includes(str(f.garmentType)) ? (str(f.garmentType) as GarmentType) : "other";
    const saved = rec(f.measurements);
    const keys = [...GARMENT_MEASUREMENTS[type], ...Object.keys(saved).filter((k) => !GARMENT_MEASUREMENTS[type].includes(k))];
    d.garment = {
      garmentType: type,
      garmentName: str(f.garmentName),
      fabricReceived: f.fabricReceived === true,
      style: str(f.style),
      unit: f.unit === "cm" ? "cm" : "in",
      measurements: keys.map((key) => ({ key, value: str(saved[key]) })),
      trialDate: str(f.trialDate),
    };
  } else if (template === "eyewear") {
    const eye = (v: unknown): EyeDraft => {
      const e = rec(v);
      return { sph: str(e.sph), cyl: str(e.cyl), axis: str(e.axis), add: str(e.add) };
    };
    d.eyewear = {
      right: eye(f.right),
      left: eye(f.left),
      pd: str(f.pd),
      lensType: (LENS_TYPES as readonly string[]).includes(str(f.lensType)) ? (str(f.lensType) as LensType) : "",
      coating: str(f.coating),
      frame: str(f.frame),
    };
  } else {
    d.general = { description: str(f.description) };
  }
  return d;
}

/** Problems `draftToFields` can report; message `jobcards.fields.error.<code>`. */
export const FIELD_ERRORS = ["issue", "description", "measurement", "rx", "axis", "pd"] as const;
export type FieldError = (typeof FIELD_ERRORS)[number];

const orNull = (s: string) => s.trim() || null;
const num = (s: string): number | null | undefined => {
  const t = s.trim().replace(/^\+/, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};
const isQuarter = (n: number) => Math.abs(n * 4 - Math.round(n * 4)) < 1e-9;

/** The API's `fields` for the chosen template, or the first problem. */
export function draftToFields(template: JobTemplate, draft: FieldsDraft): { fields: Record<string, unknown>; error?: undefined } | { fields?: undefined; error: FieldError } {
  if (template === "device") {
    const d = draft.device;
    if (!d.issue.trim()) return { error: "issue" };
    return {
      fields: {
        brand: orNull(d.brand),
        model: orNull(d.model),
        serial: orNull(d.serial),
        issue: d.issue.trim(),
        accessories: d.accessories
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 20),
        condition: orNull(d.condition),
      },
    };
  }
  if (template === "garment") {
    const d = draft.garment;
    const measurements: Record<string, number> = {};
    for (const m of d.measurements) {
      const n = num(m.value);
      if (n === undefined || (n !== null && (n < 0 || n > 500))) return { error: "measurement" };
      if (n !== null && m.key.trim()) measurements[m.key.trim()] = n;
    }
    return {
      fields: {
        garmentType: d.garmentType,
        garmentName: orNull(d.garmentName),
        fabricReceived: d.fabricReceived,
        style: orNull(d.style),
        unit: d.unit,
        measurements,
        trialDate: orNull(d.trialDate),
      },
    };
  }
  if (template === "eyewear") {
    const d = draft.eyewear;
    const eyes: Record<string, Record<RxField, number | null>> = {};
    for (const eye of EYES) {
      const e = d[eye];
      const sph = num(e.sph);
      const cyl = num(e.cyl);
      const axis = num(e.axis);
      const add = num(e.add);
      for (const [v, min, max] of [
        [sph, -30, 30],
        [cyl, -10, 10],
        [add, 0, 4],
      ] as const) {
        if (v === undefined || (v !== null && (v < min || v > max || !isQuarter(v)))) return { error: "rx" };
      }
      if (axis === undefined || (axis !== null && (!Number.isInteger(axis) || axis < 0 || axis > 180))) return { error: "axis" };
      if (cyl && axis === null) return { error: "axis" };
      eyes[eye] = { sph: sph ?? null, cyl: cyl ?? null, axis: axis ?? null, add: add ?? null };
    }
    const pd = num(d.pd);
    if (pd === undefined || (pd !== null && (pd < 40 || pd > 85))) return { error: "pd" };
    return { fields: { right: eyes.right, left: eyes.left, pd, lensType: d.lensType || null, coating: orNull(d.coating), frame: orNull(d.frame) } };
  }
  const desc = draft.general.description.trim();
  if (!desc) return { error: "description" };
  return { fields: { description: desc } };
}
