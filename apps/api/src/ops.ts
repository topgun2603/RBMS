import { timingSafeEqual } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { unauthorized } from "@srirealtime/core";
import type { JobAttemptEvent, JobCounts, JobObserver } from "@srirealtime/jobs";
import {
  checkReadiness,
  PROMETHEUS_CONTENT_TYPE,
  type ErrorReporter,
  type MetricsRegistry,
  type ReadinessProbe,
} from "@srirealtime/monitoring";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/** Paths served outside the tenancy/auth pipeline (no DB on the liveness path). */
export const OPS_PATHS = ["/health", "/ready", "/version", "/metrics"] as const;

export interface OpsOptions {
  metrics: MetricsRegistry;
  /** Readiness probes by dependency name (postgres, redis, queue). */
  probes: Record<string, ReadinessProbe>;
  readyTimeoutMs: number;
  /** Bearer token for /metrics; unset = /metrics is not registered. */
  metricsToken?: string;
  version: { sha: string | null; buildTime: string | null; startedAt: string; node: string; env: string };
  /** Adds scrape-time samples (queue depth, DB connections). Registered once. */
  collectors?: Array<(metrics: MetricsRegistry) => void>;
}

/**
 * The HTTP request metrics hook. Route label = the route pattern (`/v1/invoices/:id`), or "unmatched" for 404s, so
 * label cardinality stays bounded.
 */
export function httpMetrics(metrics: MetricsRegistry) {
  const requests = metrics.counter("srikit_http_requests_total", "HTTP requests by method, route pattern and status code");
  const duration = metrics.histogram(
    "srikit_http_request_duration_seconds",
    "HTTP request latency by method, route pattern and status class",
  );
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const route = req.routeOptions?.url ?? "unmatched";
    const status = reply.statusCode;
    requests.inc({ method: req.method, route, status });
    duration.observe({ method: req.method, route, status_class: `${Math.floor(status / 100)}xx` }, reply.elapsedTime / 1000);
  };
}

/** Job attempt counters + duration, and the error reporter after a job's final attempt. */
export function jobObserver(metrics: MetricsRegistry, reporter: () => ErrorReporter | undefined): JobObserver {
  const attempts = metrics.counter("srikit_job_attempts_total", "Finished job attempts by job name and outcome (completed|retry|failed)");
  const duration = metrics.histogram("srikit_job_duration_seconds", "Job attempt duration by job name", [
    0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60, 300,
  ]);
  return {
    onAttempt(e: JobAttemptEvent) {
      attempts.inc({ job: e.name, outcome: e.outcome });
      duration.observe({ job: e.name }, e.durationMs / 1000);
      if (e.outcome !== "failed") return;
      const data = e.data as { tenantId?: unknown } | null | undefined;
      reporter()?.capture(e.err, {
        tenantId: typeof data?.tenantId === "string" ? data.tenantId : undefined,
        tags: { job: e.name, job_id: e.jobId, attempt: e.attempt },
      });
    },
  };
}

/** Queue gauges from BullMQ job counts at scrape time. */
export function queueCollector(counts: () => Promise<Record<string, JobCounts>>) {
  return (metrics: MetricsRegistry) => {
    const jobs = metrics.gauge("srikit_job_queue_jobs", "Jobs per queue and state (BullMQ)");
    const depth = metrics.gauge("srikit_job_queue_depth", "Jobs waiting to run per queue (waiting + prioritized)");
    metrics.collect("jobs", async () => {
      const all = await counts();
      jobs.reset();
      depth.reset();
      for (const [queue, c] of Object.entries(all)) {
        for (const [state, n] of Object.entries(c)) jobs.set({ queue, state }, n);
        depth.set({ queue }, c.waiting + c.prioritized);
      }
    });
  };
}

/** DB pool size and the server's connection states for this database (postgres.js exposes no pool counters). */
export function dbCollector(poolMax: number, connections: () => Promise<Array<{ state: string; n: number }>>) {
  return (metrics: MetricsRegistry) => {
    metrics.gauge("srikit_db_pool_max", "Max connections in this process's Postgres pool").set({}, poolMax);
    const conns = metrics.gauge("srikit_db_connections", "Connections to this database by state (pg_stat_activity, all clients)");
    metrics.collect("db", async () => {
      const rows = await connections();
      conns.reset();
      for (const r of rows) conns.set({ state: r.state || "unknown" }, Number(r.n));
    });
  };
}

/** Memory, uptime and event-loop lag of this process. */
export function processCollector(metrics: MetricsRegistry) {
  const rss = metrics.gauge("process_resident_memory_bytes", "Resident memory");
  const heap = metrics.gauge("nodejs_heap_used_bytes", "V8 heap used");
  const uptime = metrics.gauge("process_uptime_seconds", "Seconds since the process started");
  const lag = metrics.gauge("nodejs_eventloop_lag_p99_seconds", "Event-loop delay p99 since the last scrape");
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  metrics.collect("process", () => {
    const m = process.memoryUsage();
    rss.set({}, m.rss);
    heap.set({}, m.heapUsed);
    uptime.set({}, Math.round(process.uptime()));
    lag.set({}, h.percentile(99) / 1e9);
    h.reset();
  });
}

/** Constant-time bearer check. */
export function bearerMatches(header: string | undefined, token: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "");
  if (!m) return false;
  const a = Buffer.from(m[1]!.trim());
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `/health`, `/ready`, `/version` and (with a token) `/metrics`, on the root instance. */
export function registerOpsRoutes(app: FastifyInstance, opts: OpsOptions) {
  for (const c of opts.collectors ?? []) c(opts.metrics);
  const noStore = (reply: FastifyReply) => reply.header("cache-control", "no-store");

  // Liveness: the process is up and serving. Never touches a dependency.
  app.get("/health", async (_req, reply) => {
    noStore(reply);
    return { ok: true };
  });

  // Readiness: every dependency answers within the timeout. 503 takes the instance out of the load balancer.
  app.get("/ready", async (_req, reply) => {
    const report = await checkReadiness(opts.probes, { timeoutMs: opts.readyTimeoutMs });
    noStore(reply);
    return reply.status(report.status === "ok" ? 200 : 503).send(report);
  });

  app.get("/version", async (_req, reply) => {
    noStore(reply);
    return opts.version;
  });

  if (opts.metricsToken) {
    const token = opts.metricsToken;
    app.get("/metrics", async (req, reply) => {
      noStore(reply);
      if (!bearerMatches(req.headers.authorization, token)) throw unauthorized("Metrics token required");
      return reply.type(PROMETHEUS_CONTENT_TYPE).send(await opts.metrics.render());
    });
  }
}
