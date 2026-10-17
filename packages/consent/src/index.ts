import { defineModule } from "@srirealtime/core";
import { consentRoutes } from "./routes";
import * as schema from "./schema";
import { ConsentService, type ConsentDeps } from "./service";

/**
 * Consent records, data export and account deletion (DPDP Act 2023, Google Play account deletion).
 * apps/api registers each module's exporter/eraser; register auth FIRST so its eraser runs LAST.
 */
export function createConsent(deps: ConsentDeps) {
  const service = new ConsentService(deps);
  const module = defineModule({
    id: "consent",
    tables: { ...schema },
    routes: consentRoutes(service),
  });
  return { service, module };
}

export { ConsentService, PROCESS_JOB, SWEEP_JOB } from "./service";
export type { ConsentConfig, ConsentDeps, DataRequestView } from "./service";
export { latestByPurpose, runErasers, runExporters } from "./logic";
export type { ConsentDecision, ExportPayload } from "./logic";
export type { DataEraser, DataExporter, LoggerPort, QueuePort } from "./ports";
export * from "./schema";
export * from "./list";
