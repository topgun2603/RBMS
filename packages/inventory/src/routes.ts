import { requireRole, requireTenant, requireUser } from "@srirealtime/core";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { csvDisposition, toCsv, type CsvColumn } from "./csv";
import { INVENTORY_FEATURE_KEYS } from "./features";
import { paiseToRupees } from "./logic";
import {
  purchaseReportQuerySchema,
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

function sendCsv(reply: FastifyReply, name: string, from: string, to: string, csv: string) {
  reply.header("content-type", "text/csv; charset=utf-8");
  reply.header("content-disposition", csvDisposition(name, from, to));
  return csv;
}

const STOCK = { config: { feature: INVENTORY_FEATURE_KEYS.stock } };
const PURCHASES = { config: { feature: INVENTORY_FEATURE_KEYS.purchases } };
const LOCATIONS = { config: { feature: INVENTORY_FEATURE_KEYS.locations } };

/**
 * Routes under /v1/inventory. Everything except /public/* needs an owner, admin or staff member of the current
 * tenant. Stock and availability routes belong to the "inventory" feature, locations and transfers to
 * "inventory.locations", suppliers and purchases to "inventory.purchases" (enforced by the host).
 */
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
      app.get("/stock", STOCK, async (req) => service.listStock(tid(req), req.query as StockQuery));
      app.get("/stock/:itemId", STOCK, async (req) => {
        const { itemId } = itemParam.parse(req.params);
        return service.getStock(tid(req), itemId, req.query as LocationQuery);
      });
      app.patch("/stock/:itemId", STOCK, async (req) => {
        const { itemId } = itemParam.parse(req.params);
        return service.updateStock(tid(req), itemId, body(req) as StockPatch);
      });
      app.post("/stock/:itemId/adjust", STOCK, async (req) => {
        const { itemId } = itemParam.parse(req.params);
        return service.adjust(tid(req), itemId, body(req) as AdjustInput, uid(req));
      });
      app.get("/stock/:itemId/movements", STOCK, async (req) => {
        const { itemId } = itemParam.parse(req.params);
        return service.movements(tid(req), itemId, req.query as MovementsQuery);
      });
      app.get("/summary", STOCK, async (req) => service.summary(tid(req), (req.query ?? {}) as LocationQuery));
      app.get("/availability", STOCK, async (req) => service.availability(tid(req), req.query as AvailabilityQuery));

      // ---- locations and transfers
      app.get("/locations", LOCATIONS, async (req) => service.listLocations(tid(req), (req.query ?? {}) as LocationListQuery));
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
      app.post("/purchases", PURCHASES, async (req) => service.createPurchase(tid(req), body(req) as PurchaseInput, uid(req)));
      app.get("/purchases/:id", PURCHASES, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.getPurchase(tid(req), id);
      });
      app.post("/purchases/:id/cancel", PURCHASES, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.cancelPurchase(tid(req), id, uid(req));
      });
      app.post("/purchases/:id/paid", PURCHASES, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.setPurchasePaid(tid(req), id, body(req) as { paid: boolean });
      });

      // ---- reports
      app.get("/reports/stock", STOCK, async (req, reply) => {
        const { q, format, locationId } = stockReportQuerySchema.parse(req.query ?? {});
        const report = await service.stockReport(tid(req), { q, locationId });
        if (format !== "csv") return report;
        const today = service.today();
        return sendCsv(reply, "stock", today, today, toCsv(report.items, STOCK_CSV_COLUMNS));
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
