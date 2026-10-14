import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import type { EnqueueOptions, JobDefinition, JobsDriver, LoggerPort, ScheduleOptions } from "./types";

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
    worker.on("failed", (job, err) => {
      const attempt = (job?.attemptsMade ?? 0);
      const final = attempt >= def.attempts;
      const payload = { job: def.name, jobId: job?.id, attempt, err };
      if (final) this.log.error(payload, "jobs: job failed permanently");
      else this.log.warn(payload, "jobs: attempt failed, retrying");
    });
    worker.on("error", (err) => this.log.error({ job: def.name, err }, "jobs: worker error"));
    this.workers.set(def.name, worker);
  }
}
