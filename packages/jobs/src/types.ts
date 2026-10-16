/**
 * Minimal logger port, structurally compatible with pino / the Fastify logger.
 * Other packages declare their own identical port rather than importing this one.
 */
export interface LoggerPort {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface JobMeta {
  /** 1-based attempt number. */
  attempt: number;
  jobId: string;
}

export type JobHandler<T> = (data: T, meta: JobMeta) => Promise<void>;

export interface DefineOptions {
  /** Total attempts including the first run. Default 3. */
  attempts?: number;
  /** Base delay for exponential backoff (delay * 2^(attempt-1)). Default 5000. */
  backoffMs?: number;
  /** Max jobs of this name processed in parallel per process. Default 5. */
  concurrency?: number;
}

export interface EnqueueOptions {
  delayMs?: number;
  /** Jobs with the same id are deduplicated while the earlier one still exists. */
  jobId?: string;
}

export interface ScheduleOptions {
  /** IANA time zone for the cron pattern. Default "Asia/Kolkata". */
  tz?: string;
  /** Scheduler id; defaults to the job name, so re-scheduling a job replaces its cron. */
  key?: string;
}

/** A resolved job definition shared with drivers. */
export interface JobDefinition {
  name: string;
  handler: JobHandler<unknown>;
  attempts: number;
  backoffMs: number;
  concurrency: number;
}

/** One finished attempt of a job, reported to the `JobObserver` (metrics, error reporting). */
export interface JobAttemptEvent {
  name: string;
  jobId: string;
  /** 1-based attempt that just finished. */
  attempt: number;
  /** "retry" = failed, another attempt follows; "failed" = failed after the final attempt. */
  outcome: "completed" | "retry" | "failed";
  durationMs: number;
  err?: unknown;
  /** The job's data, for picking out ids such as `tenantId`. Never log or report it whole. */
  data?: unknown;
}

/** Host-side observer of job attempts. Must not throw (errors are swallowed). */
export interface JobObserver {
  onAttempt(e: JobAttemptEvent): void;
}

/** Jobs per state for one queue (BullMQ `getJobCounts`). */
export interface JobCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: number;
  prioritized: number;
}

/** What the readiness probe sees. Throws when the queue backend is unreachable. */
export interface JobsHealth {
  driver: "bullmq" | "memory";
  started: boolean;
  /** Running workers (BullMQ) / defined jobs (memory). */
  workers: number;
  /** Redis connection status for BullMQ ("ready" when healthy). */
  connection?: string;
}

/** Internal driver interface; both Redis (BullMQ) and in-memory implement it. */
export interface JobsDriver {
  /** Called for every define(); drivers that are already started begin processing it immediately. */
  register(def: JobDefinition): void;
  enqueue(def: JobDefinition, data: unknown, opts: EnqueueOptions): Promise<void>;
  schedule(def: JobDefinition, cron: string, data: unknown, opts: Required<Pick<ScheduleOptions, "tz">> & ScheduleOptions): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Per-queue job counts for the defined jobs. Throws when the backend is unreachable. */
  counts(defs: JobDefinition[]): Promise<Record<string, JobCounts>>;
  /** Pings the backend; throws when it is down. */
  health(): Promise<JobsHealth>;
}

/** Calls the observer, swallowing anything it throws. */
export function notifyObserver(observer: JobObserver | undefined, e: JobAttemptEvent): void {
  if (!observer) return;
  try {
    observer.onAttempt(e);
  } catch {
    // observers must never affect job processing
  }
}

export const backoffDelay = (baseMs: number, attempt: number) => baseMs * 2 ** Math.max(0, attempt - 1);

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
