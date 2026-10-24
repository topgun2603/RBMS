/** Store settings form (namespace `store`): zod schema with message keys, and conversions to/from the API shape. Pure. */
import { z } from "zod";
import { paiseToInput, rupeesToPaise } from "./format";
import { TRUST_PAYMENT, TRUST_RETURNS, type StoreSettings } from "./types";

export const STORE_DEFAULTS: StoreSettings = {
  open: true,
  closedMessage: "",
  codEnabled: true,
  codMaxAmount: 500_000,
  minOrderValue: 0,
  deliveryEnabled: true,
  pickupEnabled: false,
  pickupNote: "",
  contactPhone: "",
  contactEmail: "",
  social: { instagram: "", facebook: "", youtube: "", whatsapp: "" },
  policies: { shipping: "", returns: "", privacy: "", terms: "" },
  installBanner: true,
  trust: { returns: "auto", payment: "auto", badges: [] },
};

const MAX_RUPEES = 1_000_000; // the API caps amounts at ₹10,00,000
const amount = z.string().refine((v) => {
  if (v.trim() === "") return true;
  const p = rupeesToPaise(v);
  return p !== null && p <= MAX_RUPEES * 100;
}, "site.validation.amount");
const url = z.string().trim().max(300, "site.validation.tooLong").refine((v) => {
  if (!v) return true;
  try {
    const u = new URL(v);
    return /^https?:$/.test(u.protocol);
  } catch {
    return false;
  }
}, "site.validation.fullUrl");
const policy = z.string().max(20_000, "site.validation.tooLong");

export const storeFormSchema = z.object({
  open: z.boolean(),
  closedMessage: z.string().max(300, "site.validation.tooLong"),
  codEnabled: z.boolean(),
  /** Rupees; "" = no limit. */
  codMaxAmount: amount,
  /** Rupees; "" = none. */
  minOrderValue: amount,
  deliveryEnabled: z.boolean(),
  pickupEnabled: z.boolean(),
  pickupNote: z.string().max(300, "site.validation.tooLong"),
  contactPhone: z.string().trim().max(20, "site.validation.tooLong").regex(/^$|^[+\d][\d\s-]{6,18}$/, "site.validation.phone"),
  contactEmail: z.string().trim().email("site.validation.email").or(z.literal("")),
  instagram: url,
  facebook: url,
  youtube: url,
  whatsapp: z.string().trim().max(20, "site.validation.tooLong").regex(/^$|^[+\d][\d\s-]{6,18}$/, "site.validation.phone"),
  shipping: policy,
  returns: policy,
  privacy: policy,
  terms: policy,
  /** "Show install app banner" (installable storefront). */
  installBanner: z.boolean(),
  /** Trust badges: how returns and payment are described ("auto" = derived), and the owner's own badges. */
  trustReturns: z.enum(TRUST_RETURNS),
  trustPayment: z.enum(TRUST_PAYMENT),
  trustBadges: z
    .array(
      z.object({
        title: z.string().trim().min(1, "site.validation.required").max(40, "site.validation.tooLong"),
        text: z.string().trim().max(80, "site.validation.tooLong"),
        titleTa: z.string().trim().max(60, "site.validation.tooLong"),
        textTa: z.string().trim().max(120, "site.validation.tooLong"),
      }),
    )
    .max(4),
});
export type StoreFormValues = z.infer<typeof storeFormSchema>;

export function toStoreForm(v: Partial<StoreSettings>): StoreFormValues {
  const s = { ...STORE_DEFAULTS, ...v, social: { ...STORE_DEFAULTS.social, ...v.social }, policies: { ...STORE_DEFAULTS.policies, ...v.policies } };
  return {
    open: s.open,
    closedMessage: s.closedMessage,
    codEnabled: s.codEnabled,
    codMaxAmount: paiseToInput(s.codMaxAmount),
    minOrderValue: paiseToInput(s.minOrderValue),
    deliveryEnabled: s.deliveryEnabled !== false,
    pickupEnabled: s.pickupEnabled === true,
    pickupNote: s.pickupNote ?? "",
    contactPhone: s.contactPhone,
    contactEmail: s.contactEmail,
    instagram: s.social.instagram ?? "",
    facebook: s.social.facebook ?? "",
    youtube: s.social.youtube ?? "",
    whatsapp: s.social.whatsapp ?? "",
    shipping: s.policies.shipping ?? "",
    returns: s.policies.returns ?? "",
    privacy: s.policies.privacy ?? "",
    terms: s.policies.terms ?? "",
    installBanner: s.installBanner !== false,
    trustReturns: (TRUST_RETURNS as readonly string[]).includes(s.trust?.returns ?? "") ? s.trust!.returns : "auto",
    trustPayment: (TRUST_PAYMENT as readonly string[]).includes(s.trust?.payment ?? "") ? s.trust!.payment : "auto",
    trustBadges: (s.trust?.badges ?? []).slice(0, 4).map((b) => ({ title: b.title ?? "", text: b.text ?? "", titleTa: b.titleTa ?? "", textTa: b.textTa ?? "" })),
  };
}

/** Form values → the full `store` namespace (what `PUT /settings/store/tenant` takes). */
export function fromStoreForm(f: StoreFormValues): StoreSettings {
  return {
    open: f.open,
    closedMessage: f.closedMessage.trim(),
    codEnabled: f.codEnabled,
    codMaxAmount: rupeesToPaise(f.codMaxAmount) ?? 0,
    minOrderValue: rupeesToPaise(f.minOrderValue) ?? 0,
    deliveryEnabled: f.deliveryEnabled,
    pickupEnabled: f.pickupEnabled,
    pickupNote: f.pickupNote.trim(),
    contactPhone: f.contactPhone.trim(),
    contactEmail: f.contactEmail.trim(),
    social: { instagram: f.instagram.trim(), facebook: f.facebook.trim(), youtube: f.youtube.trim(), whatsapp: f.whatsapp.trim() },
    policies: { shipping: f.shipping, returns: f.returns, privacy: f.privacy, terms: f.terms },
    installBanner: f.installBanner,
    trust: {
      returns: f.trustReturns,
      payment: f.trustPayment,
      badges: f.trustBadges.map((b) => ({ title: b.title.trim(), text: b.text.trim(), titleTa: b.titleTa.trim(), textTa: b.textTa.trim() })).filter((b) => b.title),
    },
  };
}
