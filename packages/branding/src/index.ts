import { defineModule } from "@srirealtime/core";
import { brandingRoutes } from "./routes";
import { tenantBranding } from "./schema";
import { BrandingService, type BrandingDeps } from "./service";

export * from "./schema";
export * from "./color";
export * from "./tokens";
export * from "./theme";
export { BrandingService, brandingPatchSchema } from "./service";
export type { Branding, BrandingDeps, BrandingPatch } from "./service";
export { brandingRoutes } from "./routes";

export function createBranding(deps: BrandingDeps) {
  const service = new BrandingService(deps);
  const module = defineModule({ id: "branding", tables: { tenantBranding }, routes: brandingRoutes(service) });
  return { service, module };
}
