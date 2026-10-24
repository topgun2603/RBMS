import { documented, requireRole, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { csvDisposition, toCsv, type CsvColumn } from "./csv";
import { INVENTORY_FEATURE_KEYS } from "./features";
import { paiseToRupees } from "./logic";
import { type AgeingSupplier, type StatementRow } from "./payables";
import {
  ageingQuerySchema,
  billGrnInputSchema,
  convertInputSchema,
  debitNoteInputSchema,
  paymentInputSchema,
  poInputSchema,
  poPatchSchema,
  receiveInputSchema,
  reverseInputSchema,
  statementQuerySchema,
  supplierPaymentInputSchema,
  type BillGrnInput,
  type ConvertInput,
  type DebitNoteInput,
  type DebitNoteListQuery,
  type GrnListQuery,
  type PaymentInput,
  type PoInput,
  type PoListQuery,
  type PoPatch,
  type ReceiveInput,
  type SupplierPaymentInput,
} from "./purchasing";
import { LOCATION_TYPES, MOVEMENT_REASONS } from "./schema";
import {
  adjustInputSchema,
  locationListQuerySchema,
  locationQuerySchema,
  movementsQuerySchema,
  purchaseReportQuerySchema,
  stockPatchSchema,
  stockQuerySchema,
  stockReportQuerySchema,
  type AdjustInput,
  type AvailabilityQuery,
  type InventoryService,
  type LocationInput,
  type LocationListQuery,
  type LocationPatch,
  type LocationQuery,
  type MovementsQuery,
  type PurchaseInput,
  type PurchaseListQuery,
  type PurchaseSummary,
  type StockPatch,
  type StockQuery,
  type StockRow,
  type SupplierInput,
  type SupplierListQuery,
  type TransferInput,
  type TransferListQuery,
} from "./service";

const idParam = z.object({ id: z.string().uuid() });
const groupParam = z.object({ groupId: z.string().uuid() });
const rupees = (paise: number) => `Rs ${paiseToRupees(paise)}`;
const itemParam = z.object({ itemId: z.string().uuid() });
const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;

export const STOCK_CSV_COLUMNS: CsvColumn<StockRow>[] = [
  { header: "Item", value: (r) => r.name },
  { header: "HSN", value: (r) => r.hsn },
  { header: "Unit", value: (r) => r.unit },
  { header: "Qty", value: (r) => r.qty },
  { header: "Reorder level", value: (r) => r.reorderLevel },
  { header: "Avg cost (Rs)", value: (r) => paiseToRupees(r.avgCost) },
  { header: "Value (Rs)", value: (r) => paiseToRupees(r.value) },
  { header: "Status", value: (r) => r.status },
];

export const PURCHASE_CSV_COLUMNS: CsvColumn<PurchaseSummary>[] = [
  { header: "Date", value: (r) => r.date },
  { header: "Bill number", value: (r) => r.billNumber },
  { header: "Supplier", value: (r) => r.supplierName },
  { header: "Supplier GSTIN", value: (r) => r.supplierGstin },
  { header: "Taxable (Rs)", value: (r) => paiseToRupees(r.taxable) },
  { header: "CGST (Rs)", value: (r) => paiseToRupees(r.cgst) },
  { header: "SGST (Rs)", value: (r) => paiseToRupees(r.sgst) },
  { header: "IGST (Rs)", value: (r) => paiseToRupees(r.igst) },
  { header: "Total (Rs)", value: (r) => paiseToRupees(r.total) },
  { header: "Paid", value: (r) => (r.paid ? "yes" : "no") },
];

export const AGEING_CSV_COLUMNS: CsvColumn<AgeingSupplier>[] = [
  { header: "Supplier", value: (r) => r.name },
  { header: "Opening balance (Rs)", value: (r) => paiseToRupees(r.opening) },
  { header: "0-30 days (Rs)", value: (r) => paiseToRupees(r.b0_30) },
  { header: "31-60 days (Rs)", value: (r) => paiseToRupees(r.b31_60) },
  { header: "61-90 days (Rs)", value: (r) => paiseToRupees(r.b61_90) },
  { header: "Over 90 days (Rs)", value: (r) => paiseToRupees(r.b90plus) },
  { header: "Advance / credit (Rs)", value: (r) => paiseToRupees(r.advance) },
  { header: "Total payable (Rs)", value: (r) => paiseToRupees(r.total) },
  { header: "Overdue (Rs)", value: (r) => paiseToRupees(r.overdue) },
];

export const STATEMENT_CSV_COLUMNS: CsvColumn<StatementRow>[] = [
  { header: "Date", value: (r) => r.date },
  { header: "Type", value: (r) => r.type },
  { header: "Reference", value: (r) => r.ref },
  { header: "Details", value: (r) => r.description },
  { header: "Bills / refunds (Rs)", value: (r) => paiseToRupees(r.credit) },
  { header: "Payments / returns (Rs)", value: (r) => paiseToRupees(r.debit) },
  { header: "Balance (Rs)", value: (r) => paiseToRupees(r.balance) },
];

function sendCsv(reply: FastifyReply, name: string, from: string, to: string, csv: string) {
  reply.header("content-type", "text/csv; charset=utf-8");
  reply.header("content-disposition", csvDisposition(name, from, to));
  return csv;
}

const STOCK = { config: { feature: INVENTORY_FEATURE_KEYS.stock } };
const PURCHASES = { config: { feature: INVENTORY_FEATURE_KEYS.purchases } };
const LOCATIONS = { config: { feature: INVENTORY_FEATURE_KEYS.locations } };
/** A PURCHASES route with audit naming (`inventory.<action>` on the entity in the audit log) and API document shapes. */
const purchasesAudited = (action: string, entity: string, schema: Parameters<typeof documented>[0] = {}, idParam = "id") =>
  documented(schema, { ...PURCHASES.config, audit: { action, entity, idParam } });

// ---- response shapes for the API document and the mobile client (JSON: dates are ISO strings, money in paise)
const isoDateTime = z.string().datetime();
const paise = z.number().int();
/** Quantities have up to 3 decimals (2.5 kg). */
const qty = z.number();
/** One item's (catalogue variant's) stock at a location, or summed over every location (`locationId` null). */
export const stockLevelSchema = z.object({
  /** The catalogue variant id. */
  itemId: z.string().uuid(),
  name: z.string(),
  unit: z.string(),
  hsn: z.string().nullable(),
  qty,
  reorderLevel: qty,
  /** False: stock isn't counted for this item (always "ok"). */
  track: z.boolean(),
  /** Paise per unit, excluding GST; null until a cost is known. */
  avgCost: paise.nullable(),
  /** qty × avgCost (0 for negative stock or unknown cost). */
  value: paise,
  /** out (qty ≤ 0), low (at or under the reorder level) or ok. */
  status: z.enum(["ok", "low", "out"]),
  updatedAt: isoDateTime.nullable(),
  /** Held for open orders. */
  reserved: qty,
  /** qty − reserved. */
  available: qty,
  locationId: z.string().uuid().nullable(),
  /** Stock lists: the item's catalogue category. */
  categoryId: z.string().uuid().nullable().optional(),
  categoryName: z.string().nullable().optional(),
});
const stockTotalsFields = {
  /** Value of the tracked stock, paise. */
  stockValue: paise,
  lowCount: z.number().int(),
  outCount: z.number().int(),
};
export const stockListSchema = z.object({
  items: z.array(stockLevelSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  /** Over the tracked items matching `q` (not the status / category filters). */
  totals: z.object(stockTotalsFields),
  /** `status` (in / low / out / untracked) and `category` (id or "none") counts under the other filters. */
  facets: z.object({ status: z.record(z.string(), z.number().int()), category: z.record(z.string(), z.number().int()) }),
  /** Names of the categories in `facets.category`. */
  categories: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
});
/** Dashboard card: totals and the five lowest tracked items (out first). The full low-stock list is `GET /stock?status=low,out`. */
export const stockSummarySchema = z.object({ ...stockTotalsFields, lowItems: z.array(stockLevelSchema) });
export const stockMovementSchema = z.object({
  id: z.string().uuid(),
  /** When it was recorded. */
  date: isoDateTime,
  /** Manual changes are "opening" (the first at a location) or "adjustment". */
  reason: z.enum(MOVEMENT_REASONS),
  /** + in, − out. */
  delta: qty,
  qtyAfter: qty,
  /** invoice / purchase / order / transfer / credit_note (or another module's ref type). */
  refType: z.string().nullable(),
  refId: z.string().nullable(),
  refNumber: z.string().nullable(),
  note: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  locationId: z.string().uuid().nullable(),
});
export const stockMovementListSchema = z.object({ items: z.array(stockMovementSchema), total: z.number().int() });
export const stockLocationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  type: z.enum(LOCATION_TYPES),
  address: z.string().nullable(),
  isDefault: z.boolean(),
  active: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export const stockLocationListSchema = z.object({ items: z.array(stockLocationSchema), total: z.number().int() });

/**
 * `locationId` on stock reads: a location id, "all" (every location summed, the shop-wide view), or left out (the
 * request's branch location in multi-branch shops, else every location). See `atBranch`.
 */
const locationIdQuery = z.union([z.string().uuid(), z.literal("all")]).optional();
const stockListQuery = stockQuerySchema.extend({ locationId: locationIdQuery });
const locationReadQuery = locationQuerySchema.extend({ locationId: locationIdQuery });
const movementsQuery = movementsQuerySchema.extend({ locationId: locationIdQuery });
/** A STOCK route with its API document shapes. */
const stock = (schema: Parameters<typeof documented>[0]) => documented(schema, STOCK.config);

/**
 * Routes under /v1/inventory. Everything except /public/* needs an owner, admin or staff member of the current
 * tenant. Stock and availability routes belong to the "inventory" feature, locations and transfers to
 * "inventory.locations", suppliers and purchases to "inventory.purchases" (enforced by the host).
 */
/**
 * Multi-branch shops: a request without `locationId` works at the current branch's stock location (`req.ctx.branch`,
 * filled by the branches context hook). `locationId=all` asks for every location (the shop-wide view). Without a
 * branch (single-branch shops) nothing changes: lists and reads cover every location, writes use the default one.
 */
export function atBranch<T>(req: { ctx: RequestContext }, input: T): T {
  const v = (input ?? {}) as Record<string, unknown>;
  if (v.locationId === "all") {
    const { locationId: _all, ...rest } = v;
    return rest as T;
  }
  const loc = req.ctx.branch?.locationId;
  if (!loc || (v.locationId !== undefined && v.locationId !== null && v.locationId !== "")) return input;
  return { ...v, locationId: loc } as T;
}

export function inventoryRoutes(service: InventoryService) {
  return async (root: FastifyInstance) => {
    const tid = (req: { ctx: Parameters<typeof requireTenant>[0] }) => requireTenant(req.ctx).id;
    const uid = (req: { ctx: Parameters<typeof requireUser>[0] }) => requireUser(req.ctx).id;

    // ---- public (storefront): any request with a tenant; booleans only.
    root.get("/public/availability", STOCK, async (req) => service.publicAvailability(tid(req), req.query as AvailabilityQuery));

    await root.register(async (app) => {
      app.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
      });

      // ---- stock
      app.get("/stock", stock({ query: stockListQuery, response: stockListSchema }), async (req) => service.listStock(tid(req), atBranch(req, req.query as StockQuery)));
      app.get("/stock/:itemId", stock({ query: locationReadQuery, response: stockLevelSchema }), async (req) => {
        const { itemId } = itemParam.parse(req.params);
        return service.getStock(tid(req), itemId, atBranch(req, req.query as LocationQuery));
      });
      app.patch("/stock/:itemId", stock({ body: stockPatchSchema, response: stockLevelSchema }), async (req) => {
        const { itemId } = itemParam.parse(req.params);
        return service.updateStock(tid(req), itemId, atBranch(req, body(req) as StockPatch));
      });
      app.post("/stock/:itemId/adjust", stock({ body: adjustInputSchema, response: stockLevelSchema }), async (req) => {
        const { itemId } = itemParam.parse(req.params);
        return service.adjust(tid(req), itemId, atBranch(req, body(req) as AdjustInput), uid(req));
      });
      app.get("/stock/:itemId/movements", stock({ query: movementsQuery, response: stockMovementListSchema }), async (req) => {
        const { itemId } = itemParam.parse(req.params);
        return service.movements(tid(req), itemId, atBranch(req, req.query as MovementsQuery));
      });
      app.get("/summary", stock({ query: locationReadQuery, response: stockSummarySchema }), async (req) => service.summary(tid(req), atBranch(req, (req.query ?? {}) as LocationQuery)));
      app.get("/availability", STOCK, async (req) => service.availability(tid(req), atBranch(req, req.query as AvailabilityQuery)));

      // ---- locations and transfers
      app.get("/locations", documented({ query: locationListQuerySchema, response: stockLocationListSchema }, LOCATIONS.config), async (req) => service.listLocations(tid(req), (req.query ?? {}) as LocationListQuery));
      app.post("/locations", LOCATIONS, async (req) => service.createLocation(tid(req), body(req) as LocationInput));
      app.get("/locations/:id", LOCATIONS, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.getLocation(tid(req), id);
      });
      app.patch("/locations/:id", LOCATIONS, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.updateLocation(tid(req), id, body(req) as LocationPatch);
      });
      app.delete("/locations/:id", LOCATIONS, async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteLocation(tid(req), id);
        return { ok: true };
      });
      app.get("/transfers", LOCATIONS, async (req) => service.listTransfers(tid(req), req.query as TransferListQuery));
      app.post("/transfers", LOCATIONS, async (req) => service.createTransfer(tid(req), body(req) as TransferInput, uid(req)));

      // ---- suppliers
      app.get("/suppliers", PURCHASES, async (req) => service.listSuppliers(tid(req), req.query as SupplierListQuery));
      app.post("/suppliers", PURCHASES, async (req) => service.createSupplier(tid(req), body(req) as SupplierInput));
      app.get("/suppliers/:id", PURCHASES, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.getSupplier(tid(req), id);
      });
      app.patch("/suppliers/:id", PURCHASES, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.updateSupplier(tid(req), id, body(req) as Partial<SupplierInput>);
      });
      app.delete("/suppliers/:id", PURCHASES, async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteSupplier(tid(req), id);
        return { ok: true };
      });

      // ---- purchases
      app.get("/purchases", PURCHASES, async (req) => service.listPurchases(tid(req), req.query as PurchaseListQuery));
      app.post("/purchases", PURCHASES, async (req) => service.createPurchase(tid(req), atBranch(req, body(req) as PurchaseInput), uid(req)));
      app.get("/purchases/:id", PURCHASES, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.getPurchase(tid(req), id);
      });
      app.post("/purchases/:id/cancel", PURCHASES, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.cancelPurchase(tid(req), id, uid(req));
      });
      app.post("/purchases/:id/paid", purchasesAudited("inventory.purchase.paid", "purchase"), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.setPurchasePaid(tid(req), id, body(req) as { paid: boolean }, uid(req));
      });
      app.patch("/purchases/:id", PURCHASES, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.purchasing.setDueDate(tid(req), id, (body(req).dueDate ?? null) as string | null);
      });

      // ---- supplier payments (permission inventory.purchases.pay)
      app.get("/purchases/:id/payments", PURCHASES, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.purchasing.listPayments(tid(req), { purchaseId: id });
      });
      app.post("/purchases/:id/payments", purchasesAudited("inventory.purchase.pay", "purchase", { body: paymentInputSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        const b = body(req) as PaymentInput;
        req.auditSummary = `Paid ${rupees(b.amount)} (${b.mode ?? "cash"})`;
        return service.purchasing.payPurchase(tid(req), id, b, uid(req));
      });
      app.get("/suppliers/:id/payments", PURCHASES, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.purchasing.listPayments(tid(req), { supplierId: id });
      });
      app.post("/suppliers/:id/payments", purchasesAudited("inventory.supplier.pay", "supplier", { body: supplierPaymentInputSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        const b = body(req) as SupplierPaymentInput;
        req.auditSummary = `Paid supplier ${rupees(b.amount)} (${b.mode ?? "cash"})`;
        return service.purchasing.paySupplier(tid(req), id, b, uid(req));
      });
      app.post("/payments/:id/reverse", purchasesAudited("inventory.payment.reverse", "purchase_payment", { body: reverseInputSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.purchasing.reversePayment(tid(req), id, body(req) as { reason?: string }, uid(req));
      });
      app.post("/payments/group/:groupId/reverse", purchasesAudited("inventory.payment.reverse", "purchase_payment", { body: reverseInputSchema }, "groupId"), async (req) => {
        const { groupId } = groupParam.parse(req.params);
        return service.purchasing.reversePaymentGroup(tid(req), groupId, body(req) as { reason?: string }, uid(req));
      });
      app.get("/suppliers/:id/statement", PURCHASES, async (req, reply) => {
        const { id } = idParam.parse(req.params);
        const q = statementQuerySchema.parse(req.query ?? {});
        const st = await service.purchasing.supplierStatement(tid(req), id, q);
        if (q.format !== "csv") return st;
        const today = service.today();
        return sendCsv(reply, `supplier-statement-${st.supplier.name}`, q.from ?? today, q.to ?? today, toCsv(st.rows, STATEMENT_CSV_COLUMNS));
      });

      // ---- purchase orders and goods receipts
      app.get("/purchase-orders", PURCHASES, async (req) => service.purchasing.listPurchaseOrders(tid(req), req.query as PoListQuery));
      app.post("/purchase-orders", purchasesAudited("inventory.po.create", "purchase_order", { body: poInputSchema }), async (req) =>
        service.purchasing.createPurchaseOrder(tid(req), atBranch(req, body(req) as PoInput), uid(req)),
      );
      app.get("/purchase-orders/:id", PURCHASES, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.purchasing.getPurchaseOrder(tid(req), id);
      });
      app.patch("/purchase-orders/:id", purchasesAudited("inventory.po.update", "purchase_order", { body: poPatchSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.purchasing.updatePurchaseOrder(tid(req), id, body(req) as PoPatch);
      });
      app.post("/purchase-orders/:id/send", purchasesAudited("inventory.po.send", "purchase_order"), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.purchasing.sendPurchaseOrder(tid(req), id);
      });
      app.post("/purchase-orders/:id/cancel", purchasesAudited("inventory.po.cancel", "purchase_order"), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.purchasing.cancelPurchaseOrder(tid(req), id);
      });
      app.post("/purchase-orders/:id/close", purchasesAudited("inventory.po.close", "purchase_order"), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.purchasing.closePurchaseOrder(tid(req), id);
      });
      app.post("/purchase-orders/:id/receive", purchasesAudited("inventory.po.receive", "purchase_order", { body: receiveInputSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.purchasing.receive(tid(req), id, atBranch(req, body(req) as ReceiveInput), uid(req));
      });
      app.post("/purchase-orders/:id/convert", purchasesAudited("inventory.po.convert", "purchase_order", { body: convertInputSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.purchasing.convertToPurchase(tid(req), id, atBranch(req, body(req) as ConvertInput), uid(req));
      });
      app.get("/goods-receipts", PURCHASES, async (req) => service.purchasing.listGoodsReceipts(tid(req), (req.query ?? {}) as GrnListQuery));
      app.get("/goods-receipts/:id", PURCHASES, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.purchasing.getGoodsReceipt(tid(req), id);
      });
      app.post("/goods-receipts/:id/bill", purchasesAudited("inventory.grn.bill", "goods_receipt", { body: billGrnInputSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.purchasing.billGoodsReceipt(tid(req), id, body(req) as BillGrnInput, uid(req));
      });

      // ---- debit notes (purchase returns)
      app.get("/debit-notes", PURCHASES, async (req) => service.purchasing.listDebitNotes(tid(req), req.query as DebitNoteListQuery));
      app.post("/debit-notes", purchasesAudited("inventory.debit-note.create", "debit_note", { body: debitNoteInputSchema }), async (req) =>
        service.purchasing.createDebitNote(tid(req), atBranch(req, body(req) as DebitNoteInput), uid(req)),
      );
      app.get("/debit-notes/:id", PURCHASES, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.purchasing.getDebitNote(tid(req), id);
      });
      app.post("/debit-notes/:id/cancel", purchasesAudited("inventory.debit-note.cancel", "debit_note"), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.purchasing.cancelDebitNote(tid(req), id, uid(req));
      });

      // ---- reports
      app.get("/reports/stock", STOCK, async (req, reply) => {
        const { q, format, locationId } = stockReportQuerySchema.parse(atBranch(req, req.query ?? {}));
        const report = await service.stockReport(tid(req), { q, locationId });
        if (format !== "csv") return report;
        const today = service.today();
        return sendCsv(reply, "stock", today, today, toCsv(report.items, STOCK_CSV_COLUMNS));
      });
      app.get("/payables/summary", PURCHASES, async (req) => service.purchasing.payablesSummary(tid(req)));
      app.get("/reports/payables-ageing", PURCHASES, async (req, reply) => {
        const q = ageingQuerySchema.parse(req.query ?? {});
        const report = await service.purchasing.payablesAgeing(tid(req), q);
        if (q.format !== "csv") return report;
        return sendCsv(reply, "payables-ageing", report.asOf, report.asOf, toCsv(report.rows, AGEING_CSV_COLUMNS));
      });
      app.get("/reports/purchases", PURCHASES, async (req, reply) => {
        const { from, to, format } = purchaseReportQuerySchema.parse(req.query ?? {});
        const report = await service.purchaseReport(tid(req), { from, to });
        if (format !== "csv") return report;
        return sendCsv(reply, "purchases", from, to, toCsv(report.rows, PURCHASE_CSV_COLUMNS));
      });
    });
  };
}
