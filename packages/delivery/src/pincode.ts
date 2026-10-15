import { stateCodeFromName, stateNameOf } from "./states";

/** Indian PIN: six digits, the first 1–9 (0 is unused; 9 is the Army Postal Service). */
export const PINCODE_RE = /^[1-9][0-9]{5}$/;

/** Accepts " 600 001 " too; returns the 6-digit string or null. */
export function normalizePincode(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const s = String(value).replace(/[\s-]/g, "");
  return PINCODE_RE.test(s) ? s : null;
}

export const isValidPincode = (value: unknown): boolean => normalizePincode(value) !== null;

/**
 * Offline fallback: leading PIN digits → GST state code. The longest matching prefix wins, so 2-digit entries are the
 * postal circle and longer ones carve out the states / UTs that share it.
 *
 * Approximations (a PIN prefix doesn't follow state borders exactly; the API lookup is authoritative):
 * - 11 → Delhi; 12–13 → Haryana; 14–16 → Punjab, 160 → Chandigarh (Mohali shares 160 and comes out as Chandigarh);
 *   17 → Himachal; 18–19 → J&K, 194 → Ladakh.
 * - 20–28 → Uttar Pradesh; Uttarakhand = 246, 248, 249, 263, 2625 (Pithoragarh/Champawat), 24471 (Kashipur/Jaspur),
 *   24766 (Roorkee). Other border towns come out as UP.
 * - 30–34 → Rajasthan; 36–39 → Gujarat, except Daman (39621–39622), Dadra & Nagar Haveli (39623–39624) and Diu (36252) → 26.
 * - 40–44 → Maharashtra, 403 → Goa; 45–48 → Madhya Pradesh; 49 → Chhattisgarh.
 * - 50 → Telangana; 51–53 → Andhra Pradesh, Yanam (53346) → Puducherry.
 * - 56–59 → Karnataka; 60–64 → Tamil Nadu, Puducherry = 6050, 6051, Karaikal 6096 (a few TN villages share these).
 * - 67–69 → Kerala, Mahe (67331) → Puducherry, Lakshadweep (68255) → 31.
 * - 70–74 → West Bengal, 737 → Sikkim, 744 → Andaman & Nicobar.
 * - 75–77 → Odisha; 78 → Assam; 790–792 Arunachal, 793–794 Meghalaya, 795 Manipur, 796 Mizoram, 797–798 Nagaland, 799 Tripura.
 * - 80–85 → Bihar / Jharkhand: Jharkhand = 814–816, 822, 825–829, 83; the rest Bihar (Bihar/Jharkhand borders are fuzzy).
 * - 90–99 (Army Postal Service) and unused prefixes → no state.
 */
export const PIN_PREFIX_STATES: Readonly<Record<string, string>> = {
  "11": "07",
  "12": "06",
  "13": "06",
  "14": "03",
  "15": "03",
  "16": "03",
  "160": "04",
  "17": "02",
  "18": "01",
  "19": "01",
  "194": "38",
  "20": "09",
  "21": "09",
  "22": "09",
  "23": "09",
  "24": "09",
  "25": "09",
  "26": "09",
  "27": "09",
  "28": "09",
  "246": "05",
  "248": "05",
  "249": "05",
  "263": "05",
  "2625": "05",
  "24471": "05",
  "24766": "05",
  "30": "08",
  "31": "08",
  "32": "08",
  "33": "08",
  "34": "08",
  "36": "24",
  "37": "24",
  "38": "24",
  "39": "24",
  "36252": "26",
  "39621": "26",
  "39622": "26",
  "39623": "26",
  "39624": "26",
  "40": "27",
  "41": "27",
  "42": "27",
  "43": "27",
  "44": "27",
  "403": "30",
  "45": "23",
  "46": "23",
  "47": "23",
  "48": "23",
  "49": "22",
  "50": "36",
  "51": "37",
  "52": "37",
  "53": "37",
  "53346": "34",
  "56": "29",
  "57": "29",
  "58": "29",
  "59": "29",
  "60": "33",
  "61": "33",
  "62": "33",
  "63": "33",
  "64": "33",
  "6050": "34",
  "6051": "34",
  "6096": "34",
  "67": "32",
  "68": "32",
  "69": "32",
  "67331": "34",
  "68255": "31",
  "70": "19",
  "71": "19",
  "72": "19",
  "73": "19",
  "74": "19",
  "737": "11",
  "744": "35",
  "75": "21",
  "76": "21",
  "77": "21",
  "78": "18",
  "790": "12",
  "791": "12",
  "792": "12",
  "793": "17",
  "794": "17",
  "795": "14",
  "796": "15",
  "797": "13",
  "798": "13",
  "799": "16",
  "80": "10",
  "81": "10",
  "814": "20",
  "815": "20",
  "816": "20",
  "82": "10",
  "822": "20",
  "825": "20",
  "826": "20",
  "827": "20",
  "828": "20",
  "829": "20",
  "83": "20",
  "84": "10",
  "85": "10",
};

/** Approximate state code from the PIN alone (see `PIN_PREFIX_STATES`); null for APS / unused ranges / invalid input. */
export function stateCodeFromPincode(pincode: string): string | null {
  const pin = normalizePincode(pincode);
  if (!pin) return null;
  for (let len = 5; len >= 2; len--) {
    const code = PIN_PREFIX_STATES[pin.slice(0, len)];
    if (code) return code;
  }
  return null;
}

export interface PincodeInfo {
  pincode: string;
  city: string;
  district: string;
  /** State name as we spell it (GST list). */
  state: string;
  stateCode: string | null;
  /** True when it came from the offline prefix table (city/district empty). */
  approximate: boolean;
}

/** Offline answer from the prefix table; null when the prefix maps to no state. */
export function fallbackPincodeInfo(pincode: string): PincodeInfo | null {
  const code = stateCodeFromPincode(pincode);
  if (!code) return null;
  return { pincode, city: "", district: "", state: stateNameOf(code) ?? "", stateCode: code, approximate: true };
}

// ------------------------------------------------------------------ api.postalpincode.in

export const POSTAL_PINCODE_API = "https://api.postalpincode.in";

/** The lookup service could not answer (network, timeout, 5xx, garbage). A plain "no such PIN" is not an error. */
export class PincodeLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PincodeLookupError";
  }
}

interface PostOffice {
  Name?: string;
  BranchType?: string;
  DeliveryStatus?: string;
  District?: string;
  Division?: string;
  Block?: string;
  State?: string;
  Pincode?: string;
}

const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const usable = (v: unknown) => {
  const s = clean(v);
  return s && s.toUpperCase() !== "NA" ? s : "";
};

/**
 * Parses the API's odd shape: an array with one object `{ Message, Status: "Success" | "Error" | "404", PostOffice: [...] | null }`.
 * Returns null for "no records", throws PincodeLookupError for anything unrecognisable.
 * City = the delivery post office's Block (taluk / city) when set, else its District.
 */
export function parsePostalPincodeResponse(pincode: string, json: unknown): PincodeInfo | null {
  const first = Array.isArray(json) ? json[0] : json;
  if (!first || typeof first !== "object") throw new PincodeLookupError("Unexpected pincode API response");
  const { Status, PostOffice } = first as { Status?: unknown; PostOffice?: unknown };
  const status = clean(Status).toLowerCase();
  if (status !== "success") {
    if (status === "error" || status === "404") return null;
    throw new PincodeLookupError(`Unexpected pincode API status: ${String(Status)}`);
  }
  if (!Array.isArray(PostOffice) || PostOffice.length === 0) return null;
  const offices = PostOffice as PostOffice[];
  const po = offices.find((o) => clean(o.DeliveryStatus).toLowerCase() === "delivery") ?? offices[0]!;
  const stateName = clean(po.State);
  const stateCode = stateCodeFromName(stateName) ?? stateCodeFromPincode(pincode);
  const district = usable(po.District);
  return {
    pincode,
    city: usable(po.Block) || district || usable(po.Division),
    district,
    state: stateNameOf(stateCode) ?? stateName,
    stateCode,
    approximate: false,
  };
}

/** Looks up one PIN. Resolves null when the PIN doesn't exist; throws PincodeLookupError when it can't tell. */
export interface PincodeDriver {
  lookup(pincode: string): Promise<PincodeInfo | null>;
}

export interface PostalPincodeOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Default 5 s. */
  timeoutMs?: number;
}

export class PostalPincodeDriver implements PincodeDriver {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: PostalPincodeOptions = {}) {
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.baseUrl = (opts.baseUrl ?? POSTAL_PINCODE_API).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 5_000;
  }

  async lookup(pincode: string): Promise<PincodeInfo | null> {
    const pin = normalizePincode(pincode);
    if (!pin) return null;
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/pincode/${pin}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new PincodeLookupError(`Pincode API unreachable: ${(err as Error).message}`);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new PincodeLookupError(`Pincode API HTTP ${res.status}`);
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new PincodeLookupError("Pincode API returned invalid JSON");
    }
    return parsePostalPincodeResponse(pin, json);
  }
}
