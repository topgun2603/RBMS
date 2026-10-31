/**
 * GST state / UT codes (copied from @rbms/gst so this package stays independent) plus the name variants
 * api.postalpincode.in and couriers use ("Andaman & Nicobar Islands", "Pondicherry", "Orissa", "Chattisgarh" …).
 */
export const STATE_NAMES: Readonly<Record<string, string>> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

export const isStateCode = (code: unknown): code is string => typeof code === "string" && code in STATE_NAMES;

export const stateNameOf = (code: string | null | undefined): string | null => (code ? (STATE_NAMES[code] ?? null) : null);

/** "Tamil Nadu" / "TAMILNADU" / "Andaman & Nicobar" → comparable key. */
const keyOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(the|state of|ut of|nct of)\b/g, " ")
    .replace(/[^a-z]/g, "");

const ALIASES: Record<string, string> = {
  jammukashmir: "01",
  jandk: "01",
  uttaranchal: "05",
  newdelhi: "07",
  delhinct: "07",
  orissa: "21",
  chattisgarh: "22",
  chhatisgarh: "22",
  chattishgarh: "22",
  dadraandnagarhaveli: "26",
  dadranagarhaveli: "26",
  damananddiu: "26",
  dnhanddd: "26",
  pondicherry: "34",
  pondichery: "34",
  andamanandnicobar: "35",
  andamannicobarislands: "35",
  andamanandnicobarisland: "35",
  telengana: "36",
  tamilnadu: "33",
};

const BY_KEY = new Map<string, string>([
  ...Object.entries(STATE_NAMES).map(([code, name]) => [keyOf(name), code] as [string, string]),
  ...Object.entries(ALIASES),
]);

/** State name in any common spelling → 2-digit GST code; null when unknown. */
export function stateCodeFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  return BY_KEY.get(keyOf(name)) ?? null;
}
