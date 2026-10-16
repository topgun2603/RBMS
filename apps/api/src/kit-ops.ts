import { sql, type Db } from "@srirealtime/db";
import { createRedisProbe, type JobsService } from "@srirealtime/jobs";
import { createMonitoring } from "@srirealtime/monitoring";
import type { Logger } from "pino";
import type { Env } from "./env";
import { dbCollector, jobObserver, processCollector, queueCollector, type OpsOptions } from "./ops";

/** Must match `createDb`'s default pool size (kit.ts). */
export const DB_POOL_MAX = 10;

/**
 * The operational safety net of the kit (docs/ops.md): the error reporter, the metrics registry, the job observer
 * and the readiness probes. kit.ts creates it before the jobs module so job failures reach the reporter.
 */
export function createKitOps(env: Env, log: Logger, db: Db) {
  const monitoring = createMonitoring({
    log,
    reporter: {
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
      release: env.GIT_SHA,
      serverName: process.env.HOSTNAME,
    },
  });
  if (monitoring.reporter.driver === "sentry") log.info({}, "monitoring: error reports go to the SENTRY_DSN project");
  const observer = jobObserver(monitoring.metrics, () => monitoring.reporter);
  const redisProbe = env.REDIS_URL === "memory" ? null : createRedisProbe(env.REDIS_URL);

  /** The server's `ops` option, once the jobs module exists. */
  const serverOps = (jobs: JobsService): OpsOptions => ({
    metrics: monitoring.metrics,
    readyTimeoutMs: env.READY_TIMEOUT_MS,
    metricsToken: env.METRICS_TOKEN,
    version: {
      sha: env.GIT_SHA ?? null,
      buildTime: env.BUILD_TIME ?? null,
      startedAt: new Date().toISOString(),
      node: process.version,
      env: env.NODE_ENV,
    },
    probes: {
      postgres: async () => {
        await db.execute(sql`select 1`);
      },
      ...(redisProbe ? { redis: () => redisProbe.ping() } : {}),
      queue: async () => {
        const h = await jobs.health();
        if (!h.started) throw new Error("job workers are not running");
        return { ...h };
      },
    },
    collectors: [
      processCollector,
      queueCollector(() => jobs.counts()),
      dbCollector(DB_POOL_MAX, async () => {
        const rows = await db.execute(
          sql`select coalesce(state, 'unknown') as state, count(*)::int as n from pg_stat_activity where datname = current_database() group by 1`,
        );
        return rows as unknown as Array<{ state: string; n: number }>;
      }),
    ],
  });

  return {
    monitoring,
    observer,
    serverOps,
    async stop() {
      await redisProbe?.close();
      await monitoring.reporter.flush(2000);
    },
  };
}
