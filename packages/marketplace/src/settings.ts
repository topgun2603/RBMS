import { z } from "zod";

export const PAYOUT_PROVIDERS = ["manual", "mock", "razorpayRoute"] as const;
export type PayoutProvider = (typeof PAYOUT_PROVIDERS)[number];

/**
 * Settings namespace `marketplace`. For apps/api:
 * `settings.define("marketplace", MARKETPLACE_SETTINGS_SCHEMA, MARKETPLACE_SETTINGS_DEFAULTS)`.
 */
export const MARKETPLACE_SETTINGS_SCHEMA = z.object({
  /** Commission for sellers without their own rate, in basis points (1000 = 10 %). */
  defaultCommissionBps: z.number().int().min(0).max(10_000),
  /** Days after delivery during which a return is still possible; sales become payable after it. */
  returnWindowDays: z.number().int().min(0).max(90),
  /** Smaller balances carry over to the next payout run (paise). */
  minPayoutPaise: z.number().int().min(0).max(100_000_000),
  /** Pay only sellers whose KYC is verified. */
  requireKyc: z.boolean(),
  /**
   * How payouts are sent: `manual` (staff pay by bank/UPI and mark them paid), `razorpayRoute` (transfer to the
   * seller's Route linked account) or `mock` (development only: paid at once, no money moves).
   */
  payoutProvider: z.enum(PAYOUT_PROVIDERS),
  /** Signed-in users may apply to become sellers (`POST /public/vendors/apply`). */
  acceptApplications: z.boolean(),
  /** Seller products go live as soon as the seller submits them; off = the shop reviews each one first. */
  autoApproveProducts: z.boolean(),
});
export type MarketplaceSettings = z.infer<typeof MARKETPLACE_SETTINGS_SCHEMA>;

export const MARKETPLACE_SETTINGS_DEFAULTS: MarketplaceSettings = {
  defaultCommissionBps: 1000,
  returnWindowDays: 7,
  minPayoutPaise: 50_000,
  requireKyc: true,
  payoutProvider: "manual",
  acceptApplications: true,
  autoApproveProducts: false,
};

/** Keys sellers (and anyone without a shop role) may read: `GET /v1/settings/marketplace` returns only these to them. */
export const MARKETPLACE_SETTINGS_PUBLIC_KEYS: (keyof MarketplaceSettings)[] = ["returnWindowDays", "minPayoutPaise", "autoApproveProducts"];

/** A stored (possibly partial or stale) settings value with defaults filled in for anything missing or invalid. */
export function resolveSettings(raw: Partial<Record<keyof MarketplaceSettings, unknown>> | null | undefined): MarketplaceSettings {
  const out = { ...MARKETPLACE_SETTINGS_DEFAULTS };
  if (!raw) return out;
  const shape = MARKETPLACE_SETTINGS_SCHEMA.shape;
  for (const key of Object.keys(shape) as (keyof MarketplaceSettings)[]) {
    const parsed = shape[key].safeParse(raw[key]);
    if (parsed.success) (out as Record<string, unknown>)[key] = parsed.data;
  }
  return out;
}
