import type { TenantRef } from "@srirealtime/core";

export type { FeatureGatePort } from "@srirealtime/core";

/** Implemented with tenancy (`toTenantRef` of an active tenant). Null for unknown or suspended tenants. */
export interface TenantLookupPort {
  byId(tenantId: string): Promise<TenantRef | null>;
}

/**
 * What modules call to publish webhook events (wired in kit to `developer.service`). `emit` never throws and returns
 * quickly; deliveries happen in the background.
 */
export interface EventsPort {
  emit(tenantId: string, type: string, data: unknown): Promise<void>;
}

/** Subset of the jobs service (same shape as @srirealtime/jobs `QueuePort`). */
export interface QueuePort {
  define<T>(name: string, handler: (data: T, meta: { attempt: number; jobId: string }) => Promise<void>, opts?: { attempts?: number; backoffMs?: number; concurrency?: number }): void;
  enqueue<T>(name: string, data: T, opts?: { delayMs?: number; jobId?: string }): Promise<void>;
}

export interface NotifierSendInput {
  tenantId: string;
  channel: "whatsapp" | "sms" | "email";
  /** E.164 phone or email address. */
  to: string;
  /** Notify template key, e.g. "developer.webhook_disabled". */
  template: string;
  vars: Record<string, string>;
  locale?: string;
}

/** Implemented by the notify module (same shape as orders' NotifierPort). Best effort: failures are logged. */
export interface NotifierPort {
  send(input: NotifierSendInput): Promise<{ logId: string }>;
}

/** The shop owner's contact, for "your webhook was switched off" (kit: tenancy owner membership + users). */
export interface OwnerContactPort {
  ownerContact(tenantId: string): Promise<{ email?: string | null; phone?: string | null; locale?: string | null } | null>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
