import type { SubjectStatus, SubjectType } from "./schema";

/** Answers "may this user act for this vendor?" Implemented with the marketplace service in kit. */
export interface VendorAccessPort {
  /** True when `userId` is an `owner` in `vendor_users` for this vendor of this tenant. */
  isVendorOwner(tenantId: string, vendorId: string, userId: string): Promise<boolean>;
  /** Optional: false makes checks for unknown vendor ids a 404. */
  vendorExists?(tenantId: string, vendorId: string): Promise<boolean>;
}

/** What other modules get from `status()`. */
export interface KycStatus {
  subjectType: SubjectType;
  subjectId: string;
  status: SubjectStatus;
  verified: boolean;
  verifiedName: string | null;
  badges: string[];
  /** Why it isn't verified yet, e.g. ["Bank account or UPI ID"]. */
  missing: string[];
  updatedAt: Date | null;
}

/** For marketplace / payouts gating (wired in kit to `kyc.service`). */
export interface KycStatusPort {
  status(tenantId: string, subjectType: SubjectType, subjectId: string): Promise<KycStatus>;
}

/** Called after a subject's derived status changes (e.g. marketplace mirrors it into `vendors.kyc_status`). Errors are logged, never thrown. */
export type KycStatusListener = (tenantId: string, status: KycStatus, previous: SubjectStatus) => Promise<void> | void;

/** marketplace's `vendors.kyc_status` vocabulary (`none|pending|verified|failed`); manual review counts as pending. */
export const toVendorKycStatus = (s: SubjectStatus): "none" | "pending" | "verified" | "failed" => (s === "manual_review" ? "pending" : s);

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
