import { newId } from "@srirealtime/core";
import { backoffDelay, type EnqueueOptions, type JobDefinition, type JobsDriver, type LoggerPort } from "./types";

/**
 * In-process driver for tests and local dev without Redis.
 * Jobs run via setTimeout as soon as they are enqueued (start() is not required), retry with
 * exponential backoff, and are deduplicated by jobId while pending or running. Cron is disabled.
 */
export class MemoryJobsDriver implements JobsDriver {
  private readonly active = new Set<string>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly running = new Set<Promise<void>>();
  private idleWaiters: Array<() => void> = [];
  private stopped = false;

  constructor(private readonly log: LoggerPort) {}

  register(_def: JobDefinition): void {}

  async enqueue(def: JobDefinition, data: unknown, opts: EnqueueOptions): Promise<void> {
    if (this.stopped) throw new Error("Jobs driver is stopped");
    const jobId = opts.jobId ?? newId();
    if (this.active.has(jobId)) return;
    this.active.add(jobId);
    this.later(opts.delayMs ?? 0, () => this.run(def, data, jobId, 1));
  }

  async schedule(def: JobDefinition, cron: string): Promise<void> {
    this.log.warn({ job: def.name, cron }, "jobs: cron schedules are disabled in memory mode");
  }

  async start(): Promise<void> {
    this.stopped = false;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.active.clear();
    await Promise.allSettled([...this.running]);
    this.notifyIdle();
  }

  /** Resolves once no jobs are pending, retrying or running. Test helper. */
  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private isIdle() {
    return this.timers.size === 0 && this.running.size === 0;
  }

  private notifyIdle() {
    if (!this.isIdle()) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of waiters) w();
  }

  private later(ms: number, fn: () => Promise<void>) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      const p = fn().finally(() => {
        this.running.delete(p);
        this.notifyIdle();
      });
      this.running.add(p);
    }, ms);
    this.timers.add(timer);
  }

  private async run(def: JobDefinition, data: unknown, jobId: string, attempt: number): Promise<void> {
    if (this.stopped) return;
    try {
      await def.handler(data, { attempt, jobId });
      this.active.delete(jobId);
    } catch (err) {
      if (attempt < def.attempts && !this.stopped) {
        this.log.warn({ job: def.name, jobId, attempt, err }, "jobs: attempt failed, retrying");
        this.later(backoffDelay(def.backoffMs, attempt), () => this.run(def, data, jobId, attempt + 1));
      } else {
        this.active.delete(jobId);
        this.log.error({ job: def.name, jobId, attempt, err }, "jobs: job failed permanently");
      }
    }
  }
}
