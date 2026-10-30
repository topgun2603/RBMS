import { pk, tenantId, timestamps } from "@rbms/db";
import { date, index, integer, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * Drug schedules (Drugs and Cosmetics Rules, 1945). H, H1, X and narcotics are sold only against a prescription; H1, X
 * and narcotic sales go in the register (H1 register) with the prescriber and patient.
 */
export const MEDICINE_SCHEDULES = ["otc", "G", "H", "H1", "X", "narcotic"] as const;
export type MedicineSchedule = (typeof MEDICINE_SCHEDULES)[number];
/** Schedules that need a prescription at the counter. */
export const RX_SCHEDULES: readonly MedicineSchedule[] = ["H", "H1", "X", "narcotic"];
/** Schedules whose sales are recorded in the H1 register. */
export const REGISTER_SCHEDULES: readonly MedicineSchedule[] = ["H1", "X", "narcotic"];

export const BATCH_MOVEMENT_REASONS = ["receive", "sale", "sale_cancel", "adjust", "expired", "damaged", "return_to_supplier"] as const;
export type BatchMovementReason = (typeof BATCH_MOVEMENT_REASONS)[number];

const qty = (name: string) => numeric(name, { precision: 14, scale: 3 });

/** Medicine details for a catalogue item (`itemId` = catalogue variant id, as in inventory and invoices). */
export const medicines = pgTable(
  "medicines",
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid("item_id").notNull(),
    /** The item's name when the details were last saved (lists and the register don't call the catalogue). */
    name: text("name").notNull(),
    /** Salt / composition, e.g. "Paracetamol 650 mg". Used to suggest substitutes. */
    composition: text("composition"),
    manufacturer: text("manufacturer"),
    schedule: text("schedule").$type<MedicineSchedule>().notNull().default("otc"),
    /** Units in one pack (tablets in a strip); 1 when sold whole only. */
    packSize: integer("pack_size").notNull().default(1),
    /** What one sold unit is called: strip, bottle, tube… */
    packUnit: text("pack_unit").notNull().default("strip"),
    /** Shelf / rack where it's kept. */
    rack: text("rack"),
    note: text("note"),
    ...timestamps(),
  },
  (t) => [
    unique("medicines_tenant_item_uq").on(t.tenantId, t.itemId),
    index("medicines_tenant_name_idx").on(t.tenantId, t.name),
    index("medicines_tenant_composition_idx").on(t.tenantId, t.composition),
  ],
);

/** A batch (lot) of a medicine with its expiry and MRP. `qty` is in sold units (strips, bottles). */
export const medicineBatches = pgTable(
  "medicine_batches",
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid("item_id").notNull(),
    itemName: text("item_name").notNull(),
    batchNo: text("batch_no").notNull(),
    /** Last day the batch may be sold (expiry printed as MM/YYYY = the last day of that month). */
    expiry: date("expiry", { mode: "string" }).notNull(),
    /** Paise per unit. */
    mrp: integer("mrp"),
    /** Paise per unit, before GST. */
    purchaseRate: integer("purchase_rate"),
    qty: qty("qty").notNull().default("0"),
    supplier: text("supplier"),
    ...timestamps(),
  },
  (t) => [
    unique("medicine_batches_tenant_item_batch_uq").on(t.tenantId, t.itemId, t.batchNo),
    index("medicine_batches_tenant_expiry_idx").on(t.tenantId, t.expiry),
    index("medicine_batches_tenant_item_idx").on(t.tenantId, t.itemId),
  ],
);

/** Append-only batch ledger. Sales carry the bill (`refType` "invoice") so the H1 register can be built from it. */
export const medicineBatchMovements = pgTable(
  "medicine_batch_movements",
  {
    id: pk(),
    tenantId: tenantId(),
    batchId: uuid("batch_id").notNull(),
    itemId: uuid("item_id").notNull(),
    delta: qty("delta").notNull(),
    qtyAfter: qty("qty_after").notNull(),
    reason: text("reason").$type<BatchMovementReason>().notNull(),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    refNumber: text("ref_number"),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("medicine_batch_movements_tenant_batch_idx").on(t.tenantId, t.batchId, t.createdAt),
    index("medicine_batch_movements_tenant_ref_idx").on(t.tenantId, t.refId),
    index("medicine_batch_movements_tenant_reason_idx").on(t.tenantId, t.reason, t.createdAt),
  ],
);

/** A prescription seen at the counter, usually attached to the bill it was dispensed on. */
export const medicinePrescriptions = pgTable(
  "medicine_prescriptions",
  {
    id: pk(),
    tenantId: tenantId(),
    invoiceId: uuid("invoice_id"),
    invoiceNumber: text("invoice_number"),
    patientName: text("patient_name").notNull(),
    patientAge: integer("patient_age"),
    patientPhone: text("patient_phone"),
    patientAddress: text("patient_address"),
    doctorName: text("doctor_name").notNull(),
    /** Medical council registration number of the prescriber. */
    doctorRegNo: text("doctor_reg_no"),
    doctorAddress: text("doctor_address"),
    rxDate: date("rx_date", { mode: "string" }).notNull(),
    /** Uploaded photo / scan of the prescription. */
    imageUrl: text("image_url"),
    note: text("note"),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    index("medicine_prescriptions_tenant_invoice_idx").on(t.tenantId, t.invoiceId),
    index("medicine_prescriptions_tenant_date_idx").on(t.tenantId, t.rxDate),
  ],
);

export type MedicineRow = typeof medicines.$inferSelect;
export type MedicineBatchRow = typeof medicineBatches.$inferSelect;
export type MedicineBatchMovementRow = typeof medicineBatchMovements.$inferSelect;
export type MedicinePrescriptionRow = typeof medicinePrescriptions.$inferSelect;
