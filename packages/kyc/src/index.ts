import { defineModule } from "@srirealtime/core";
import { KYC_FEATURES, KYC_PERMISSIONS } from "./features";
import type { KycStatusPort } from "./ports";
import { kycRoutes } from "./routes";
import { kycChecks, kycDocuments, kycSubjects } from "./schema";
import { KycService, type KycDeps } from "./service";

export * from "./schema";
export * from "./features";
export * from "./ports";
export * from "./validators";
export * from "./mask";
export * from "./names";
export * from "./aggregate";
export * from "./store";
export * from "./service";
export * from "./drivers/types";
export * from "./drivers/mock";
export * from "./drivers/http";
export { kycRoutes } from "./routes";

/**
 * PAN / GSTIN / bank / UPI / DigiLocker / selfie verification for shops, marketplace vendors and users, with a
 * super-admin manual review queue. `status` is the `KycStatusPort` other modules (marketplace payouts) consume.
 */
export function createKyc(deps: KycDeps) {
  const service = new KycService(deps);
  const status: KycStatusPort = { status: (tenantId, subjectType, subjectId) => service.status(tenantId, subjectType, subjectId) };
  const module = defineModule({
    id: "kyc",
    tables: { kycSubjects, kycChecks, kycDocuments },
    routes: kycRoutes(service),
    features: KYC_FEATURES,
    permissions: KYC_PERMISSIONS,
  });
  return { service, module, status };
}
