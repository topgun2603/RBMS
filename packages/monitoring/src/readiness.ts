import { withTimeout } from "./metrics";
import { scrubString } from "./scrub";

/** One dependency probe. Resolve (optionally with safe details) when healthy; throw when not. */
export type ReadinessProbe = () => Promise<Record<string, unknown> | void>;

export interface CheckResult {
  ok: boolean;
  latencyMs: number;
  /** Short, scrubbed reason (never a connection string or credential). */
  error?: string;
  /** Safe details the probe returned, e.g. { workers: 30 }. */
  details?: Record<string, unknown>;
}

export interface ReadinessReport {
  status: "ok" | "fail";
  checks: Record<string, CheckResult>;
  /** ISO time the checks ran. */
  checkedAt: string;
}

/**
 * A short, safe reason for a failed probe: the error code when there is one (ECONNREFUSED, ETIMEDOUT), otherwise the
 * scrubbed first line of the message with hosts/URLs removed, clipped to 120 chars.
 */
export function safeReason(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === "string" && /^[A-Z0-9_]{2,40}$/.test(e.code) ? e.code : null;
  const raw = typeof e?.message === "string" ? e.message : String(err);
  const line = scrubString(raw.split("\n")[0] ?? "")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "<host>")
    .slice(0, 120);
  return code && !line.includes(code) ? `${code}: ${line}` : line || code || "error";
}

/**
 * Runs every probe in parallel, each with its own timeout. The report is `fail` when any probe throws or times out;
 * the host turns that into a 503.
 */
export async function checkReadiness(
  probes: Record<string, ReadinessProbe>,
  opts: { timeoutMs?: number; now?: () => number } = {},
): Promise<ReadinessReport> {
  const timeoutMs = opts.timeoutMs ?? 2000;
  const now = opts.now ?? (() => performance.now());
  const entries = await Promise.all(
    Object.entries(probes).map(async ([name, probe]): Promise<[string, CheckResult]> => {
      const start = now();
      try {
        const details = await withTimeout(Promise.resolve().then(probe), timeoutMs, `timed out after ${timeoutMs} ms`);
        const r: CheckResult = { ok: true, latencyMs: round(now() - start) };
        if (details && Object.keys(details).length) r.details = details;
        return [name, r];
      } catch (err) {
        return [name, { ok: false, latencyMs: round(now() - start), error: safeReason(err) }];
      }
    }),
  );
  const checks = Object.fromEntries(entries);
  return {
    status: entries.every(([, r]) => r.ok) ? "ok" : "fail",
    checks,
    checkedAt: new Date().toISOString(),
  };
}

const round = (ms: number) => Math.round(ms * 10) / 10;
