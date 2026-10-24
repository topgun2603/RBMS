import { defineModule } from "@srirealtime/core";
import { deviceContextHook } from "./hook";
import { POS_FEATURES, POS_PERMISSIONS } from "./ports";
import { posRoutes } from "./routes";
import { posPinAttempts, posStaffPins, posTerminals, posWeighTickets } from "./schema";
import { PosService, type PosDeps } from "./service";

export * from "./schema";
export * from "./ports";
export * from "./api-schemas";
export * from "./logic";
export { PosService, SlidingWindow, type Actor, type Pairing, type PosDeps, type PosItemPage } from "./service";
export { DEVICE_HEADER, deviceContextHook } from "./hook";
export { posRoutes, requireDevice } from "./routes";

/**
 * POS terminals (docs/pos-terminals.md): pairing, the device token, staff PINs and PIN sessions, the catalogue sync and
 * weigh tickets. Register `deviceHook` after the tenancy hook and before auth.
 */
export function createPos(deps: PosDeps) {
  const service = new PosService(deps);
  const module = defineModule({
    id: "pos",
    tables: { posTerminals, posStaffPins, posPinAttempts, posWeighTickets },
    routes: posRoutes(service),
    features: POS_FEATURES,
    permissions: POS_PERMISSIONS,
  });
  const deviceHook = deviceContextHook(service, deps.tenants);
  return { service, module, deviceHook };
}
export type Pos = ReturnType<typeof createPos>;
