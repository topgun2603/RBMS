/** API shapes of /v1/marketplace and /v1/kyc as the UI receives them (dates are ISO strings). */

export type ISODate = string;

export const VENDOR_STATUSES = ["pending", "active", "suspended"] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const VENDOR_KYC_STATUSES = ["none", "pending", "verified", "failed"] as const;
export type VendorKycStatus = (typeof VENDOR_KYC_STATUSES)[number];

export const PAYOUT_ACCOUNT_STATUSES = ["none", "pending", "verified", "rejected"] as const;
export type PayoutAccountStatus = (typeof PAYOUT_ACCOUNT_STATUSES)[number];

export const SETTLEMENT_STATUSES = ["pending", "eligible", "settled", "reversed"] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const LEDGER_TYPES = ["sale", "commission", "refund", "payout", "adjustment"] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

export const PAYOUT_STATUSES = ["pending", "processing", "paid", "failed", "cancelled"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const PAYOUT_PROVIDERS = ["manual", "mock", "razorpayRoute"] as const;
export type PayoutProvider = (typeof PAYOUT_PROVIDERS)[number];

export const ORDER_STATUSES = ["placed", "confirmed", "packed", "shipped", "delivered", "cancelled", "returned"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type VendorUserRole = "owner" | "staff";

export interface ListResult<T> {
  items: T[];
  total: number;
}

export interface VendorAddress {
  line1: string;
  line2?: string | null;
  city: string;
  district?: string | null;
  stateCode: string;
  pincode: string;
}

export type MaskedPayoutAccount =
  | { type: "bank"; holderName: string; ifsc: string; last4: string }
  | { type: "upi"; vpa: string; holderName: string | null }
  | { type: "route"; accountId: string };

export type PayoutAccountInput =
  | { type: "bank"; holderName: string; accountNumber: string; ifsc: string }
  | { type: "upi"; vpa: string; holderName?: string }
  | { type: "route"; accountId: string };

export interface LedgerBalance {
  balance: number;
  sales: number;
  commission: number;
  refunds: number;
  payouts: number;
  adjustments: number;
}

export interface Vendor {
  id: string;
  name: string;
  slug: string;
  status: VendorStatus;
  kycStatus: VendorKycStatus;
  commissionBps: number | null;
  effectiveCommissionBps: number;
  description: string | null;
  logoUrl: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  gstin: string | null;
  address: VendorAddress | null;
  payoutAccount: MaskedPayoutAccount | null;
  payoutAccountStatus: PayoutAccountStatus;
  notes?: string | null;
  approvedAt: ISODate | null;
  suspendedAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface VendorDetail extends Vendor {
  users: { userId: string; role: VendorUserRole; createdAt: ISODate }[];
  balance: LedgerBalance;
  productCount: number | null;
}

export type VendorSelf = Vendor & { role: VendorUserRole; balance: LedgerBalance; productCount: number | null };

export interface VendorListResponse extends ListResult<Vendor> {
  counts: Record<VendorStatus, number>;
}

export interface VendorMembership {
  vendorId: string;
  slug: string;
  name: string;
  role: VendorUserRole;
}

export interface VendorOrderLine {
  variantId: string;
  productId: string;
  name: string;
  sku: string | null;
  image: string | null;
  qty: number;
  unit: string;
  price: number;
  gstRate: number;
  gross: number;
  total: number;
}

export interface VendorOrder {
  id: string;
  orderId: string;
  orderNumber: string;
  vendorId: string;
  vendorName?: string;
  lines: VendorOrderLine[];
  subtotal: number;
  discount: number;
  shippingShare: number;
  commissionBps: number;
  commission: number;
  net: number;
  status: OrderStatus;
  settlementStatus: SettlementStatus;
  placedAt: ISODate;
  deliveredAt: ISODate | null;
  eligibleAt: ISODate | null;
  settledAt: ISODate | null;
  payoutId: string | null;
}

export interface LedgerEntry {
  id: string;
  vendorId: string;
  vendorName?: string;
  type: LedgerType;
  amount: number;
  refType: string | null;
  refId: string | null;
  note: string | null;
  createdAt: ISODate;
}

export interface LedgerResponse extends ListResult<LedgerEntry> {
  balance: LedgerBalance | null;
}

export interface Payout {
  id: string;
  vendorId: string;
  vendorName?: string;
  amount: number;
  status: PayoutStatus;
  provider: PayoutProvider;
  providerRef: string | null;
  attempts: number;
  error: string | null;
  periodFrom: ISODate | null;
  periodTo: ISODate;
  createdAt: ISODate;
  paidAt: ISODate | null;
}

export type PayoutSkipReason =
  | "nothing_due"
  | "below_minimum"
  | "vendor_not_active"
  | "kyc_not_verified"
  | "no_payout_account"
  | "account_not_supported";

export interface PayoutRunResult {
  until: ISODate;
  released: number;
  created: Payout[];
  skipped: { vendorId: string; vendorName: string; reason: PayoutSkipReason; balance: number }[];
}

export interface VendorProduct {
  id: string;
  name: string;
  slug: string;
  status: string;
  image: string | null;
  priceMin: number;
  priceMax: number;
}

export interface PublicVendor {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  productCount: number | null;
  products: ListResult<VendorProduct>;
}

export interface MarketplaceSettings {
  defaultCommissionBps: number;
  returnWindowDays: number;
  minPayoutPaise: number;
  requireKyc: boolean;
  payoutProvider: PayoutProvider;
  acceptApplications: boolean;
}

export const MARKETPLACE_SETTINGS_DEFAULTS: MarketplaceSettings = {
  defaultCommissionBps: 1000,
  returnWindowDays: 7,
  minPayoutPaise: 50_000,
  requireKyc: true,
  payoutProvider: "manual",
  acceptApplications: true,
};

// ---------------------------------------------------------------- kyc

export const KYC_CHECK_TYPES = ["pan", "gstin", "bank_account", "upi", "digilocker_aadhaar", "selfie"] as const;
export type KycCheckType = (typeof KYC_CHECK_TYPES)[number];
export type KycCheckStatus = "pending" | "verified" | "failed" | "manual_review";
export type KycSubjectStatus = "none" | "pending" | "verified" | "failed" | "manual_review";

export interface KycCheck {
  id: string;
  subjectId: string;
  type: KycCheckType;
  status: KycCheckStatus;
  provider: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  nameOnRecord: string | null;
  nameMatchScore: number | null;
  error: string | null;
  review: { decision: "approved" | "rejected"; reason: string | null; by: string | null; at: ISODate | null } | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface KycSubject {
  subjectType: "vendor" | "shop" | "user";
  subjectId: string;
  status: KycSubjectStatus;
  verified: boolean;
  verifiedName: string | null;
  badges: string[];
  missing: string[];
  updatedAt: ISODate | null;
  checks: KycCheck[];
  documents: { id: string; kind: string; fileUrl: string; createdAt: ISODate }[];
}

export interface KycCheckResponse {
  check: KycCheck;
  subject: Omit<KycSubject, "checks" | "documents">;
}

// ---------------------------------------------------------------- catalogue (vendor-scoped)

export type ProductStatus = "active" | "draft" | "archived";

export interface ProductImage {
  url: string;
  alt?: string | null;
}

export interface ProductOption {
  name: string;
  values: string[];
}

export interface CatalogVariant {
  id: string;
  productId: string;
  sku: string | null;
  barcode: string | null;
  title: string;
  optionValues: Record<string, string>;
  price: number;
  mrp: number | null;
  cost: number | null;
  weightGrams: number | null;
  position: number;
  isDefault: boolean;
}

export interface CatalogProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  categoryId: string | null;
  hsn: string | null;
  gstRate: number;
  unit: string;
  taxInclusive: boolean;
  status: ProductStatus;
  options: ProductOption[];
  images: ProductImage[];
  variants: CatalogVariant[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface CatalogProductSummary {
  id: string;
  name: string;
  slug: string;
  status: ProductStatus;
  categoryName: string | null;
  image: string | null;
  priceMin: number;
  priceMax: number;
  variantCount: number;
  updatedAt: ISODate;
}

export interface UploadSignResponse {
  fileId: string;
  key: string;
  upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresIn: number };
}

export interface UploadedFile {
  id: string;
  url: string;
  thumbUrl: string | null;
}
