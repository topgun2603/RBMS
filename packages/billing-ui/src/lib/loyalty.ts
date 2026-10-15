// Loyalty redemption on the bill form. Pure: no React, no fetch.

import { ApiError } from "@srirealtime/web";

export type RedeemReason = "no_points" | "below_min" | "order_too_small" | "disabled";
/** Extra reasons the redeem step (POST /v1/invoices … loyaltyPoints) can give in 409 loyalty_redeem. */
export type RedeemErrorReason = RedeemReason | "too_many_points" | "below_request_min" | "reversed";
export const REDEEM_REASONS: RedeemErrorReason[] = ["no_points", "below_min", "order_too_small", "disabled", "too_many_points", "below_request_min", "reversed"];

export interface LoyaltyMember {
  id: string;
  memberKey: string;
  name: string | null;
  pointsBalance: number;
  pointsValue: number;
  lifetimeSpend: number;
  tier: string;
  joinedAt: string;
  lastActivityAt: string | null;
}

/** POST /v1/loyalty/quote { phone, amount }. */
export interface LoyaltyQuote {
  balance: number;
  maxPoints: number;
  maxDiscount: number;
  minRedeemPoints: number;
  pointValuePaise: number;
  canRedeem: boolean;
  reason: RedeemReason | null;
  member: LoyaltyMember | null;
  earnPreview: number;
}

/** Digits of an Indian mobile number when it looks like one (10 digits, optional +91 / 0), else null. */
export function quotablePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

/** Points the bill may use: whole points inside [minRedeemPoints, maxPoints]; 0 when redeeming isn't possible. */
export function clampRedeemPoints(value: number | string | null | undefined, q: Pick<LoyaltyQuote, "canRedeem" | "maxPoints" | "minRedeemPoints">): number {
  if (!q.canRedeem || q.maxPoints <= 0) return 0;
  const min = Math.max(1, q.minRedeemPoints);
  if (q.maxPoints < min) return 0;
  const n = value === null || value === undefined ? NaN : typeof value === "string" ? Number(value.replace(/[^\d]/g, "") || NaN) : Number(value);
  if (!Number.isFinite(n)) return q.maxPoints;
  return Math.min(q.maxPoints, Math.max(min, Math.floor(n)));
}

/** Discount (paise) the points give. */
export const pointsValue = (points: number, pointValuePaise: number) => Math.max(0, Math.floor(points)) * Math.max(0, pointValuePaise);

/**
 * About what the bill comes to after the points discount. The server spreads the discount over the lines and
 * recomputes GST, so the issued total can differ from this by the round-off.
 */
export function estimatedTotal(total: number, discount: number): number {
  return Math.max(0, total - Math.max(0, discount));
}

export interface RedeemFailure {
  code: "loyalty_redeem" | "loyalty_unavailable" | "loyalty_on_issue" | "loyalty_phone_required" | "validation";
  reason: RedeemErrorReason | null;
  /** The most points the server would accept now (409 loyalty_redeem). */
  maxPoints: number | null;
  message: string;
}

const LOYALTY_CODES = new Set(["loyalty_redeem", "loyalty_unavailable", "loyalty_on_issue", "loyalty_phone_required"]);

/** A loyalty rejection from saving/issuing a bill, or null for any other error. */
export function redeemFailure(err: unknown, sentPoints: boolean): RedeemFailure | null {
  if (!(err instanceof ApiError)) return null;
  if (LOYALTY_CODES.has(err.code)) {
    const d = (err.details ?? {}) as { reason?: string; maxPoints?: number };
    const reason = REDEEM_REASONS.includes(d.reason as RedeemErrorReason) ? (d.reason as RedeemErrorReason) : null;
    const maxPoints = typeof d.maxPoints === "number" && d.maxPoints > 0 ? d.maxPoints : null;
    return { code: err.code as RedeemFailure["code"], reason, maxPoints, message: err.message };
  }
  // A 400 validation error that names loyaltyPoints (e.g. not a whole number).
  if (sentPoints && err.status === 400 && /loyalty/i.test(`${err.message} ${JSON.stringify(err.details ?? "")}`)) {
    return { code: "validation", reason: null, maxPoints: null, message: err.message };
  }
  return null;
}
