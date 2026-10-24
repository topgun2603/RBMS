import { z } from "zod";
import { DATA_RULES, neutralise } from "../../assist/safety";
import type { AiRunner } from "../../assist/hsn";
import type { AiImageType, AiSchema } from "../../types";
import { VISION_SAFETY_RULES, jConf, jStr, zConf, zStr } from "../../vision/shared";

/**
 * Phase 3 part C: read the identity of a device from a photo (box label, phone Settings > About screen, sticker on the
 * back). The model only transcribes; the IMEI check digit, serial sanity and warranty maths are done in code and a field
 * that fails is never filled in (docs/ai.md "Phase 3 part C").
 */
export const DEVICE_LABEL_FEATURE = "device-label-read";
export const DEVICE_LABEL_CREDITS_HINT = 15;

export const DEVICE_LABEL_SYSTEM = `You read a photo of a device's identity: the label on a retail box, a phone's Settings > About screen, or a sticker on the back of a phone, laptop, TV or appliance sold or repaired in India. A repair or electronics shop will check your reading.

Fields:
- brand: the manufacturer ("" if not shown). model: the model name or number as printed ("" if not shown).
- serial: the serial number (labelled S/N, Serial No, SN). "" if there is none. Do not put an IMEI here.
- imeis: every IMEI shown (labelled IMEI, IMEI1, IMEI2; MEID is not an IMEI), digits only, 15 digits each, at most 2. Copy the digits exactly as printed; if a digit is unclear still copy your best reading and mark imei confidence "low". Never calculate or "fix" digits to make them look valid.
- kind: box_label, settings_screen, sticker or other.
- confidence: high / medium / low for brand, model, serial and imei.
- readable: false when the photo shows no device identity or is too blurry or dark to read; explain in "notes".
${VISION_SAFETY_RULES}
${DATA_RULES}`;

export const DEVICE_LABEL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["readable", "notes", "kind", "brand", "model", "serial", "imeis", "confidence"],
  properties: {
    readable: { type: "boolean" },
    notes: jStr,
    kind: { type: "string", enum: ["box_label", "settings_screen", "sticker", "other"] },
    brand: jStr,
    model: jStr,
    serial: jStr,
    imeis: { type: "array", items: { type: "string" } },
    confidence: {
      type: "object",
      additionalProperties: false,
      required: ["brand", "model", "serial", "imei"],
      properties: { brand: jConf, model: jConf, serial: jConf, imei: jConf },
    },
  },
} as const;

export const DeviceLabelRawSchema = z.object({
  readable: z.boolean().catch(false),
  notes: zStr,
  kind: z.string().catch("other"),
  brand: zStr,
  model: zStr,
  serial: zStr,
  imeis: z.array(z.string()).max(4).catch([]),
  confidence: z.object({ brand: zConf, model: zConf, serial: zConf, imei: zConf }),
});
export type DeviceLabelRaw = z.infer<typeof DeviceLabelRawSchema>;
export const DEVICE_LABEL_SCHEMA: AiSchema<DeviceLabelRaw> = {
  name: "device_label",
  jsonSchema: DEVICE_LABEL_JSON_SCHEMA as unknown as Record<string, unknown>,
  zod: DeviceLabelRawSchema as unknown as z.ZodType<DeviceLabelRaw>,
};

// ------------------------------------------------------------------ checks in code

/** Luhn (mod 10) check over a digit string. */
export function luhnOk(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** The check digit that makes a 14-digit IMEI body valid (used by the synthetic eval images and tests). */
export function imeiCheckDigit(body14: string): string {
  for (let c = 0; c <= 9; c++) if (luhnOk(`${body14}${c}`)) return String(c);
  return "0";
}

export const cleanSerial = (v: string) => v.replace(/\s+/g, "").toUpperCase();

/** Exactly 15 digits whose last digit is the Luhn check digit. */
export function imeiValid(v: string): boolean {
  const s = cleanSerial(v);
  return /^\d{15}$/.test(s) && luhnOk(s);
}

export type SerialIssue = "format" | "repeated" | "looks_like_imei";
/** Sanity of a serial number: 5 to 30 letters / digits (and - / .), not one repeated character, not an IMEI. */
export function serialIssue(v: string): SerialIssue | null {
  const s = cleanSerial(v);
  if (!/^[A-Z0-9][A-Z0-9\-/.]{4,29}$/.test(s)) return "format";
  if (/^(.)\1+$/.test(s)) return "repeated";
  if (/^\d{15}$/.test(s)) return "looks_like_imei";
  return null;
}

export type DeviceFlagCode = "unreadable" | "injection" | "imei_luhn_failed" | "imei_length" | "imei_duplicate" | "serial_format" | "serial_repeated" | "serial_is_imei" | "low_confidence";
export interface DeviceFlag {
  code: DeviceFlagCode;
  severity: "error" | "warn" | "info";
  field?: "brand" | "model" | "serial" | "imei1" | "imei2";
  value?: string;
}

export interface DeviceLabelDraft {
  /** Only what passed every check and was not low confidence: safe to put into the form. */
  fill: { brand: string | null; model: string | null; serial: string | null; imei1: string | null; imei2: string | null };
  /** Everything read, for the owner to see next to the fill (unchecked values are marked in `flags`). */
  read: { brand: string | null; model: string | null; serial: string | null; imeis: string[] };
  imei: { value: string; valid: boolean }[];
  lowFields: string[];
  flags: DeviceFlag[];
  notes: string | null;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f‎‏‪-‮<>]/g;
const clip = (v: string | null, n: number) => (v ? v.replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, n) : null);

/** Checks the raw reading and decides what may be filled in. Pure. */
export function processDeviceLabel(input: DeviceLabelRaw): DeviceLabelDraft {
  let raw = input;
  const flags: DeviceFlag[] = [];
  const low = new Set<string>();
  const empty: DeviceLabelDraft = { fill: { brand: null, model: null, serial: null, imei1: null, imei2: null }, read: { brand: null, model: null, serial: null, imeis: [] }, imei: [], lowFields: [], flags, notes: null };
  if (!raw.readable) {
    flags.push({ code: "unreadable", severity: "error" });
    return { ...empty, notes: clip(raw.notes, 200) };
  }
  const text = (field: "brand" | "model", max: number): string | null => {
    const v = clip(raw[field], max);
    if (!v) return null;
    if (neutralise(v).suspicious) {
      flags.push({ code: "injection", severity: "warn", field });
      return null;
    }
    return v;
  };
  const brand = text("brand", 60);
  const model = text("model", 80);

  let serial: string | null = null;
  const sRaw = raw.serial ? cleanSerial(raw.serial).slice(0, 60) : "";
  if (sRaw) {
    const issue = serialIssue(sRaw);
    if (neutralise(raw.serial ?? "").suspicious) flags.push({ code: "injection", severity: "warn", field: "serial" });
    else if (issue === "format") flags.push({ code: "serial_format", severity: "warn", field: "serial", value: sRaw });
    else if (issue === "repeated") flags.push({ code: "serial_repeated", severity: "warn", field: "serial", value: sRaw });
    else if (issue === "looks_like_imei") {
      // A 15-digit "serial" is an IMEI in the wrong box: treat it as one.
      raw = { ...raw, imeis: [...raw.imeis, sRaw] };
      flags.push({ code: "serial_is_imei", severity: "info", field: "serial", value: sRaw });
    } else serial = sRaw;
  }

  const imei: { value: string; valid: boolean }[] = [];
  for (const r of raw.imeis) {
    const v = cleanSerial(r).replace(/[^0-9]/g, "");
    if (!v || imei.some((x) => x.value === v)) {
      if (v) flags.push({ code: "imei_duplicate", severity: "info", value: v });
      continue;
    }
    const field = imei.length ? "imei2" : "imei1";
    if (!/^\d{15}$/.test(v)) {
      flags.push({ code: "imei_length", severity: "warn", field, value: v });
      imei.push({ value: v, valid: false });
    } else if (!luhnOk(v)) {
      flags.push({ code: "imei_luhn_failed", severity: "warn", field, value: v });
      imei.push({ value: v, valid: false });
    } else imei.push({ value: v, valid: true });
    if (imei.length >= 2) break;
  }

  const conf = raw.confidence;
  const fillIf = (field: "brand" | "model" | "serial" | "imei", value: string | null) => {
    if (value && conf[field] === "low") {
      low.add(field);
      flags.push({ code: "low_confidence", severity: "info", field: field === "imei" ? "imei1" : field });
      return null;
    }
    return value;
  };
  const fill = {
    brand: fillIf("brand", brand),
    model: fillIf("model", model),
    serial: fillIf("serial", serial),
    imei1: imei[0]?.valid ? fillIf("imei", imei[0].value) : null,
    imei2: imei[1]?.valid ? fillIf("imei", imei[1].value) : null,
  };
  return { fill, read: { brand, model, serial, imeis: imei.map((i) => i.value) }, imei, lowFields: [...low], flags, notes: clip(raw.notes, 200) };
}

// ------------------------------------------------------------------ warranty from the shop's own sales records

export interface SoldUnit {
  serial: string;
  serial2: string | null;
  itemName: string;
  status: string;
  soldOn: string | null;
  warrantyMonths: number;
}
export interface WarrantyAnswer {
  found: boolean;
  itemName?: string;
  soldOn?: string | null;
  warrantyEnd?: string | null;
  state: "in_warranty" | "expired" | "no_warranty" | "not_sold" | "not_found";
  daysLeft?: number | null;
}

/** Warranty of a serial from the shop's own units: the end date is worked out from the sale date and the months. */
export function warrantyFromUnits(
  serials: string[],
  units: SoldUnit[],
  today: string,
  fns: { warrantyEnd(soldOn: string, months: number): string | null; daysLeft(end: string | null, today: string): number | null },
): WarrantyAnswer {
  const wanted = new Set(serials.map(cleanSerial));
  const unit = units.find((u) => wanted.has(cleanSerial(u.serial)) || (u.serial2 && wanted.has(cleanSerial(u.serial2))));
  if (!unit) return { found: false, state: "not_found" };
  if (!unit.soldOn || unit.status !== "sold") return { found: true, itemName: unit.itemName, soldOn: null, warrantyEnd: null, state: "not_sold" };
  const end = fns.warrantyEnd(unit.soldOn, unit.warrantyMonths);
  if (!end) return { found: true, itemName: unit.itemName, soldOn: unit.soldOn, warrantyEnd: null, state: "no_warranty" };
  return { found: true, itemName: unit.itemName, soldOn: unit.soldOn, warrantyEnd: end, state: end >= today ? "in_warranty" : "expired", daysLeft: fns.daysLeft(end, today) };
}

export interface PhotoInput {
  images: { mediaType: AiImageType; data: string }[];
}

/** One vision call on the photo(s), then the checks. `draft` is null when the photo shows no device identity. */
export async function readDeviceLabel(ai: AiRunner, req: { tenantId: string; userId?: string | null } & PhotoInput) {
  const r = await ai.run({
    tenantId: req.tenantId,
    userId: req.userId ?? null,
    feature: DEVICE_LABEL_FEATURE,
    tier: "vision",
    system: DEVICE_LABEL_SYSTEM,
    input: { text: "Read the device identity in the attached photo. Return the JSON structure only.", images: req.images },
    schema: DEVICE_LABEL_SCHEMA,
    maxTokens: 4000,
    effort: "low",
  });
  return { raw: r.output, draft: r.output.readable ? processDeviceLabel(r.output) : null, runId: r.runId, credits: r.credits, provider: r.provider };
}
