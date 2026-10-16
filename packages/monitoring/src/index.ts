import { defineModule } from "@srirealtime/core";
import { createErrorReporter, type LoggerPort, type ReporterConfig } from "./reporter";
import { MetricsRegistry } from "./metrics";

export * from "./scrub";
export * from "./reporter";
export * from "./metrics";
export * from "./readiness";

export interface MonitoringDeps {
  log: LoggerPort;
  /** Error reporting; `dsn` set = Sentry-compatible envelopes, otherwise console (log) only. */
  reporter?: ReporterConfig;
  /** Injected for tests. */
  fetch?: typeof fetch;
}

/**
 * Operational safety net (docs/ops.md): an error reporter and a Prometheus metrics registry. The host wires the
 * reporter into its error handler and job failures, and serves `/ready` and `/metrics` with these helpers.
 * The module has no routes; `stop` flushes pending error reports.
 */
export function createMonitoring(deps: MonitoringDeps) {
  const reporter = createErrorReporter({ log: deps.log, config: deps.reporter, fetch: deps.fetch });
  const metrics = new MetricsRegistry();
  const module = defineModule({
    id: "monitoring",
    stop: async () => {
      await reporter.flush(2000);
    },
  });
  return { reporter, metrics, module };
}
