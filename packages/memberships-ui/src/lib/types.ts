export const MEMBER_STATUSES = ["active", "expiring", "expired", "none"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const SUBSCRIPTION_STATES = ["active", "frozen", "expired", "upcoming", "cancelled"] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

export const CHECKIN_REFUSALS = ["no_active_plan", "frozen", "no_sessions_left", "already_checked_in"] as const;
export type CheckinRefusal = (typeof CHECKIN_REFUSALS)[number];

/** Error codes of @srirealtime/memberships (messages under `memberships.errors.<code>`). */
export const ERROR_CODES = [
  "phone_taken",
  "has_plan",
  "already_renewed",
  "plan_inactive",
  "plan_in_use",
  "member_has_history",
  "not_active",
  "no_freeze_days",
  "already_frozen",
  "not_frozen",
  "cancelled",
  "frozen",
  "already_billed",
  "billing_unavailable",
  "member_not_found",
] as const;

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  durationDays: number;
  /** Null = unlimited visits. */
  sessions: number | null;
  /** Paise. */
  price: number;
  gstRate: number;
  itemId: string | null;
  freezeDaysAllowed: number;
  active: boolean;
  sort: number;
}

export interface Subscription {
  id: string;
  memberId: string;
  planId: string;
  planName: string;
  startDate: string;
  endDate: string;
  sessionsTotal: number | null;
  sessionsUsed: number;
  status: "active" | "frozen" | "cancelled";
  frozenFrom: string | null;
  freezeDaysAllowed: number;
  freezeDaysUsed: number;
  price: number;
  invoiceId: string | null;
  renewedFromId: string | null;
  cancelReason: string | null;
  createdAt: string;
  state: SubscriptionState;
  /** 0 = ends today, negative = ended. */
  daysLeft: number;
  sessionsLeft: number | null;
  freezeDaysLeft: number;
}

export interface Member {
  id: string;
  memberNo: number;
  memberCode: string;
  name: string;
  phone: string | null;
  customerId: string | null;
  notes: string | null;
  photoUrl: string | null;
  createdAt: string;
  status: MemberStatus;
  current: Subscription | null;
  lastVisitAt: string | null;
}

export interface Checkin {
  id: string;
  memberId: string;
  subscriptionId: string;
  at: string;
  note: string | null;
  planName: string | null;
}

export interface MemberDetail extends Member {
  subscriptions: Subscription[];
  checkins: Checkin[];
}

export interface TodayCheckin {
  id: string;
  at: string;
  note: string | null;
  memberId: string;
  memberCode: string;
  name: string;
  phone: string | null;
  photoUrl: string | null;
  planName: string | null;
}

export interface CheckinResult {
  ok: boolean;
  reason: CheckinRefusal | null;
  member: Omit<Member, "status" | "current" | "lastVisitAt">;
  subscription: Subscription | null;
  sessionsLeft: number | null;
  daysLeft: number | null;
  checkin: { id: string; at: string } | null;
  lastCheckinAt: string | null;
}

export interface MembershipsSummary {
  within: number;
  activeMembers: number;
  frozenMembers: number;
  expiring: number;
  checkinsToday: number;
}

export interface ExpiringMembership {
  memberId: string;
  memberCode: string;
  name: string;
  phone: string | null;
  subscriptionId: string;
  planName: string;
  endDate: string;
  daysLeft: number;
}

export interface MembershipsSettings {
  allowMultipleCheckins: boolean;
  expiringDays: number;
  memberCodePrefix: string;
}

/** A billing item (catalogue variant) from `GET /invoices/items`. */
export interface ShopItem {
  id: string;
  name: string;
  hsn: string | null;
  unit: string;
  rate: number;
  gstRate: number;
}
