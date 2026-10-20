import { z } from "zod";

/*
 * Job card templates: what the counter writes down when it takes in work. Each template's own details live in the
 * card's `fields` jsonb and are validated here. Schemas are strict, so nothing outside the list is ever stored
 * (no phone passcodes, PINs or patterns on a device card: the shop asks for them at the counter and doesn't keep them).
 */

export const JOB_TEMPLATES = ["device", "garment", "eyewear", "general"] as const;
export type JobTemplate = (typeof JOB_TEMPLATES)[number];

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const optDate = z
  .string()
  .regex(DATE_RE, "Use YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Invalid date")
  .nullish()
  .transform((v) => v ?? null);

// ---------------------------------------------------------------------------------------------- device

/** Mobile / laptop / electronics repair. */
export const deviceFields = z
  .object({
    brand: optText(60),
    model: optText(80),
    /** Serial number or IMEI. */
    serial: optText(60),
    issue: z.string().trim().min(1).max(1000),
    /** What came in with it: "charger", "back cover", "SIM tray"… */
    accessories: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    /** Scratches, cracked screen, water marks… noted at intake. */
    condition: optText(500),
  })
  .strict();

// ---------------------------------------------------------------------------------------------- garment

export const GARMENT_TYPES = ["blouse", "salwar", "shirt", "pant", "other"] as const;
export type GarmentType = (typeof GARMENT_TYPES)[number];

/** The measurements a tailor takes for each garment, in order (keys; the UI translates the labels). */
export const GARMENT_MEASUREMENTS: Record<GarmentType, readonly string[]> = {
  blouse: ["length", "bust", "waist", "shoulder", "armhole", "sleeveLength", "sleeveRound", "frontNeck", "backNeck"],
  salwar: ["length", "bust", "waist", "hip", "shoulder", "armhole", "sleeveLength", "sleeveRound", "frontNeck", "backNeck", "bottomLength", "bottomWaist", "ankle"],
  shirt: ["length", "chest", "waist", "shoulder", "sleeveLength", "cuff", "collar"],
  pant: ["length", "waist", "hip", "thigh", "knee", "bottom", "seat"],
  other: [],
};

const measureKey = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z][A-Za-z0-9 _-]*$/, "Use letters and numbers");

/** Tailoring / alterations. Measurements are inches (or cm) by name: `{ bust: 36, waist: 30.5 }`. */
export const garmentFields = z
  .object({
    garmentType: z.enum(GARMENT_TYPES),
    /** Name for "other" ("lehenga", "kurta"). */
    garmentName: optText(60),
    fabricReceived: z.boolean().default(false),
    style: optText(1000),
    unit: z.enum(["in", "cm"]).default("in"),
    measurements: z
      .record(measureKey, z.number().min(0).max(500))
      .default({})
      .refine((m) => Object.keys(m).length <= 40, "At most 40 measurements"),
    trialDate: optDate,
  })
  .strict();

// ---------------------------------------------------------------------------------------------- eyewear

const quarter = (min: number, max: number) =>
  z
    .number()
    .min(min)
    .max(max)
    .refine((v) => Math.abs(v * 4 - Math.round(v * 4)) < 1e-9, "Use steps of 0.25")
    .nullish()
    .transform((v) => v ?? null);

/** One eye of a spectacle prescription. */
export const eyeRx = z
  .object({
    sph: quarter(-30, 30),
    cyl: quarter(-10, 10),
    axis: z.number().int().min(0).max(180).nullish().transform((v) => v ?? null),
    add: quarter(0, 4),
  })
  .strict()
  .refine((e) => !e.cyl || e.axis !== null, { message: "Axis is needed with a cylinder", path: ["axis"] });
export type EyeRx = z.output<typeof eyeRx>;

export const LENS_TYPES = ["single_vision", "bifocal", "progressive", "reading", "other"] as const;

const emptyEye = { sph: null, cyl: null, axis: null, add: null };

/** Optical lens / spectacle orders. */
export const eyewearFields = z
  .object({
    right: eyeRx.default(emptyEye),
    left: eyeRx.default(emptyEye),
    /** Pupillary distance, mm. */
    pd: z.number().min(40).max(85).nullish().transform((v) => v ?? null),
    lensType: z.enum(LENS_TYPES).nullish().transform((v) => v ?? null),
    coating: optText(120),
    frame: optText(120),
  })
  .strict();

// ---------------------------------------------------------------------------------------------- general

export const generalFields = z.object({ description: z.string().trim().min(1).max(2000) }).strict();

// ---------------------------------------------------------------------------------------------- by template

export const TEMPLATE_FIELDS = {
  device: deviceFields,
  garment: garmentFields,
  eyewear: eyewearFields,
  general: generalFields,
} as const;

export type DeviceFields = z.output<typeof deviceFields>;
export type GarmentFields = z.output<typeof garmentFields>;
export type EyewearFields = z.output<typeof eyewearFields>;
export type GeneralFields = z.output<typeof generalFields>;
export type JobFields = DeviceFields | GarmentFields | EyewearFields | GeneralFields;

/** Validates a template's details (ZodError → 400). */
export function parseFields(template: JobTemplate, input: unknown): JobFields {
  return TEMPLATE_FIELDS[template].parse(input ?? {});
}

/** The measurement list to start a garment card with. */
export const defaultMeasurements = (type: GarmentType): string[] => [...GARMENT_MEASUREMENTS[type]];

/** One line describing the job, for bills and the board ("Redmi Note 12 · screen broken", "Blouse"). */
export function fieldsSummary(template: JobTemplate, fields: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  switch (template) {
    case "device":
      return [[s(fields.brand), s(fields.model)].filter(Boolean).join(" "), s(fields.issue)].filter(Boolean).join(" · ");
    case "garment":
      return s(fields.garmentName) || s(fields.garmentType);
    case "eyewear":
      return [s(fields.lensType).replace(/_/g, " "), s(fields.frame)].filter(Boolean).join(" · ") || "Spectacles";
    case "general":
      return s(fields.description).slice(0, 120);
  }
}
