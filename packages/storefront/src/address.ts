import { isValidStateCode, normalizeStateCode } from "@srirealtime/gst";
import { z } from "zod";

export const PINCODE_RE = /^[1-9][0-9]{5}$/;
/** Shoppers in the address book. */
export const MAX_ADDRESSES = 20;

/**
 * Indian mobile number → E.164 ("+919876543210"), accepting "98765 43210", "+91 98765-43210", "09876543210",
 * "919876543210". Null when it isn't a valid Indian mobile (10 digits starting 6–9).
 */
export function normalizeIndianMobile(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!/^\+?[0-9 ()-]+$/.test(raw)) return null;
  let d = raw.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (!/^[6-9][0-9]{9}$/.test(d)) return null;
  return `+91${d}`;
}

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const optText = (max: number) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable().optional());

export const mobileSchema = z.string().transform((v, ctx) => {
  const p = normalizeIndianMobile(v);
  if (!p) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a 10-digit Indian mobile number" });
    return z.NEVER;
  }
  return p;
});

export const stateCodeSchema = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const c = normalizeStateCode(v);
  if (!c || !isValidStateCode(c)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose a state" });
    return z.NEVER;
  }
  return c;
});

export const pincodeSchema = z.string().trim().regex(PINCODE_RE, "PIN code must be 6 digits");

/** A delivery address entered by a shopper (address book and checkout). */
export const addressInputSchema = z.object({
  label: optText(40),
  name: z.string().trim().min(1, "Enter the name").max(120),
  phone: mobileSchema,
  line1: z.string().trim().min(1, "Enter the house / street").max(200),
  line2: optText(200),
  landmark: optText(120),
  city: z.string().trim().min(1, "Enter the city").max(80),
  district: optText(80),
  stateCode: stateCodeSchema,
  pincode: pincodeSchema,
});
export type AddressInput = z.input<typeof addressInputSchema>;
export type ShopperAddress = z.output<typeof addressInputSchema>;

export const addressPatchSchema = addressInputSchema.partial();

export interface FieldIssue {
  field: string;
  message: string;
}

/** Parses an address (pure); field issues instead of a throw. */
export function parseAddress(input: unknown): { ok: true; address: ShopperAddress } | { ok: false; issues: FieldIssue[] } {
  const r = addressInputSchema.safeParse(input ?? {});
  if (r.success) return { ok: true, address: r.data };
  return {
    ok: false,
    issues: r.error.issues.map((i) => ({
      field: i.path.join(".") || "address",
      message: i.code === "invalid_type" && i.received === "undefined" ? "Required" : i.message,
    })),
  };
}
