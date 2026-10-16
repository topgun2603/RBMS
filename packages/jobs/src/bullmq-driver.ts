import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import {
  notifyObserver,
  type EnqueueOptions,
  type JobCounts,
  type JobDefinition,
  type JobObserver,
  type JobsDriver,
  type JobsHealth,
  type LoggerPort,
  type ScheduleOptions,
} from "./types";

const COUNT_STATES = ["waiting", "active", "delayed", "failed", "completed", "paused", "prioritized"] as const;

/** Redis-backed driver: one BullMQ queue (and one worker once started) per job name. */
export class BullJobsDriver implements JobsDriver {
  private connection: Redis | null = null;
  private readonly defs = new Map<string, JobDefinition>();
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Map<string, Worker>();
  private started = false;

  constructor(
    private readonly redisUrl: string,
    private readonly prefix: string,
    private readonly log: LoggerPort,
    private readonly observer?: JobObserver,
  ) {}

  register(def: JobDefinition): void {
    this.defs.set(def.name, def);
    if (this.started) this.startWorker(def);
  }

  async enqueue(def: JobDefinition, data: unknown, opts: EnqueueOptions): Promise<void> {
    await this.queue(def).add(def.name, data, {
      delay: opts.delayMs,
      jobId: opts.jobId,
    });
  }

  async schedule(def: JobDefinition, cron: string, data: unknown, opts: ScheduleOptions & { tz: string }): Promise<void> {
    await this.queue(def).upsertJobScheduler(opts.key ?? def.name, { pattern: cron, tz: opts.tz }, { name: def.name, data });
  }

  async start(): Promise<void> {
    this.started = true;
    for (const def of this.defs.values()) this.startWorker(def);
  }

  async stop(): Promise<void> {
    this.started = false;
    await Promise.allSettled([...this.workers.values()].map((w) => w.close()));
    this.workers.clear();
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
    if (this.connection) {
      await this.connection.quit().catch(() => this.connection?.disconnect());
      this.connection = null;
    }
  }

  async counts(defs: JobDefinition[]): Promise<Record<string, JobCounts>> {
    this.assertConnected();
    const entries = await Promise.all(
      defs.map(async (def) => {
        const raw = await this.queue(def).getJobCounts(...COUNT_STATES);
        const counts = Object.fromEntries(COUNT_STATES.map((s) => [s, raw[s] ?? 0])) as unknown as JobCounts;
        return [def.name, counts] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  async health(): Promise<JobsHealth> {
    const conn = this.assertConnected();
    await conn.ping();
    return { driver: "bullmq", started: this.started, workers: this.workers.size, connection: conn.status };
  }

  /**
   * The shared connection when it is ready. Commands on a connection that isn't (`maxRetriesPerRequest: null`) would
   * wait in the offline queue until Redis comes back, so probes fail fast instead.
   */
  private assertConnected(): Redis {
    const conn = this.redis();
    if (conn.status !== "ready") throw new Error(`redis connection ${conn.status}`);
    return conn;
  }

  private redis(): Redis {
    // BullMQ requires maxRetriesPerRequest: null for blocking worker connections.
    this.connection ??= new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    return this.connection;
  }

  private queue(def: JobDefinition): Queue {
    let q = this.queues.get(def.name);
    if (!q) {
      q = new Queue(def.name, {
        connection: this.redis(),
        prefix: this.prefix,
        defaultJobOptions: {
          attempts: def.attempts,
          backoff: { type: "exponential", delay: def.backoffMs },
          removeOnComplete: { age: 24 * 3600, count: 1000 },
          removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
        },
      });
      q.on("error", (err) => this.log.error({ job: def.name, err }, "jobs: queue error"));
      this.queues.set(def.name, q);
    }
    return q;
  }

  private startWorker(def: JobDefinition) {
    if (this.workers.has(def.name)) return;
    const worker = new Worker(
      def.name,
      async (job: Job) => def.handler(job.data, { attempt: job.attemptsMade + 1, jobId: job.id ?? "" }),
      { connection: this.redis(), prefix: this.prefix, concurrency: def.concurrency },
    );
    const durationOf = (job: Job | undefined) =>
      job?.processedOn ? Math.max(0, (job.finishedOn ?? Date.now()) - job.processedOn) : 0;
    worker.on("completed", (job) => {
      notifyObserver(this.observer, {
        name: def.name,
        jobId: job.id ?? "",
        attempt: job.attemptsMade + 1,
        outcome: "completed",
        durationMs: durationOf(job),
        data: job.data,
      });
    });
    worker.on("failed", (job, err) => {
      const attempt = (job?.attemptsMade ?? 0);
      const final = attempt >= def.attempts;
      const payload = { job: def.name, jobId: job?.id, attempt, err };
      if (final) this.log.error(payload, "jobs: job failed permanently");
      else this.log.warn(payload, "jobs: attempt failed, retrying");
      notifyObserver(this.observer, {
        name: def.name,
        jobId: job?.id ?? "",
        attempt,
        outcome: final ? "failed" : "retry",
        durationMs: durationOf(job),
        err,
        data: job?.data,
      });
    });
    worker.on("error", (err) => this.log.error({ job: def.name, err }, "jobs: worker error"));
    this.workers.set(def.name, worker);
  }
}
