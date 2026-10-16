import type {
  DefineOptions,
  EnqueueOptions,
  JobCounts,
  JobDefinition,
  JobHandler,
  JobsDriver,
  JobsHealth,
  ScheduleOptions,
} from "./types";

export class JobsService {
  private readonly defs = new Map<string, JobDefinition>();

  constructor(private readonly driver: JobsDriver) {}

  define<T>(name: string, handler: JobHandler<T>, opts: DefineOptions = {}): void {
    if (this.defs.has(name)) throw new Error(`Job "${name}" is already defined`);
    const def: JobDefinition = {
      name,
      handler: handler as JobHandler<unknown>,
      attempts: Math.max(1, opts.attempts ?? 3),
      backoffMs: opts.backoffMs ?? 5000,
      concurrency: Math.max(1, opts.concurrency ?? 5),
    };
    this.defs.set(name, def);
    this.driver.register(def);
  }

  async enqueue<T>(name: string, data: T, opts: EnqueueOptions = {}): Promise<void> {
    await this.driver.enqueue(this.get(name), data, opts);
  }

  /** Repeatable job on a cron pattern (default time zone Asia/Kolkata). Not supported in memory mode. */
  async schedule(name: string, cron: string, data?: unknown, opts: ScheduleOptions = {}): Promise<void> {
    await this.driver.schedule(this.get(name), cron, data ?? {}, { ...opts, tz: opts.tz ?? "Asia/Kolkata" });
  }

  /** Names of all defined jobs. */
  names(): string[] {
    return [...this.defs.keys()];
  }

  /** Jobs per state for every defined job (metrics: queue depth). Throws when Redis is unreachable. */
  counts(): Promise<Record<string, JobCounts>> {
    return this.driver.counts([...this.defs.values()]);
  }

  /** Readiness probe of the queue backend; throws when it is down. */
  health(): Promise<JobsHealth> {
    return this.driver.health();
  }

  private get(name: string): JobDefinition {
    const def = this.defs.get(name);
    if (!def) throw new Error(`Unknown job "${name}"; call define() first`);
    return def;
  }
}

/** What other modules depend on when they need background work. */
export type QueuePort = Pick<JobsService, "define" | "enqueue">;
