import type { FeatureGatePort } from "@srirealtime/core";

export type { FeatureGatePort };

export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface EmailMessage {
  tenantId: string;
  /** One email address. */
  to: string;
  subject: string;
  text: string;
  attachments: EmailAttachment[];
}

/** Implemented with notify at integration (notify gains attachment support). Throws on failure. */
export interface EmailPort {
  send(message: EmailMessage): Promise<unknown>;
}

/** Background job queue (the jobs module implements it). Optional: without it scheduled runs happen inline. */
export interface QueuePort {
  define(name: string, handler: (data: any) => Promise<void>, opts?: { attempts?: number }): void;
  enqueue(name: string, data: unknown, opts?: { jobId?: string; delayMs?: number }): Promise<void>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
