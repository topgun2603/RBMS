import { z } from "zod";

/*
 * Job card templates: what the counter writes down when it takes in work. Each template's own details live in the
 * card's `fields` jsonb and are validated here. Schemas are strict, so nothing outside the list is ever stored
 * (no phone passcodes, PINs or patterns on a device card: the shop asks for them at the counter and doesn't keep them).
 */

export const JOB_TEMPLATES = ["device", "garment", "eyewear", "vehicle", "laundry", "appliance", "general"] as const;
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

// ---------------------------------------------------------------------------------------------- vehicle

export const FUEL_LEVELS = ["empty", "quarter", "half", "three_quarter", "full"] as const;
export const VEHICLE_SERVICE_TYPES = ["general_service", "oil_change", "repair", "tyres_brakes", "wash_detailing", "accident", "other"] as const;

/** "tn 09 ab 1234" → "TN09AB1234": spaces and dashes dropped, upper case, 4 to 12 letters and digits. */
export const normaliseRegNo = (s: string) => s.replace(/[\s-]+/g, "").toUpperCase();

/** Two-wheeler / car service. The reminder is "N months or N km after delivery, whichever comes first". */
export const vehicleFields = z
  .object({
    regNo: z
      .string()
      .trim()
      .transform(normaliseRegNo)
      .pipe(z.string().regex(/^[A-Z0-9]{4,12}$/, "Use letters and numbers, like TN09AB1234")),
    make: optText(60),
    model: optText(80),
    /** Odometer at intake. */
    km: z.number().int().min(0).max(2_000_000),
    fuel: z.enum(FUEL_LEVELS).nullish().transform((v) => v ?? null),
    serviceType: z.enum(VEHICLE_SERVICE_TYPES),
    complaint: optText(1000),
    /** Next service after this many months and / or km (either, or both). */
    remindAfterMonths: z.number().int().min(1).max(60).nullish().transform((v) => v ?? null),
    remindAfterKm: z.number().int().min(100).max(100_000).nullish().transform((v) => v ?? null),
  })
  .strict();

/** When the next service is due, from the delivery date and the odometer at intake. Null where no reminder was asked for. */
export function nextServiceDue(fields: { km?: unknown; remindAfterMonths?: unknown; remindAfterKm?: unknown }, deliveredOn: string): { date: string | null; km: number | null } {
  const months = typeof fields.remindAfterMonths === "number" ? fields.remindAfterMonths : null;
  const km = typeof fields.remindAfterKm === "number" && typeof fields.km === "number" ? fields.km + fields.remindAfterKm : null;
  let date: string | null = null;
  if (months) {
    const d = new Date(`${deliveredOn}T00:00:00Z`);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    // 31 Aug + 6 months lands on the last day of February, not in March.
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    date = d.toISOString().slice(0, 10);
  }
  return { date, km };
}

// ---------------------------------------------------------------------------------------------- laundry

export const LAUNDRY_GARMENTS = ["shirt", "pant", "tshirt", "saree", "salwar", "blazer", "bedsheet", "blanket", "curtain", "other"] as const;
export const LAUNDRY_SERVICES = ["wash_iron", "wash_fold", "iron_only", "dry_clean"] as const;

/** Laundry / dry cleaning: pieces by type, the tag numbers pinned on them, and whether we pick up and drop. */
export const laundryFields = z
  .object({
    service: z.enum(LAUNDRY_SERVICES).default("wash_iron"),
    /** Pieces by garment type: `{ shirt: 4, saree: 1 }`. At least one piece. */
    garments: z
      .record(z.enum(LAUNDRY_GARMENTS), z.number().int().min(0).max(500))
      .default({})
      .refine((g) => Object.values(g).reduce((a, n) => a + (n ?? 0), 0) > 0, "Count at least one garment"),
    tagNumbers: z.array(z.string().trim().min(1).max(20)).max(200).default([]),
    /** Picked up from the customer / dropped back through `delivery`; both need an address. */
    pickup: z.boolean().default(false),
    drop: z.boolean().default(false),
    address: optText(500),
    /** "2026-10-31 10:00–12:00" style slot text. */
    slot: optText(60),
    notes: optText(500),
  })
  .strict()
  .refine((f) => !(f.pickup || f.drop) || !!f.address, { message: "Address is needed for pickup or drop", path: ["address"] })
  .refine((f) => new Set(f.tagNumbers).size === f.tagNumbers.length, { message: "Tag numbers repeat", path: ["tagNumbers"] });

/** Total pieces on a laundry card. */
export const laundryPieces = (garments: Record<string, unknown> | null | undefined): number =>
  Object.values(garments ?? {}).reduce<number>((a, n) => a + (typeof n === "number" ? n : 0), 0);

// ---------------------------------------------------------------------------------------------- appliance

export const APPLIANCE_KINDS = ["ac", "refrigerator", "washing_machine", "water_purifier", "tv", "microwave", "other"] as const;

/** Appliance repair / AC service done at the customer's place: the site visit and the AMC it falls under. */
export const applianceFields = z
  .object({
    kind: z.enum(APPLIANCE_KINDS),
    brand: optText(60),
    model: optText(80),
    serial: optText(60),
    issue: z.string().trim().min(1).max(1000),
    visit: z
      .object({
        address: z.string().trim().min(5).max(500),
        /** Visit day, YYYY-MM-DD. */
        date: optDate,
        /** "10:00–12:00". */
        slot: optText(40),
      })
      .strict(),
    /** Annual maintenance contract number when the visit is under one (no charge for labour). */
    amcNumber: optText(40),
  })
  .strict();

// ---------------------------------------------------------------------------------------------- general

export const generalFields = z.object({ description: z.string().trim().min(1).max(2000) }).strict();

// ---------------------------------------------------------------------------------------------- by template

export const TEMPLATE_FIELDS = {
  device: deviceFields,
  garment: garmentFields,
  eyewear: eyewearFields,
  vehicle: vehicleFields,
  laundry: laundryFields,
  appliance: applianceFields,
  general: generalFields,
} as const;

export type DeviceFields = z.output<typeof deviceFields>;
export type GarmentFields = z.output<typeof garmentFields>;
export type EyewearFields = z.output<typeof eyewearFields>;
export type VehicleFields = z.output<typeof vehicleFields>;
export type LaundryFields = z.output<typeof laundryFields>;
export type ApplianceFields = z.output<typeof applianceFields>;
export type GeneralFields = z.output<typeof generalFields>;
export type JobFields = DeviceFields | GarmentFields | EyewearFields | VehicleFields | LaundryFields | ApplianceFields | GeneralFields;

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
    case "vehicle":
      return [s(fields.regNo), [s(fields.make), s(fields.model)].filter(Boolean).join(" "), s(fields.serviceType).replace(/_/g, " ")].filter(Boolean).join(" · ");
    case "laundry": {
      const n = laundryPieces(fields.garments as Record<string, unknown>);
      return `${n} ${n === 1 ? "piece" : "pieces"} · ${s(fields.service).replace(/_/g, " ")}`;
    }
    case "appliance":
      return [s(fields.kind).replace(/_/g, " "), [s(fields.brand), s(fields.model)].filter(Boolean).join(" "), s(fields.issue)].filter(Boolean).join(" · ").slice(0, 120);
    case "general":
      return s(fields.description).slice(0, 120);
  }
}
