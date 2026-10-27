import { defineModule } from "@srirealtime/core";
import { INVENTORY_FEATURES } from "./features";
import { inventoryRoutes } from "./routes";
import {
  debitNotes,
  goodsReceipts,
  landedCostVouchers,
  purchaseDocSeries,
  purchaseOrders,
  purchasePayments,
  purchases,
  stockAuditEntries,
  stockAuditLines,
  stockAudits,
  stockBatchItems,
  stockBatchLevels,
  stockBatchMovements,
  stockBatchSettings,
  stockBatches,
  stockCostDraws,
  stockCostLayers,
  stockItems,
  stockLocations,
  stockMovements,
  stockReservations,
  stockTransfers,
  stockValuationSettings,
  suppliers,
} from "./schema";
import { InventoryService, type InventoryDeps } from "./service";

export * from "./schema";
export * from "./ports";
export * from "./logic";
export * from "./batch-logic";
export * from "./batches";
export * from "./audit";
export * from "./transfers";
export * from "./levels";
export * from "./payables";
export * from "./purchasing";
export * from "./costing";
export * from "./costing-logic";
export * from "./permissions";
export * from "./csv";
export * from "./service";
export * from "./features";
export {
  inventoryRoutes,
  PURCHASE_CSV_COLUMNS,
  STOCK_CSV_COLUMNS,
  stockLevelSchema,
  stockListSchema,
  stockLocationListSchema,
  stockLocationSchema,
  stockMovementListSchema,
  stockMovementSchema,
  stockSummarySchema,
} from "./routes";

/** Stock per saved item and location, transfers, reservations, suppliers and purchase bills (with input tax credit). */
export function createInventory(deps: InventoryDeps) {
  const service = new InventoryService(deps);
  const module = defineModule({
    id: "inventory",
    tables: {
      stockItems,
      stockMovements,
      suppliers,
      purchases,
      stockLocations,
      stockTransfers,
      stockReservations,
      purchasePayments,
      purchaseOrders,
      goodsReceipts,
      debitNotes,
      purchaseDocSeries,
      stockBatches,
      stockBatchLevels,
      stockBatchMovements,
      stockBatchItems,
      stockBatchSettings,
      stockAudits,
      stockAuditLines,
      stockAuditEntries,
      stockValuationSettings,
      stockCostLayers,
      stockCostDraws,
      landedCostVouchers,
    },
    routes: inventoryRoutes(service),
    features: INVENTORY_FEATURES,
  });
  return { service, module };
}
