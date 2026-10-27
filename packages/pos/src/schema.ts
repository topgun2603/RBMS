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

// ------------------------------------------------------------------ offline billing (docs/offline-billing.md)

export const NUMBER_BLOCK_STATUSES = ["open", "closed"] as const;
export type NumberBlockStatus = (typeof NUMBER_BLOCK_STATUSES)[number];

/** A sequence number released without a bill, with the reason (the audit trail of "no silent gaps"). */
export interface VoidedSeq {
  seq: number;
  reason: "unused" | "bill_voided" | "lost_device" | "other";
  at: string;
  by: string | null;
  /** The offline bill (client id) that was voided at the counter, if any. */
  clientId?: string;
}

/**
 * A block of consecutive invoice numbers taken from the (branch, FY) invoice series for one device ahead of time, so
 * it can number bills while offline. Every number ends up either on a synced bill (`pos_offline_bills.block_id` +
 * `seq`) or in `voided` with a reason: the block is closed only when all of them are accounted for.
 */
export const posNumberBlocks = pgTable(
  "pos_number_blocks",
  {
    id: pk(),
    tenantId: tenantId(),
    /** The paired terminal's id, or a browser-generated device id (staff browser) when not paired. */
    deviceId: text("device_id").notNull(),
    terminalId: uuid("terminal_id"),
    branchId: uuid("branch_id"),
    fy: text("fy").notNull(),
    prefix: text("prefix").notNull(),
    fromSeq: integer("from_seq").notNull(),
    toSeq: integer("to_seq").notNull(),
    status: text("status").$type<NumberBlockStatus>().notNull().default("open"),
    voided: jsonb("voided").$type<VoidedSeq[]>().notNull().default([]),
    reservedBy: uuid("reserved_by"),
    closedBy: uuid("closed_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closeNote: text("close_note"),
    ...timestamps(),
  },
  (t) => [
    index("pos_number_blocks_tenant_device_idx").on(t.tenantId, t.deviceId, t.status),
    check("pos_number_blocks_range_chk", sql`${t.toSeq} >= ${t.fromSeq}`),
  ],
);

export const OFFLINE_BILL_STATUSES = ["processing", "synced", "failed", "voided"] as const;
export type OfflineBillStatus = (typeof OFFLINE_BILL_STATUSES)[number];

/** Something a person should look at after an offline bill synced (the bill itself stands as sold). */
export interface OfflineFlag {
  code:
    | "stock_negative"
    | "price_changed"
    | "tax_changed"
    | "item_missing"
    | "customer_missing"
    | "number_reassigned"
    | "till_closed"
    | "payment_failed"
    | "late_sync";
  /** 0-based line index the flag is about. */
  line?: number;
  detail?: Record<string, unknown>;
}

/**
 * One bill made offline and sent to the server. `client_id` is the idempotency key (a UUID made on the device): the
 * unique index makes a replay answer with the first result instead of billing twice.
 */
export const posOfflineBills = pgTable(
  "pos_offline_bills",
  {
    id: pk(),
    tenantId: tenantId(),
    clientId: uuid("client_id").notNull(),
    deviceId: text("device_id").notNull(),
    userId: uuid("user_id"),
    status: text("status").$type<OfflineBillStatus>().notNull().default("processing"),
    attempts: integer("attempts").notNull().default(1),
    /** When this attempt started; a processing row older than a couple of minutes is taken over by a retry. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    /** The bill as the device built it (lines, payments, customer, numbers). */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** When the cashier completed it on the device. */
    billedAt: timestamp("billed_at", { withTimezone: true }).notNull(),
    blockId: uuid("block_id"),
    seq: integer("seq"),
    /** "OFF-A1B2-0007" printed on the slip when no reserved number was available. */
    provisionalNumber: text("provisional_number"),
    invoiceId: uuid("invoice_id"),
    /** The legal invoice number. */
    number: text("number"),
    flags: jsonb("flags").$type<OfflineFlag[]>().notNull().default([]),
    error: jsonb("error").$type<{ code: string; message: string } | null>(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by"),
    reviewNote: text("review_note"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("pos_offline_bills_tenant_client_uq").on(t.tenantId, t.clientId),
    // A reserved number is used by at most one bill.
    uniqueIndex("pos_offline_bills_block_seq_uq").on(t.blockId, t.seq).where(sql`${t.blockId} is not null`),
    index("pos_offline_bills_tenant_status_idx").on(t.tenantId, t.status, t.createdAt),
    index("pos_offline_bills_tenant_invoice_idx").on(t.tenantId, t.invoiceId),
  ],
);

export type NumberBlockRow = typeof posNumberBlocks.$inferSelect;
export type OfflineBillRow = typeof posOfflineBills.$inferSelect;

export interface DisplaySettings {
  /** Language of the screen: "auto" follows the cashier's choice sent with each bill. */
  language?: "auto" | "en" | "ta";
  /** Seconds each idle slide stays up (3–60, default 8). */
  slideSeconds?: number;
}

/**
 * A customer-facing display (docs/counter-close-display-labels.md): a second screen or tablet that shows the bill the
 * cashier is ringing up. It belongs to one register (the till / terminal name), has no account: it holds a scoped
 * token that can only read that register's display feed. Only the sha256 of the token and of a pending pairing code
 * is stored; revoking sets `revokedAt`.
 */
export const posDisplays = pgTable(
  "pos_displays",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    /** The register (terminal name) whose bill this screen shows. */
    register: text("register").notNull(),
    settings: jsonb("settings").$type<DisplaySettings>().notNull().default({}),
    /** sha256 (hex) of the display token; null until paired. */
    tokenHash: text("token_hash"),
    pairedAt: timestamp("paired_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    /** sha256 (hex) of the pending pairing code (6 digits). */
    pairingCodeHash: text("pairing_code_hash"),
    pairingExpiresAt: timestamp("pairing_expires_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("pos_displays_token_uq").on(t.tokenHash),
    uniqueIndex("pos_displays_pairing_code_uq").on(t.pairingCodeHash),
    index("pos_displays_tenant_register_idx").on(t.tenantId, t.register),
  ],
);

export type DisplayRow = typeof posDisplays.$inferSelect;
