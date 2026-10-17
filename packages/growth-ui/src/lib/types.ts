/**
 * API shapes used by the growth UI (docs/batch3.md A4, A5, B2–B5; the route files of packages/loyalty, kyc, einvoice,
 * branches, developer and reports). Dates arrive as ISO strings. Money is integer paise.
 */

export type ISODate = string;

export interface Paged<T> {
  items: T[];
  total: number;
}

// ---------------------------------------------------------------- loyalty (/v1/loyalty)

export interface LoyaltyTier {
  name: string;
  /** Lifetime spend in paise from which the tier applies. */
  minSpend: number;
  multiplier: number;
}

export interface LoyaltySettings {
  /** Points per ₹100 spent. */
  earnPer100: number;
  /** What one point is worth, paise. */
  pointValuePaise: number;
  minRedeemPoints: number;
  maxRedeemPercent: number;
  /** 0 = never expire. */
  expiryMonths: number;
  tiers: LoyaltyTier[];
}

export interface LoyaltyMember {
  id: string;
  /** "+919876543210" */
  memberKey: string;
  name: string | null;
  pointsBalance: number;
  /** Balance × point value, paise. */
  pointsValue: number;
  lifetimeSpend: number;
  tier: string;
  joinedAt: ISODate;
  lastActivityAt: ISODate | null;
}

export type LedgerType = "earn" | "redeem" | "expire" | "adjust" | "reverse";
export const LEDGER_TYPES: readonly LedgerType[] = ["earn", "redeem", "expire", "adjust", "reverse"];

export interface LedgerEntry {
  id: string;
  type: LedgerType;
  points: number;
  amountPaise: number;
  remaining: number;
  refType: "invoice" | "order" | "manual" | "lot";
  refId: string;
  expiresAt: ISODate | null;
  note: string | null;
  createdAt: ISODate;
}

export interface MemberDetail {
  member: LoyaltyMember;
  ledger: Paged<LedgerEntry>;
  nextTier: { tier: LoyaltyTier; spendNeeded: number } | null;
  expiringSoon: { expiresAt: ISODate; points: number }[];
}

/** `GET /loyalty/summary`: the whole shop. */
export interface LoyaltySummary {
  members: number;
  points: number;
  /** Paise. */
  liability: number;
}

export interface LoyaltyQuote {
  balance: number;
  maxPoints: number;
  maxDiscount: number;
  minRedeemPoints: number;
  pointValuePaise: number;
  canRedeem: boolean;
  reason: "no_points" | "below_min" | "order_too_small" | "disabled" | null;
  member: LoyaltyMember | null;
  earnPreview: number;
}

// ---------------------------------------------------------------- kyc (/v1/kyc)

export type KycSubjectType = "vendor" | "shop" | "user";
export type KycSubjectStatus = "none" | "pending" | "verified" | "failed" | "manual_review";
export type KycCheckType = "pan" | "gstin" | "bank_account" | "upi" | "digilocker_aadhaar" | "selfie";
export type KycCheckStatus = "pending" | "verified" | "failed" | "manual_review";
export type KycDocumentKind =
  | "pan_card"
  | "gst_certificate"
  | "cancelled_cheque"
  | "bank_statement"
  | "aadhaar_masked"
  | "address_proof"
  | "shop_photo"
  | "selfie"
  | "other";
export const KYC_DOCUMENT_KINDS: readonly KycDocumentKind[] = [
  "gst_certificate",
  "pan_card",
  "address_proof",
  "shop_photo",
  "cancelled_cheque",
  "bank_statement",
  "other",
];

export interface KycCheck {
  id: string;
  subjectId: string;
  type: KycCheckType;
  status: KycCheckStatus;
  provider: string;
  /** Masked input, e.g. { pan: "ABCDE****F", name }. */
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  nameOnRecord: string | null;
  nameMatchScore: number | null;
  error: string | null;
  review: { decision: "approved" | "rejected"; reason: string | null; by: string | null; at: ISODate | null } | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface KycDocument {
  id: string;
  kind: KycDocumentKind;
  fileUrl: string;
  createdAt: ISODate;
}

export interface KycSubject {
  subjectType: KycSubjectType;
  subjectId: string;
  status: KycSubjectStatus;
  verified: boolean;
  verifiedName: string | null;
  /** `pan`, `gstin`, `bank`, `upi`, `aadhaar`, `selfie`, `verified`. */
  badges: string[];
  missing: string[];
  updatedAt: ISODate | null;
  checks: KycCheck[];
  documents: KycDocument[];
}

// ---------------------------------------------------------------- e-invoice (/v1/einvoice)

export interface EInvoiceAccount {
  configured: boolean;
  provider: "mock" | "gsp" | null;
  gstin: string | null;
  username: string | null;
  passwordSet: boolean;
  clientCredentialsSet: boolean;
  sandbox: boolean;
  enabled: boolean;
  options: { maxAgeDays?: number | null; minHsnDigits?: 4 | 6 | 8 };
  usingMock: boolean;
}

export interface EInvoiceAccountInput {
  provider: "mock" | "gsp";
  gstin: string;
  username?: string;
  password?: string;
  clientId?: string | null;
  clientSecret?: string | null;
  sandbox?: boolean;
  enabled?: boolean;
  maxAgeDays?: number | null;
  minHsnDigits?: 4 | 6 | 8;
}

// ---------------------------------------------------------------- branches (/v1/branches)

export interface Branch {
  id: string;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  pincode: string | null;
  phone: string | null;
  gstin: string | null;
  stateCode: string | null;
  stockLocationId: string | null;
  invoicePrefix: string;
  active: boolean;
  isDefault: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface BranchInput {
  name: string;
  code: string;
  address?: string | null;
  city?: string | null;
  pincode?: string | null;
  phone?: string | null;
  gstin?: string | null;
  stateCode?: string | null;
  invoicePrefix?: string | null;
  stockLocationId?: string | null;
  createLocation?: boolean;
  isDefault?: boolean;
  active?: boolean;
}

export interface BranchUser {
  userId: string;
  branchId: string;
  isDefault: boolean;
}

export interface BranchSummaryRow {
  branchId: string;
  name: string;
  code: string;
  active: boolean;
  isDefault: boolean;
  sales: number;
  bills: number;
  stockValue: number | null;
}

export interface BranchSummary {
  from: string;
  to: string;
  items: BranchSummaryRow[];
  total: number;
  consolidated: { sales: number; bills: number; stockValue: number };
}

/** Inventory stock location (GET /v1/inventory/locations). */
export interface StockLocation {
  id: string;
  name: string;
  code: string;
  type: string;
  address: string | null;
  isDefault: boolean;
  active: boolean;
}

/** Staff member (GET /v1/staff/members). */
export interface StaffMember {
  userId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  roles: string[];
  /** owner / admin always work in every branch. */
  level?: "owner" | "admin" | "staff" | "member" | null;
  active: boolean;
}

// ---------------------------------------------------------------- developer (/v1/developer)

export interface ApiKey {
  id: string;
  name: string;
  /** First 12 characters, e.g. "sk_live_Ab3x". */
  prefix: string;
  scopes: string[];
  lastUsedAt: ISODate | null;
  expiresAt: ISODate | null;
  revokedAt: ISODate | null;
  createdBy: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  status: "active" | "revoked" | "expired";
}

export interface ScopeDef {
  key: string;
  module: string;
  label: string;
  description: string;
}

export interface WebhookEventDef {
  type: string;
  module: string;
  label: string;
  description: string;
  sample: Record<string, unknown>;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  description: string | null;
  consecutiveFailures: number;
  disabledAt: ISODate | null;
  disabledReason: string | null;
  lastSuccessAt: ISODate | null;
  lastFailureAt: ISODate | null;
  createdBy: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type DeliveryStatus = "pending" | "succeeded" | "failed";

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  eventId: string;
  type: string;
  /** Only on GET /deliveries/:id. */
  payload?: unknown;
  status: DeliveryStatus;
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number | null;
  nextAttemptAt: ISODate | null;
  lastAttemptAt: ISODate | null;
  deliveredAt?: ISODate | null;
  createdAt: ISODate;
}

// ---------------------------------------------------------------- reports (/v1/reports)

export type ColumnType = "text" | "number" | "money" | "date" | "enum";
export type FilterOp = "eq" | "neq" | "in" | "gte" | "lte" | "between" | "contains";
export type MeasureFn = "sum" | "count" | "avg" | "min" | "max";
export type DateBucket = "day" | "week" | "month" | "quarter" | "year";
export type DatePreset =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_30_days"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "this_fy"
  | "last_fy";

export interface DatasetColumn {
  key: string;
  label: string;
  type: ColumnType;
  description?: string;
  filterable?: boolean;
  groupable?: boolean;
  aggregatable?: boolean;
  options?: { value: string; label: string }[];
  default?: boolean;
}

export interface DatasetInfo {
  id: string;
  label: string;
  description?: string;
  module: string;
  feature?: string;
  permission?: string;
  columns: DatasetColumn[];
  defaultSort: { column: string; dir: "asc" | "desc" };
  dateColumn?: string;
  ops: Record<ColumnType, FilterOp[]>;
  measures: MeasureFn[];
  dateBuckets: DateBucket[];
  datePresets: DatePreset[];
}

export interface ReportFilter {
  column: string;
  op: FilterOp;
  value: unknown;
}

export interface ReportSpec {
  dataset: string;
  columns?: string[];
  filters?: ReportFilter[];
  /** Column keys, or "<dateColumn>:<bucket>". */
  groupBy?: string[];
  measures?: { column?: string; fn: MeasureFn }[];
  sort?: { column: string; dir: "asc" | "desc" }[];
  limit?: number;
  dateRange?: { from: string; to: string } | { preset: DatePreset } | null;
  totals?: boolean;
}

export interface RunColumn {
  key: string;
  label: string;
  type: ColumnType;
  fn?: MeasureFn;
  column: string | null;
  bucket?: DateBucket;
  options?: { value: string; label: string }[];
  aggregatable?: boolean;
}

export type ReportRow = Record<string, string | number | null>;

export interface RunResult {
  dataset: string;
  mode: "rows" | "grouped";
  columns: RunColumn[];
  rows: ReportRow[];
  totals: ReportRow | null;
  rowCount: number;
  truncated: boolean;
  limit: number;
  dateRange: { column: string; from: string; to: string } | null;
  generatedAt: ISODate;
}

export interface SavedReport {
  id: string;
  name: string;
  description: string | null;
  dataset: string;
  spec: ReportSpec;
  createdBy: string | null;
  shared: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type SchedulePreset = "daily" | "weekly" | "monthly";
export type ReportFormat = "csv" | "xlsx";

export interface ReportSchedule {
  id: string;
  reportId: string;
  preset: SchedulePreset;
  cron: string;
  recipients: string[];
  format: ReportFormat;
  active: boolean;
  lastRunAt: ISODate | null;
  nextRunAt: ISODate | null;
  lastStatus: "ok" | "failed" | "skipped" | null;
  lastError: string | null;
  lastRowCount: number | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  timing: { preset: SchedulePreset; hour: number; minute: number; weekday: number; dayOfMonth: number } | null;
}

export interface ScheduleInput {
  reportId: string;
  preset: SchedulePreset;
  hour?: number;
  minute?: number;
  weekday?: number;
  dayOfMonth?: number;
  recipients: string[];
  format?: ReportFormat;
  active?: boolean;
}
