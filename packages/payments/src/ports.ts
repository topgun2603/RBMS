export type PaymentMethod = "upi" | "card" | "bank" | "wallet" | "other";
export type PaymentProvider = "razorpay" | "mock";
export type PaymentMode = "test" | "live";

export interface ResolvedPurpose {
  tenantId: string;
  purposeId: string;
  /** Paise. */
  amount: number;
  description: string;
  customer?: { name?: string; phone?: string; email?: string };
  payable: boolean;
  reason?: string;
}

export interface PaidEvent {
  tenantId: string;
  purposeId: string;
  /** Paise; the stored order amount. */
  amount: number;
  method: PaymentMethod;
  provider: PaymentProvider;
  providerPaymentId: string;
  paidAt: Date;
}

/** Something that can be paid for online. Modules register one per kind (invoices registers "invoice"). */
export interface PaymentPurpose {
  resolve(ref: string): Promise<ResolvedPurpose>;
  /** Called once per order. Must itself be idempotent on providerPaymentId (retryPending may re-invoke it). */
  onPaid(p: PaidEvent): Promise<void>;
}

/** Display name of the shop shown in the checkout sheet (apps/api wires it from tenancy/settings). */
export type ShopNamePort = (tenantId: string) => Promise<string | null | undefined> | string | null | undefined;

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
