import { newId } from "@srirealtime/core";
import {
  backoffDelay,
  notifyObserver,
  type EnqueueOptions,
  type JobCounts,
  type JobDefinition,
  type JobObserver,
  type JobsDriver,
  type JobsHealth,
  type LoggerPort,
} from "./types";

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
  private readonly defined = new Set<string>();
  /** Pending + running jobs per name (for counts()). */
  private readonly waiting = new Map<string, number>();
  private readonly activeByName = new Map<string, number>();
  private readonly failedByName = new Map<string, number>();
  private readonly completedByName = new Map<string, number>();

  constructor(
    private readonly log: LoggerPort,
    private readonly observer?: JobObserver,
  ) {}

  register(def: JobDefinition): void {
    this.defined.add(def.name);
  }

  async counts(defs: JobDefinition[]): Promise<Record<string, JobCounts>> {
    const out: Record<string, JobCounts> = {};
    for (const d of defs) {
      out[d.name] = {
        waiting: this.waiting.get(d.name) ?? 0,
        active: this.activeByName.get(d.name) ?? 0,
        delayed: 0,
        failed: this.failedByName.get(d.name) ?? 0,
        completed: this.completedByName.get(d.name) ?? 0,
        paused: 0,
        prioritized: 0,
      };
    }
    return out;
  }

  async health(): Promise<JobsHealth> {
    return { driver: "memory", started: !this.stopped, workers: this.defined.size };
  }

  private bump(map: Map<string, number>, name: string, by: number) {
    map.set(name, Math.max(0, (map.get(name) ?? 0) + by));
  }

  async enqueue(def: JobDefinition, data: unknown, opts: EnqueueOptions): Promise<void> {
    if (this.stopped) throw new Error("Jobs driver is stopped");
    const jobId = opts.jobId ?? newId();
    if (this.active.has(jobId)) return;
    this.active.add(jobId);
    this.bump(this.waiting, def.name, 1);
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
    this.waiting.clear();
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
    const started = Date.now();
    this.bump(this.waiting, def.name, -1);
    this.bump(this.activeByName, def.name, 1);
    try {
      await def.handler(data, { attempt, jobId });
      this.active.delete(jobId);
      this.bump(this.completedByName, def.name, 1);
      notifyObserver(this.observer, { name: def.name, jobId, attempt, outcome: "completed", durationMs: Date.now() - started, data });
    } catch (err) {
      const durationMs = Date.now() - started;
      if (attempt < def.attempts && !this.stopped) {
        this.log.warn({ job: def.name, jobId, attempt, err }, "jobs: attempt failed, retrying");
        notifyObserver(this.observer, { name: def.name, jobId, attempt, outcome: "retry", durationMs, err, data });
        this.bump(this.waiting, def.name, 1);
        this.later(backoffDelay(def.backoffMs, attempt), () => this.run(def, data, jobId, attempt + 1));
      } else {
        this.active.delete(jobId);
        this.bump(this.failedByName, def.name, 1);
        this.log.error({ job: def.name, jobId, attempt, err }, "jobs: job failed permanently");
        notifyObserver(this.observer, { name: def.name, jobId, attempt, outcome: "failed", durationMs, err, data });
      }
    } finally {
      this.bump(this.activeByName, def.name, -1);
    }
  }
}
