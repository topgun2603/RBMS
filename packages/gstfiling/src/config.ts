import { z } from "zod";
import type { CompositionType, ZeroRateClass, ZeroRateRule } from "./schema";
import { COMPOSITION_TYPES, ZERO_RATE_CLASSES } from "./schema";

/** The shop's GST filing setup (row of gst_settings with defaults filled in). */
export interface GstConfig {
  composition: boolean;
  compositionFrom: string | null;
  compositionType: CompositionType;
  qrmp: boolean;
  qrmpFrom: string | null;
  rcmCategories: string[];
  zeroRateClass: ZeroRateClass;
  zeroRateRules: ZeroRateRule[];
  gstin: string | null;
  priorTurnover: number | null;
}

export const DEFAULT_CONFIG: GstConfig = {
  composition: false,
  compositionFrom: null,
  compositionType: "trader",
  qrmp: false,
  qrmpFrom: null,
  rcmCategories: [],
  zeroRateClass: "nil",
  zeroRateRules: [],
  gstin: null,
  priorTurnover: null,
};

/** True when bills dated `date` are bills of supply under the composition scheme. */
export const compositionOn = (c: Pick<GstConfig, "composition" | "compositionFrom">, date: string): boolean =>
  c.composition && (!c.compositionFrom || date >= c.compositionFrom);

/** True when the shop files quarterly for the month (QRMP). */
export const qrmpOn = (c: Pick<GstConfig, "qrmp" | "qrmpFrom">, month: string): boolean => c.qrmp && (!c.qrmpFrom || `${month}-01` >= c.qrmpFrom);

/** What a 0% line is reported as: the first matching HSN rule, else the shop default. */
export function zeroClassOf(c: Pick<GstConfig, "zeroRateClass" | "zeroRateRules">, hsn: string | null | undefined): ZeroRateClass {
  const code = (hsn ?? "").replace(/\s+/g, "");
  if (code) {
    const rule = [...c.zeroRateRules].sort((a, b) => b.hsnPrefix.length - a.hsnPrefix.length).find((r) => code.startsWith(r.hsnPrefix));
    if (rule) return rule.class;
  }
  return c.zeroRateClass;
}

/** Composition tax rate by business type, percent of turnover (Section 10, Rule 7 CGST Rules). */
export const COMPOSITION_RATES: Record<CompositionType, number> = { trader: 1, manufacturer: 1, restaurant: 5, services: 6 };

const date = z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional());

export const settingsPatch = z.object({
  composition: z.boolean().optional(),
  compositionFrom: date,
  compositionType: z.enum(COMPOSITION_TYPES).optional(),
  qrmp: z.boolean().optional(),
  qrmpFrom: date,
  rcmCategories: z.array(z.string().max(60)).max(40).optional(),
  zeroRateClass: z.enum(ZERO_RATE_CLASSES).optional(),
  zeroRateRules: z
    .array(z.object({ hsnPrefix: z.string().trim().regex(/^\d{2,8}$/, "HSN prefix is 2 to 8 digits"), class: z.enum(ZERO_RATE_CLASSES) }))
    .max(100)
    .optional(),
  gstin: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().toUpperCase().regex(/^\d{2}[A-Z0-9]{13}$/, "GSTIN is 15 characters").nullable().optional()),
  priorTurnover: z.number().int().min(0).max(1e13).nullable().optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatch>;
