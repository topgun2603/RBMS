import type { SellerProfile } from "../../lib/types";

/** Server defaults of the `billing` settings namespace (apps/api/src/app-settings.ts). */
export const SELLER_DEFAULTS: Required<Omit<SellerProfile, "taxScheme" | "compositionFrom">> = {
  legalName: "",
  gstin: "",
  address: "",
  city: "",
  pincode: "",
  stateCode: "33",
  phone: "",
  email: "",
  invoicePrefix: "INV",
  terms: "",
  bankName: "",
  accountNumber: "",
  ifsc: "",
  upiId: "",
  autoReminders: false,
  reminderDays: [1, 7, 15],
  sendPaymentReceipts: true,
};

/** The API keeps at most this many reminder days. */
export const MAX_REMINDER_DAYS = 6;

/**
 * PUT /settings/billing/tenant replaces the whole namespace, so every save sends the full profile:
 * defaults ← what the server has ← the changes.
 */
export function fullProfile(current: Partial<SellerProfile> | undefined, changes: Partial<SellerProfile> = {}): SellerProfile {
  const out = { ...SELLER_DEFAULTS } as SellerProfile;
  for (const src of [current ?? {}, changes]) {
    for (const [k, v] of Object.entries(src)) if (v !== undefined && v !== null) (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}
