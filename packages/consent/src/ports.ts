/** Returns everything a module holds about a user, for a DPDP data export. */
export type DataExporter = (userId: string) => Promise<unknown>;

/** Erases or anonymises everything a module holds about a user. Must be idempotent (it may be retried). */
export type DataEraser = (userId: string) => Promise<void>;

/** Background job queue (the jobs module implements it). Optional: without it work runs inline. */
export interface QueuePort {
  define(name: string, handler: (data: any) => Promise<void>): void;
  enqueue(name: string, data: unknown, opts?: Record<string, unknown>): Promise<void>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}
