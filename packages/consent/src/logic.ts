import type { DataEraser, DataExporter } from "./ports";

export interface ConsentDecision {
  granted: boolean;
  version: string;
  source: string;
  at: Date;
}

/** Reduces a consent log to the latest decision per purpose (by created_at; later rows win ties). */
export function latestByPurpose(
  rows: Array<{ purpose: string; granted: boolean; version: string; source: string; createdAt: Date }>,
): Record<string, ConsentDecision> {
  const out: Record<string, ConsentDecision> = {};
  for (const r of rows) {
    const prev = out[r.purpose];
    if (!prev || r.createdAt.getTime() >= prev.at.getTime()) {
      out[r.purpose] = { granted: r.granted, version: r.version, source: r.source, at: r.createdAt };
    }
  }
  return out;
}

export interface ExportPayload {
  generatedAt: string;
  userId: string;
  modules: Record<string, unknown>;
}

/** Runs every exporter. A failing exporter records `{ error }` under its id instead of failing the export. */
export async function runExporters(
  exporters: Iterable<[string, DataExporter]>,
  userId: string,
  now: Date = new Date(),
  onError?: (moduleId: string, err: unknown) => void,
): Promise<ExportPayload> {
  const modules: Record<string, unknown> = {};
  for (const [id, fn] of exporters) {
    try {
      modules[id] = (await fn(userId)) ?? null;
    } catch (err) {
      onError?.(id, err);
      modules[id] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { generatedAt: now.toISOString(), userId, modules };
}

/**
 * Runs erasers in reverse registration order (auth is registered first, so it runs last and the
 * account stays resolvable while other modules clean up). Stops at the first failure and throws
 * an error naming the module, so the whole deletion is retried later (erasers must be idempotent).
 */
export async function runErasers(erasers: Array<[string, DataEraser]>, userId: string): Promise<void> {
  for (const [id, fn] of [...erasers].reverse()) {
    try {
      await fn(userId);
    } catch (err) {
      throw new Error(`${id}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
  }
}
