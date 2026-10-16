import type { AuditPort } from "@srirealtime/core";
import type { InvoiceLine } from "./logic";
import type { BillingInterval, InvoiceParty, PlatformInvoiceRow } from "./schema";

/** Ports the API host (apps/api kit) implements; this package never imports another feature package. */

export interface PlanInfo {
  id: string;
  name: string;
  description: string | null;
  priceMonthlyPaise: number;
  priceYearlyPaise: number;
  modules: string[];
  limits: Record<string, number>;
  features: Record<string, boolean>;
  isPublic: boolean;
  sort: number;
}

export interface UsageInfo {
  key: string;
  period: string;
  limit: number;
  used: number;
  remaining: number | null;
}

/** The plans module. */
export interface PlansPort {
  getPlan(id: string): Promise<PlanInfo | null>;
  listPlans(opts?: { publicOnly?: boolean }): Promise<PlanInfo[]>;
  /** Limits and usage of the tenant's current plan. */
  usage(tenantId: string): Promise<UsageInfo[]>;
}

export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  planId: string | null;
  appId: string | null;
  status: string;
}

/** The tenancy module. */
export interface TenancyPort {
  getTenant(tenantId: string): Promise<TenantInfo | null>;
  /** Many tenants at once (super-admin lists); unknown ids are left out. */
  getTenants(ids: string[]): Promise<TenantInfo[]>;
  /** Tenant ids whose slug or name matches (super-admin search). */
  search(q: string): Promise<string[]>;
  /** Sets the tenant's plan (invalidates plan and feature caches). */
  setPlan(tenantId: string, planId: string): Promise<void>;
}

/** Sends to the shop's owners/admins (English or Tamil by their locale). */
export interface NotifyPort {
  toOwners(input: {
    tenantId: string;
    template: string;
    vars: Record<string, string>;
    /** Email attachments (the invoice PDF). */
    attachments?: { filename: string; contentType: string; content: string }[];
  }): Promise<void>;
}

/** A platform invoice as the PDF renderer needs it. */
export interface PlatformInvoiceDoc {
  invoice: PlatformInvoiceRow;
  planName: string;
  sac: string;
  /** The plan line and, after a plan change, the credit line (negative); they add up to the invoice totals. */
  lines?: InvoiceLine[];
}

/** PDF of a platform invoice (the documents module). */
export interface DocumentsPort {
  platformInvoicePdf(doc: PlatformInvoiceDoc): Promise<{ pdf: Buffer; filename: string }>;
}

/** The shop's GST details (billing settings) for the invoice buyer block. */
export interface ShopDetailsPort {
  buyer(tenantId: string): Promise<InvoiceParty>;
}

export interface LoggerPort {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };

export interface SubscriptionsConfig {
  /** The platform as the seller on its invoices. */
  seller: InvoiceParty & { stateCode: string };
  /** Invoice number prefix, default "SR" (SR/2026-27/00001). */
  invoicePrefix?: string;
  /** Trial length, default 14 days. */
  trialDays?: number;
  /** Grace after a failed payment, default 7 days. */
  graceDays?: number;
  /** Plan for shops without a paid subscription, default "free". */
  freePlanId?: string;
  /** Mock provider and `/mock/*` routes (never in production). */
  allowMock: boolean;
  /** Link to the shop's Plan & billing page for messages. */
  billingPageUrl?: (tenantId: string) => Promise<string>;
}

export type { AuditPort, BillingInterval };
