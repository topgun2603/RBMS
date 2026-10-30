/** GST state / UT codes (copied from @rbms/gst so the site needs no server package). */
export const GST_STATES: readonly { code: string; name: string; ta?: string }[] = [
  { code: "33", name: "Tamil Nadu", ta: "தமிழ்நாடு" },
  { code: "34", name: "Puducherry", ta: "புதுச்சேரி" },
  { code: "32", name: "Kerala", ta: "கேரளா" },
  { code: "29", name: "Karnataka", ta: "கர்நாடகா" },
  { code: "37", name: "Andhra Pradesh", ta: "ஆந்திரப் பிரதேசம்" },
  { code: "36", name: "Telangana", ta: "தெலங்கானா" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "18", name: "Assam" },
  { code: "10", name: "Bihar" },
  { code: "04", name: "Chandigarh" },
  { code: "22", name: "Chhattisgarh" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "07", name: "Delhi" },
  { code: "30", name: "Goa" },
  { code: "24", name: "Gujarat" },
  { code: "06", name: "Haryana" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "01", name: "Jammu and Kashmir" },
  { code: "20", name: "Jharkhand" },
  { code: "38", name: "Ladakh" },
  { code: "31", name: "Lakshadweep" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "27", name: "Maharashtra" },
  { code: "14", name: "Manipur" },
  { code: "17", name: "Meghalaya" },
  { code: "15", name: "Mizoram" },
  { code: "13", name: "Nagaland" },
  { code: "21", name: "Odisha" },
  { code: "03", name: "Punjab" },
  { code: "08", name: "Rajasthan" },
  { code: "11", name: "Sikkim" },
  { code: "16", name: "Tripura" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "05", name: "Uttarakhand" },
  { code: "19", name: "West Bengal" },
  { code: "97", name: "Other Territory" },
];

export const stateLabel = (s: { name: string; ta?: string }, locale: string) => (locale === "ta" && s.ta ? s.ta : s.name);

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const isGstinShape = (v: string) => GSTIN_RE.test(v);

/** Slug rules come from packages/tenancy (browser-safe subpath), so the reserved list never drifts from the server. */
export { slugify, validateSlug, RESERVED_SLUGS } from "@rbms/tenancy/slug";
import { validateSlug } from "@rbms/tenancy/slug";
export const slugShapeOk = (slug: string) => validateSlug(slug).ok;
