/** GST state / UT codes (first two digits of a GSTIN and the "place of supply"). */
export interface GstState {
  code: string;
  name: string;
}

/**
 * Codes in current use. Retired codes 25 (Daman and Diu, merged into 26 in 2020) and 28 (undivided
 * Andhra Pradesh, now 37) are left out so they never appear as a place of supply.
 */
export const GST_STATES: readonly GstState[] = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  // Place of supply of an export (a buyer outside India; docs/recurring-export-gstin.md). No GSTIN starts with it.
  { code: "96", name: "Other Countries" },
  { code: "97", name: "Other Territory" },
];

/** Place of supply of exports (a buyer outside India). */
export const EXPORT_PLACE_OF_SUPPLY = "96";

const BY_CODE = new Map(GST_STATES.map((s) => [s.code, s.name]));

/** "33" / "3" / 33 → "33"; anything that isn't one or two digits → null. */
export function normalizeStateCode(code: string | number | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  const s = String(code).trim();
  return /^\d{1,2}$/.test(s) ? s.padStart(2, "0") : null;
}

export function isValidStateCode(code: string | null | undefined): boolean {
  const c = normalizeStateCode(code);
  return c !== null && BY_CODE.has(c);
}

export function stateName(code: string | null | undefined): string | null {
  const c = normalizeStateCode(code);
  return c ? (BY_CODE.get(c) ?? null) : null;
}
