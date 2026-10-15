import { defineModule } from "@srirealtime/core";
import { REPORTS_FEATURES, REPORTS_PERMISSIONS } from "./features";
import { reportsRoutes } from "./routes";
import { reportSchedules, savedReports } from "./schema";
import { ReportsService, type ReportsDeps } from "./service";

export * from "./types";
export * from "./schema";
export * from "./features";
export * from "./ports";
export * from "./dates";
export * from "./spec";
export * from "./sql";
export * from "./schedule";
export * from "./render";
export * from "./store";
export * from "./service";
export { reportsRoutes, actorOf } from "./routes";

/**
 * Report builder over module-declared datasets (no user SQL): run a spec, save reports (private or shared), and
 * email them as CSV/XLSX on daily/weekly/monthly schedules. Modules register datasets with
 * `reports.service.registerDataset(port)` — see `datasetFromSql` and src/examples.
 */
export function createReports(deps: ReportsDeps) {
  const service = new ReportsService(deps);
  const module = defineModule({
    id: "reports",
    tables: { savedReports, reportSchedules },
    routes: reportsRoutes(service),
    features: REPORTS_FEATURES,
    permissions: REPORTS_PERMISSIONS,
  });
  return { service, module };
}
