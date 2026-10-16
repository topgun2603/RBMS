import { defineModule } from "@srirealtime/core";
import { BullJobsDriver } from "./bullmq-driver";
import { MemoryJobsDriver } from "./memory-driver";
import { JobsService } from "./service";
import { noopLogger, type JobObserver, type JobsDriver, type LoggerPort } from "./types";

export interface JobsDeps {
  /** Redis connection URL, or "memory" for the in-process driver (tests/dev). */
  redisUrl: string | "memory";
  /** Redis key prefix for BullMQ queues. Default "sr". */
  prefix?: string;
  log?: LoggerPort;
  /** Sees every finished attempt (metrics, error reporting after the final attempt). */
  observer?: JobObserver;
}

export function createJobs(deps: JobsDeps) {
  const log = deps.log ?? noopLogger;
  const driver: JobsDriver =
    deps.redisUrl === "memory" ? new MemoryJobsDriver(log, deps.observer)
      : new BullJobsDriver(deps.redisUrl, deps.prefix ?? "sr", log, deps.observer);
  const service = new JobsService(driver);
  const module = defineModule({
    id: "jobs",
    start: () => driver.start(),
    stop: () => driver.stop(),
  });
  return { service, module };
}

export { JobsService, type QueuePort } from "./service";
export { MemoryJobsDriver } from "./memory-driver";
export type {
  DefineOptions,
  EnqueueOptions,
  JobAttemptEvent,
  JobCounts,
  JobHandler,
  JobMeta,
  JobObserver,
  JobsHealth,
  LoggerPort,
  ScheduleOptions,
} from "./types";
export {
  createRedisNonceStore,
  createRedisProbe,
  createRedisPubSub,
  defaultRedisClient,
  LONG_LIVED_REDIS_OPTIONS,
  type RedisClientLike,
  type RedisHelperOptions,
  type RedisNonceStore,
  type RedisProbe,
  type RedisPubSub,
  type RedisRole,
} from "./redis";
