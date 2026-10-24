import { defineModule } from "@srirealtime/core";
import { deviceContextHook } from "./hook";
import { POS_FEATURES, POS_PERMISSIONS } from "./ports";
import { posRoutes } from "./routes";
import { OfflineBillingService } from "./offline";
import { offlineRoutes } from "./offline-routes";
import { posNumberBlocks, posOfflineBills, posPinAttempts, posStaffPins, posTerminals, posWeighTickets } from "./schema";
import { PosService, type PosDeps } from "./service";

export * from "./schema";
export * from "./ports";
export * from "./api-schemas";
export * from "./logic";
export * from "./offline-logic";
export * from "./offline-schemas";
export { OfflineBillingService, MAX_OPEN_BLOCKS_PER_DEVICE, STALE_MS as OFFLINE_STALE_MS, type BlockView, type OfflineActor, type OfflineDeps, type SyncResult } from "./offline";
export { offlineRoutes } from "./offline-routes";
export { PosService, SlidingWindow, type Actor, type Pairing, type PosDeps, type PosItemPage } from "./service";
export { DEVICE_HEADER, deviceContextHook } from "./hook";
export { posRoutes, requireDevice } from "./routes";

/**
 * POS terminals (docs/pos-terminals.md): pairing, the device token, staff PINs and PIN sessions, the catalogue sync and
 * weigh tickets. Register `deviceHook` after the tenancy hook and before auth.
 */
export function createPos(deps: PosDeps) {
  const service = new PosService(deps);
  const offline = new OfflineBillingService({
    db: deps.db,
    catalog: deps.catalog,
    ...(deps.invoices ? { invoices: deps.invoices } : {}),
    ...(deps.audit ? { audit: deps.audit } : {}),
    ...(deps.log ? { log: deps.log } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  });
  const base = posRoutes(service);
  const offlineR = offlineRoutes(offline);
  const module = defineModule({
    id: "pos",
    tables: { posTerminals, posStaffPins, posPinAttempts, posWeighTickets, posNumberBlocks, posOfflineBills },
    routes: (app) => {
      base(app);
      offlineR(app);
    },
    features: POS_FEATURES,
    permissions: POS_PERMISSIONS,
  });
  const deviceHook = deviceContextHook(service, deps.tenants);
  return { service, offline, module, deviceHook };
}
export type Pos = ReturnType<typeof createPos>;
