import { z } from "zod";
import { DEVICE_PLATFORMS, TERMINAL_ROLES, WEIGH_TICKET_STATUSES } from "./schema";

// ---------------------------------------------------------------- inputs

const name = z.string().trim().min(1, "Enter a name").max(40);
export const terminalSettingsInput = z
  .object({
    printerWidth: z.union([z.literal(58), z.literal(80)]).optional(),
    autoPrint: z.boolean().optional(),
    lockAfterMinutes: z.number().int().min(1).max(60).optional(),
  })
  .strict();

export const terminalCreateBody = z.object({
  name,
  role: z.enum(TERMINAL_ROLES),
  branchId: z.string().uuid().nullable().optional(),
  settings: terminalSettingsInput.optional(),
});
export const terminalPatchBody = z.object({
  name: name.optional(),
  role: z.enum(TERMINAL_ROLES).optional(),
  branchId: z.string().uuid().nullable().optional(),
  settings: terminalSettingsInput.optional(),
});

const short = z.string().trim().max(80).nullable().optional();
export const deviceInput = z.object({
  platform: z.enum(DEVICE_PLATFORMS),
  model: short,
  appVersion: short,
  name: short,
});
export const pairBody = z.object({ code: z.string().trim().min(1).max(20), device: deviceInput });
export const pinBody = z.object({ pin: z.string().trim().min(1).max(12) });
export const idParams = z.object({ id: z.string().uuid() });
export const userParams = z.object({ userId: z.string().uuid() });
export const codeParams = z.object({ code: z.string().trim().min(1).max(32) });

export const catalogQuery = z.object({
  since: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  after: z.string().max(400).optional(),
});

const kg = z.number().finite();
export const weighTicketBody = z.object({
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        weightKg: kg.min(0).max(9999).optional(),
        qty: z.number().finite().positive().max(99_999).optional(),
        tareKg: kg.min(0).max(999).optional(),
      }),
    )
    .min(1)
    .max(50),
  note: z.string().trim().max(200).optional(),
});
export const weighTicketListQuery = z.object({
  status: z.enum(WEIGH_TICKET_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export const useTicketBody = z.object({ invoiceId: z.string().uuid() });

// ---------------------------------------------------------------- responses (JSON: dates are ISO strings)

const iso = z.string().datetime();
export const deviceSchema = z.object({
  platform: z.enum(DEVICE_PLATFORMS),
  model: z.string().nullable(),
  appVersion: z.string().nullable(),
  name: z.string().nullable(),
});
export const terminalSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  role: z.enum(TERMINAL_ROLES),
  branchId: z.string().uuid().nullable(),
  locationId: z.string().uuid().nullable(),
  settings: z.object({ printerWidth: z.union([z.literal(58), z.literal(80)]), autoPrint: z.boolean(), lockAfterMinutes: z.number().int() }),
  paired: z.boolean(),
  device: deviceSchema.nullable(),
  pairedAt: iso.nullable(),
  lastSeenAt: iso.nullable(),
  pairingPending: z.boolean(),
  createdAt: iso,
});
export const pairingSchema = z.object({
  /** "ABCD-2345". */
  code: z.string(),
  expiresAt: iso,
  /** "srikit-pair:1:<apiOrigin>:<code>". */
  qr: z.string(),
});
export const shopSchema = z.object({ id: z.string().uuid(), slug: z.string(), name: z.string(), appId: z.string().nullable() });
export const okSchema = z.object({ ok: z.literal(true) });

export const terminalListResponse = z.object({ items: z.array(terminalSchema), total: z.number().int(), limit: z.number().int().nullable() });
export const terminalCreateResponse = z.object({ terminal: terminalSchema, pairing: pairingSchema });
export const pairResponse = z.object({ deviceToken: z.string(), terminal: terminalSchema, shop: shopSchema });
export const deviceResponse = z.object({ terminal: terminalSchema, shop: shopSchema, features: z.array(z.string()) });
export const pinSessionResponse = z.object({
  token: z.string(),
  expiresAt: iso,
  user: z.object({ id: z.string().uuid(), name: z.string().nullable() }),
  permissions: z.array(z.string()),
  tenantRoles: z.array(z.string()),
});
export const staffListResponse = z.object({ items: z.array(z.object({ userId: z.string().uuid(), name: z.string().nullable(), hasPin: z.boolean() })) });
export const pinListResponse = z.object({
  items: z.array(z.object({ userId: z.string().uuid(), name: z.string().nullable(), hasPin: z.boolean(), updatedAt: iso.nullable() })),
});

export const posItemSchema = z.object({
  itemId: z.string().uuid(),
  productId: z.string().uuid().nullable(),
  name: z.string(),
  variantTitle: z.string(),
  sku: z.string().nullable(),
  barcodes: z.array(z.string()),
  categoryId: z.string().uuid().nullable(),
  price: z.number().int(),
  mrp: z.number().int().nullable(),
  taxInclusive: z.boolean(),
  gstRate: z.number(),
  /** Price-band GST (apparel / footwear); `gstRate` is the band at `price`. */
  gstRule: z.object({ kind: z.literal("price-band"), threshold: z.number().int(), below: z.number(), above: z.number() }).nullish(),
  hsn: z.string().nullable(),
  unit: z.string(),
  soldBy: z.enum(["unit", "weight"]),
  plu: z.string().nullable(),
  image: z.string().nullable(),
  stock: z.object({ qty: z.number(), status: z.enum(["ok", "low", "out", "untracked"]) }).nullable(),
  active: z.boolean(),
  updatedAt: iso,
});
export const catalogResponse = z.object({
  items: z.array(posItemSchema),
  removed: z.array(z.string().uuid()),
  cursor: z.string(),
  next: z.string().nullable(),
  full: z.boolean(),
});
export const categoriesResponse = z.object({
  items: z.array(z.object({ id: z.string().uuid(), name: z.string(), parentId: z.string().uuid().nullable(), position: z.number().int() })),
});

export const weighTicketLineSchema = z.object({
  itemId: z.string().uuid(),
  name: z.string(),
  unit: z.string(),
  qty: z.number(),
  unitPrice: z.number().int(),
  amount: z.number().int(),
  taxInclusive: z.boolean(),
  gstRate: z.number(),
  hsn: z.string().nullable(),
  tareKg: z.number().optional(),
});
export const weighTicketSchema = z.object({
  id: z.string().uuid(),
  /** "W" + 11 digits (Code 128 barcode text). */
  code: z.string(),
  terminalId: z.string().uuid(),
  status: z.enum(WEIGH_TICKET_STATUSES),
  lines: z.array(weighTicketLineSchema),
  total: z.number().int(),
  note: z.string().nullable(),
  createdAt: iso,
  expiresAt: iso,
  usedInvoiceId: z.string().uuid().nullable(),
});
export const weighTicketListResponse = z.object({ items: z.array(weighTicketSchema), total: z.number().int() });
