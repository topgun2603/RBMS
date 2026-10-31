import { defineModule } from "@rbms/core";
import { MEDICINES_FEATURES, MEDICINES_PERMISSIONS } from "./ports";
import { medicinesRoutes } from "./routes";
import { medicineBatches, medicineBatchMovements, medicinePrescriptions, medicines } from "./schema";
import { MedicinesService, type MedicinesDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./ports";
export {
  MedicinesService,
  DEFAULT_EXPIRY_WINDOW,
  medicineInput,
  receiveInput,
  adjustInput,
  prescriptionInput,
  batchListQuery,
  registerQuery,
} from "./service";
export type {
  AdjustInput,
  BatchListQuery,
  BatchView,
  ExpirySummary,
  MedicineInput,
  MedicineListQuery,
  MedicinesDeps,
  MedicineView,
  MovementView,
  PrescriptionInput,
  PrescriptionListQuery,
  ReceiveInput,
  RegisterEntry,
  RegisterQuery,
} from "./service";
export { medicinesRoutes } from "./routes";

/**
 * Pharmacy back end: medicine details (composition, schedule, pack), batches with expiry and MRP sold first-expiry-
 * first-out from issued bills, prescriptions on bills and the Schedule H1 register. The kit wires the bill hooks
 * (`onInvoiceIssued` / `onInvoiceCancelled`) and the inventory `StockPort`.
 */
export function createMedicines(deps: MedicinesDeps) {
  const service = new MedicinesService(deps);
  const module = defineModule({
    id: "medicines",
    tables: { medicines, medicineBatches, medicineBatchMovements, medicinePrescriptions },
    routes: medicinesRoutes(service),
    features: MEDICINES_FEATURES,
    permissions: MEDICINES_PERMISSIONS,
  });
  return { service, module };
}
