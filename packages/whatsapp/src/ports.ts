import type { FeatureGatePort } from "@srirealtime/core";
import type { ExternalAudienceKind, ExternalAudienceSource } from "./audience";
import type { AudienceMember } from "./logic";
import type { WhatsAppSettings } from "./settings";

export type { FeatureGatePort };

/**
 * Resolves campaign audiences that live in other modules (implemented in apps/api/src/kit.ts):
 * - `dues` → invoices credit book (customers with balance ≥ minDue; variables `amount` "₹1,250.00", `due_paise`);
 * - `recent_orders` → orders (shoppers who ordered in the last N days; variables `last_order`, `last_order_date`);
 * - `loyalty_tier` → loyalty members (variables `tier`, `points`);
 * - `customers` → billing + store customers with a mobile.
 * Phones may be in any format; whatsapp normalises to +91 and dedupes. `kinds` lists what the kit supports (all four
 * when omitted). Large audiences: return at most `limit` members.
 */
export interface AudiencePort {
  resolve(tenantId: string, source: ExternalAudienceSource, opts: { limit: number }): Promise<AudienceMember[]>;
  kinds?(tenantId: string): Promise<ExternalAudienceKind[]> | ExternalAudienceKind[];
}

/** Settings namespace `whatsapp`; `get` may return a partial object (defaults fill the rest). */
export interface WhatsAppSettingsPort {
  get(tenantId: string): Promise<Partial<WhatsAppSettings>>;
  set?(tenantId: string, patch: Partial<WhatsAppSettings>): Promise<unknown>;
}

/** Background queue (the jobs module's service satisfies it). */
export interface QueuePort {
  define<T>(name: string, handler: (data: T) => Promise<void>, opts?: { attempts?: number; concurrency?: number }): void;
  enqueue<T>(name: string, data: T, opts?: { delayMs?: number; jobId?: string }): Promise<void>;
}

/** Is this user a staff member of the shop (for assignment)? Optional; without it any uuid is accepted. */
export interface StaffDirectoryPort {
  isStaff(tenantId: string, userId: string): Promise<boolean>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
