import type { FeatureDef, FeatureGatePort, PermissionDef, TenantRef } from "@srirealtime/core";
import type { MembershipsSettings } from "./logic";

export type { FeatureGatePort };

export interface BillLine {
  description: string;
  itemId: string | null;
  qty: number;
  rate: number;
  gstRate: number;
  hsn: string | null;
  unit: string | null;
}

export interface BillResult {
  id: string;
  number: string | null;
  total: number;
}

/** Makes the GST bill for a sold plan (invoices). The bill is issued; payment is taken on it as usual. */
export interface BillingPort {
  createBill(
    tenant: TenantRef,
    input: { lines: BillLine[]; customer: { name: string; phone: string | null } | null; notes: string | null; tillSessionId: string | null },
    opts: { branchId: string | null },
  ): Promise<BillResult>;
}

/** A plan ending soon, as handed to the reminder sender. */
export interface ExpiringMembership {
  memberId: string;
  memberCode: string;
  name: string;
  /** E.164 ("+919876543210") or null. */
  phone: string | null;
  subscriptionId: string;
  planName: string;
  endDate: string;
  /** 0 = ends today. */
  daysLeft: number;
}

/** Sends "your membership ends on …" reminders (WhatsApp / SMS). Optional; failures are logged, never thrown. */
export interface ReminderPort {
  expiring(tenantId: string, list: ExpiringMembership[]): Promise<void>;
}

/**
 * Settings namespace `memberships` (apps/api: `settings.define("memberships", MEMBERSHIPS_SETTINGS_SCHEMA,
 * MEMBERSHIPS_SETTINGS_DEFAULTS)`). `get` may return a partial object; defaults fill the rest. `set` (tenant layer)
 * enables `PUT /settings`.
 */
export interface MembershipsSettingsPort {
  get(tenantId: string): Promise<Partial<MembershipsSettings>>;
  set?(tenantId: string, patch: Partial<MembershipsSettings>): Promise<unknown>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };

export const MEMBERSHIPS_FEATURE = "memberships";
export const MEMBERSHIPS_CHECKIN_FEATURE = "memberships.checkin";

export const MEMBERSHIPS_MANAGE = "memberships.manage";
export const MEMBERSHIPS_CHECKIN = "memberships.checkin";
export const MEMBERSHIPS_VIEW = "memberships.view";

export const MEMBERSHIPS_FEATURES: FeatureDef[] = [
  {
    key: MEMBERSHIPS_FEATURE,
    module: "memberships",
    label: "Memberships & packages",
    description: "Sell memberships and packages (gym monthly / yearly, PT sessions, salon packs) with renewals, freezes and expiry reminders.",
  },
  {
    key: MEMBERSHIPS_CHECKIN_FEATURE,
    module: "memberships",
    label: "Member check-in",
    description: "Front-desk check-in by phone or member code: checks the plan, uses a session and keeps the visit history.",
    dependsOn: [MEMBERSHIPS_FEATURE],
    shopToggle: true,
  },
];

export const MEMBERSHIPS_PERMISSIONS: PermissionDef[] = [
  {
    key: MEMBERSHIPS_MANAGE,
    module: "memberships",
    label: "Manage memberships",
    description: "Plans, adding members, selling and renewing plans, freezing and cancelling them, and the settings.",
  },
  { key: MEMBERSHIPS_CHECKIN, module: "memberships", label: "Front desk check-in", description: "Check members in and see today's visits." },
  { key: MEMBERSHIPS_VIEW, module: "memberships", label: "View members", description: "See members, their plans, visits and the reports." },
];
