/**
 * GST Unit Quantity Codes (UQC) accepted by NIC (`ItemList[].Unit`) and the GSTR-1 HSN summary (`uqc`).
 */
export const UQC_CODES = [
  "BAG", "BAL", "BDL", "BKL", "BOU", "BOX", "BTL", "BUN", "CAN", "CBM", "CCM", "CMS", "CTN", "DOZ", "DRM", "GGK",
  "GMS", "GRS", "GYD", "KGS", "KLR", "KME", "LTR", "MLT", "MTR", "MTS", "NOS", "OTH", "PAC", "PCS", "PRS", "QTL",
  "ROL", "SET", "SQF", "SQM", "SQY", "TBS", "TGM", "THD", "TON", "TUB", "UGS", "UNT", "YDS",
] as const;
export type Uqc = (typeof UQC_CODES)[number];

const UQC_SET = new Set<string>(UQC_CODES);

/** Shop-friendly unit names (lower-case, no dots/spaces) → UQC. */
const ALIASES: Record<string, Uqc> = {
  pc: "NOS", pcs: "NOS", piece: "NOS", pieces: "NOS", no: "NOS", nos: "NOS", number: "NOS", numbers: "NOS", qty: "NOS", ea: "NOS", each: "NOS",
  unit: "UNT", units: "UNT", u: "UNT",
  m: "MTR", mtr: "MTR", mtrs: "MTR", meter: "MTR", meters: "MTR", metre: "MTR", metres: "MTR",
  cm: "CMS", cms: "CMS", km: "KME",
  kg: "KGS", kgs: "KGS", kilo: "KGS", kilogram: "KGS", kilograms: "KGS",
  g: "GMS", gm: "GMS", gms: "GMS", gram: "GMS", grams: "GMS", gr: "GMS",
  l: "LTR", lt: "LTR", ltr: "LTR", ltrs: "LTR", litre: "LTR", litres: "LTR", liter: "LTR", liters: "LTR",
  ml: "MLT", kl: "KLR",
  bag: "BAG", bags: "BAG", sack: "BAG",
  box: "BOX", boxes: "BOX",
  bottle: "BTL", bottles: "BTL", btl: "BTL",
  bundle: "BDL", bundles: "BDL", bale: "BAL", bales: "BAL",
  can: "CAN", cans: "CAN", tin: "CAN",
  carton: "CTN", cartons: "CTN", ctn: "CTN",
  dozen: "DOZ", dozens: "DOZ", dz: "DOZ", doz: "DOZ",
  drum: "DRM", drums: "DRM",
  pack: "PAC", packs: "PAC", packet: "PAC", packets: "PAC", pkt: "PAC",
  pair: "PRS", pairs: "PRS", pr: "PRS",
  set: "SET", sets: "SET",
  roll: "ROL", rolls: "ROL",
  sqft: "SQF", sqf: "SQF", sqm: "SQM", sqmtr: "SQM", sqyd: "SQY",
  ton: "TON", tons: "TON", tonne: "TON", tonnes: "TON", mt: "MTS",
  quintal: "QTL", qtl: "QTL",
  tube: "TUB", tubes: "TUB",
  yard: "YDS", yards: "YDS", yd: "YDS",
  cbm: "CBM", ccm: "CCM", cc: "CCM",
  gross: "GRS",
  tablet: "TBS", tablets: "TBS", tab: "TBS",
  hr: "OTH", hrs: "OTH", hour: "OTH", hours: "OTH", day: "OTH", days: "OTH", month: "OTH", job: "OTH", service: "OTH",
};

/** Maps a shop unit ("pcs", "Kg", "m") to its UQC; codes that already are UQC pass through; unknown → "OTH". */
export function toUqc(unit: string | null | undefined): Uqc {
  const raw = (unit ?? "").trim();
  if (!raw) return "OTH";
  // Aliases first: "pcs" is a shop default and maps to NOS (numbers), even though PCS is also a UQC.
  const key = raw.toLowerCase().replace(/[.\s_-]/g, "");
  const alias = ALIASES[key];
  if (alias) return alias;
  const upper = raw.toUpperCase();
  return UQC_SET.has(upper) ? (upper as Uqc) : "OTH";
}

export const isUqc = (code: string | null | undefined): boolean => typeof code === "string" && UQC_SET.has(code);
