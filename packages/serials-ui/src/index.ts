export { serialsModule, SERIALS_ROUTES, type SerialsModuleOptions } from "./module";
export { serialsMessages } from "./lib/messages";
export { SERIALS_FEATURES, SERIALS_PERMISSIONS } from "./lib/access";
export { isValidImei, normaliseSerial, parseAndCheck } from "./lib/serial";
export type { SerialEvent, SerialItem, SerialsSummary, SerialStatus, SerialUnit, WarrantyLookup, WarrantyStatus } from "./lib/types";
