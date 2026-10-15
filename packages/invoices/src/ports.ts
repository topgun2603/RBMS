import type { TenantRef } from "@srirealtime/core";

/** The shop's own details, read from the `billing` settings namespace (apps/api wires it). */
export interface SellerProfile {
  legalName: string | null;
  gstin: string | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  /** 2-digit GST state code; required before issuing. */
  stateCode: string | null;
  phone: string | null;
  email: string | null;
  /** Default "INV"; sanitised to A-Z, 0-9, "-" and max 6 characters. */
  invoicePrefix: string | null;
  terms: string | null;
  bankName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  upiId: string | null;
  /** WhatsApp reminders for overdue bills (default false). */
  autoReminders: boolean;
  /** Reminders go out this many days after the due date (default [1, 7, 15]). */
  reminderDays: number[];
  /** Thank-you message when a bill is paid online (default true). */
  sendPaymentReceipts: boolean;
}

export const DEFAULT_REMINDER_DAYS: readonly number[] = [1, 7, 15];

/** The text fields of the seller profile. */
export const SELLER_FIELDS = [
  "legalName",
  "gstin",
  "address",
  "city",
  "pincode",
  "stateCode",
  "phone",
  "email",
  "invoicePrefix",
  "terms",
  "bankName",
  "accountNumber",
  "ifsc",
  "upiId",
] as const satisfies readonly (keyof SellerProfile)[];

/** Buyer details frozen on the invoice. */
export interface CustomerSnapshot {
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  stateCode: string | null;
}

export interface SellerProfilePort {
  /** May return a partial profile; missing fields are treated as null. */
  get(tenantId: string): Promise<Partial<SellerProfile> | SellerProfile>;
}

/** Implemented by the plans module (usage limits; feature access is enforced through route `config.feature`). */
export interface EntitlementsPort {
  /** Throws 402 plan_limit `{ key, limit, used }` when over the limit; returns new usage. */
  consume(tenant: TenantRef, key: string, amount?: number): Promise<number>;
  release?(tenant: TenantRef, key: string, amount?: number): Promise<void>;
}

/** Implemented by the branding module, used on the public invoice page. */
export interface BrandingPort {
  get(tenantId: string): Promise<{ appName: string | null; logoUrl: string | null; css: string }>;
}

/** Implemented by the inventory module. Both calls are idempotent per `refId` (the invoice id). */
export interface StockPort {
  applySale(
    tenantId: string,
    sale: { refId: string; lines: { itemId: string; qty: number }[]; refNumber?: string | null },
  ): Promise<unknown>;
  reverseSale(tenantId: string, refId: string): Promise<unknown>;
}

/** A saved item as an item source returns it (`rate` = GST-exclusive paise per unit). */
export interface ItemSourceRecord {
  id: string;
  name: string;
  hsn: string | null;
  unit: string;
  rate: number;
  gstRate: number;
  createdAt: Date;
}

/** Validated item fields handed to the source (already parsed by the invoices item schemas). */
export interface ItemSourceInput {
  name: string;
  hsn: string | null;
  unit: string;
  rate: number;
  gstRate: number;
}

/**
 * Where saved items live when not in `billing_items` (implemented with the catalogue in apps/api: an item is a catalogue
 * variant). When wired, every `/v1/invoices/items*` route and getItem/listItems/createItem/updateItem/deleteItem use it.
 */
export interface ItemSourcePort {
  list(tenantId: string, query: { q?: string; limit: number; offset: number }): Promise<{ items: ItemSourceRecord[]; total: number }>;
  /** Null when unknown or deleted. */
  get(tenantId: string, id: string): Promise<ItemSourceRecord | null>;
  create(tenantId: string, input: ItemSourceInput): Promise<ItemSourceRecord>;
  /** Null when unknown or deleted. */
  update(tenantId: string, id: string, patch: Partial<ItemSourceInput>): Promise<ItemSourceRecord | null>;
  /** False when unknown or already deleted. */
  remove(tenantId: string, id: string): Promise<boolean>;
}

export interface NotifierSendInput {
  tenantId: string;
  channel: "whatsapp" | "sms";
  /** E.164, e.g. "+919876543210". */
  to: string;
  /** Notify template key, e.g. "invoice.issued". */
  template: string;
  vars: Record<string, string>;
  locale?: string;
}

/** Implemented by the notify module. */
export interface NotifierPort {
  send(input: NotifierSendInput): Promise<{ logId: string }>;
}

/** Implemented by the payments module: whether the shop can take online payments. */
export interface PaymentsAvailabilityPort {
  isEnabled(tenantId: string): Promise<{ enabled: boolean; provider: "razorpay" | "mock" | null; mode?: "test" | "live" | null }>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
