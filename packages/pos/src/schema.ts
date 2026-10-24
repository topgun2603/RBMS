import { pk, tenantId, timestamps } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const TERMINAL_ROLES = ["pos", "weighing"] as const;
export type TerminalRole = (typeof TERMINAL_ROLES)[number];

export const DEVICE_PLATFORMS = ["web", "android", "ios"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export interface TerminalSettings {
  printerWidth?: 58 | 80;
  autoPrint?: boolean;
  /** Minutes without use before the PIN lock screen comes back (1–60, default 5). */
  lockAfterMinutes?: number;
}

export interface DeviceInfo {
  platform: DevicePlatform;
  model: string | null;
  appVersion: string | null;
  name: string | null;
}

/**
 * A checkout or weighing point of a shop ("Counter 1", "Weighing 1"), docs/pos-terminals.md. Its name is also the
 * till `register`. One paired device at a time: only the sha256 of its device token (and of a pending pairing code)
 * is stored.
 */
export const posTerminals = pgTable(
  "pos_terminals",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    role: text("role").$type<TerminalRole>().notNull().default("pos"),
    branchId: uuid("branch_id"),
    /** The branch's stock location when the terminal was saved. */
    locationId: uuid("location_id"),
    settings: jsonb("settings").$type<TerminalSettings>().notNull().default({}),
    /** sha256 (hex) of the paired device's token; null = not paired. */
    deviceTokenHash: text("device_token_hash"),
    device: jsonb("device").$type<DeviceInfo>(),
    pairedAt: timestamp("paired_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    /** sha256 (hex) of the pending pairing code (normalised: upper case, no dash). */
    pairingCodeHash: text("pairing_code_hash"),
    pairingExpiresAt: timestamp("pairing_expires_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("pos_terminals_tenant_name_uq").on(t.tenantId, sql`lower(${t.name})`).where(sql`${t.deletedAt} is null`),
    uniqueIndex("pos_terminals_device_token_uq").on(t.deviceTokenHash),
    uniqueIndex("pos_terminals_pairing_code_uq").on(t.pairingCodeHash),
    index("pos_terminals_tenant_idx").on(t.tenantId),
    check("pos_terminals_role_chk", sql`${t.role} in ('pos', 'weighing')`),
  ],
);

/** A member's POS PIN in a shop: only an HMAC of `tenantId:pin` is stored; unique within the shop. */
export const posStaffPins = pgTable(
  "pos_staff_pins",
  {
    tenantId: tenantId(),
    userId: uuid("user_id").notNull(),
    /** HMAC-SHA256(key derived from APP_SECRET, `${tenantId}:${pin}`), hex. */
    pinLookup: text("pin_lookup").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] }), uniqueIndex("pos_staff_pins_tenant_lookup_uq").on(t.tenantId, t.pinLookup)],
);

/** Wrong PINs in a row per terminal (lockout bookkeeping). */
export const posPinAttempts = pgTable("pos_pin_attempts", {
  terminalId: uuid("terminal_id").primaryKey(),
  failures: integer("failures").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const WEIGH_TICKET_STATUSES = ["open", "used", "cancelled"] as const;
export type WeighTicketStatus = (typeof WEIGH_TICKET_STATUSES)[number];

export interface WeighTicketLine {
  itemId: string;
  name: string;
  unit: string;
  /** Net weight (kg, or g for gram-priced items) or count; 3 decimals. */
  qty: number;
  /** Paise per unit, as the catalogue sells it (incl. GST when `taxInclusive`). */
  unitPrice: number;
  /** Paise: unitPrice × qty, rounded to the paisa. */
  amount: number;
  taxInclusive: boolean;
  gstRate: number;
  hsn: string | null;
  /** Packaging weight taken off (kg), weighed lines only. */
  tareKg?: number;
}

/** A weighing station's ticket: lines priced by the server, scanned once at the POS. */
export const posWeighTickets = pgTable(
  "pos_weigh_tickets",
  {
    id: pk(),
    tenantId: tenantId(),
    terminalId: uuid("terminal_id").notNull(),
    /** "W" + 11 digits; also the Code 128 barcode text. */
    code: text("code").notNull(),
    status: text("status").$type<WeighTicketStatus>().notNull().default("open"),
    lines: jsonb("lines").$type<WeighTicketLine[]>().notNull(),
    total: integer("total").notNull(),
    note: text("note"),
    createdBy: uuid("created_by").notNull(),
    usedInvoiceId: uuid("used_invoice_id"),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** End of the IST day it was weighed. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("pos_weigh_tickets_tenant_code_uq").on(t.tenantId, t.code),
    index("pos_weigh_tickets_terminal_idx").on(t.tenantId, t.terminalId, t.createdAt),
    index("pos_weigh_tickets_invoice_idx").on(t.tenantId, t.usedInvoiceId),
  ],
);

export type TerminalRow = typeof posTerminals.$inferSelect;
export type StaffPinRow = typeof posStaffPins.$inferSelect;
export type WeighTicketRow = typeof posWeighTickets.$inferSelect;
