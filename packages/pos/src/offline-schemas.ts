import { z } from "zod";
import { OFFLINE_BILL_STATUSES } from "./schema";

/** Request shapes of the offline billing routes (docs/offline-billing.md). */

const uuid = z.string().uuid();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
/** A browser-generated device id (staff browser) or a paired terminal's id. */
export const offlineDeviceId = z
  .string()
  .trim()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_.:-]+$/);

export const offlineLine = z
  .object({
    description: z.string().trim().min(1).max(300),
    qty: z.number().positive().max(1_000_000),
    rate: z.number().int().min(0),
    gstRate: z.number().min(0).max(100),
    itemId: z.string().max(64).optional(),
  })
  .passthrough();

export const offlinePayment = z.object({
  method: z.enum(["cash", "upi", "card"]),
  amount: z.number().int().positive(),
  reference: z.string().trim().max(100).optional(),
});

/** The catalogue price the cashier saw offline for an item (to notice a change by the time the bill syncs). */
export const offlineSnapshot = z.object({ itemId: z.string().max(64), price: z.number().int().min(0), gstRate: z.number().min(0).max(100) });

export const offlineBillBody = z.object({
  /** UUID made on the device: the idempotency key of this bill. */
  clientId: uuid,
  deviceId: offlineDeviceId,
  /** When the cashier completed the bill (device clock). */
  billedAt: z.string().datetime({ offset: true }),
  /** Bill date (IST). */
  date: dateStr,
  /** The reserved number consumed: the block and the sequence in it. */
  number: z.object({ blockId: uuid, seq: z.number().int().min(1) }).optional(),
  /** "OFF-A1B2-0007" shown on the slip when no reserved number was left. */
  provisionalNumber: z.string().trim().max(24).optional(),
  customerId: uuid.optional(),
  customer: z.object({ name: z.string().trim().max(120), phone: z.string().trim().max(20).optional() }).optional(),
  lines: z.array(offlineLine).min(1).max(200),
  snapshots: z.array(offlineSnapshot).max(200).optional(),
  payments: z.array(offlinePayment).max(6).default([]),
  tillSessionId: uuid.optional(),
  notes: z.string().trim().max(2000).optional(),
  /** The bill was cancelled at the counter before it synced: its number is voided, no invoice is made. */
  voided: z.object({ reason: z.string().trim().min(1).max(200) }).optional(),
});
export type OfflineBillBody = z.infer<typeof offlineBillBody>;

export const MAX_SYNC_BATCH = 25;
export const syncBody = z.object({ bills: z.array(z.unknown()).min(1).max(MAX_SYNC_BATCH) });

export const reserveBody = z.object({
  deviceId: offlineDeviceId.optional(),
  count: z.number().int().min(5).max(200).default(50),
});

export const closeBlockBody = z.object({
  reason: z.enum(["unused", "lost_device"]).default("unused"),
  note: z.string().trim().max(300).optional(),
});

export const reviewBody = z.object({ note: z.string().trim().max(500).optional() });

export const billListQuery = z.object({
  status: z.enum(OFFLINE_BILL_STATUSES).optional(),
  flagged: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export const blockListQuery = z.object({ status: z.enum(["open", "closed"]).optional(), deviceId: z.string().max(64).optional() });

export const clientIdParams = z.object({ clientId: uuid });
