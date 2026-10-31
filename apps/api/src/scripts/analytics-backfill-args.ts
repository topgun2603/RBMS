/** Command-line options of `analytics-backfill`; pure so it can be tested. */
export interface BackfillArgs {
  /** IST days to recompute, ending today (the rollup caps it at the raw-event retention + 1). */
  days: number;
  tenantId?: string;
}

export const BACKFILL_USAGE = "Usage: analytics-backfill [--days <1-366>] [--tenant <tenant uuid>]";
export const DEFAULT_BACKFILL_DAYS = 90;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `--days 30 --tenant <uuid>` (also `--days=30`). Throws an Error with the usage text on anything else. */
export function parseBackfillArgs(argv: readonly string[]): BackfillArgs {
  const out: BackfillArgs = { days: DEFAULT_BACKFILL_DAYS };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i]!.split("=", 2) as [string, string | undefined];
    const value = () => inline ?? argv[++i];
    if (flag === "--days") {
      const raw = value();
      const n = Number(raw);
      if (!raw || !Number.isInteger(n) || n < 1 || n > 366) throw new Error(`--days must be a whole number from 1 to 366. ${BACKFILL_USAGE}`);
      out.days = n;
    } else if (flag === "--tenant") {
      const raw = value();
      if (!raw || !UUID_RE.test(raw)) throw new Error(`--tenant must be a tenant id (uuid). ${BACKFILL_USAGE}`);
      out.tenantId = raw;
    } else {
      throw new Error(`Unknown option ${argv[i]}. ${BACKFILL_USAGE}`);
    }
  }
  return out;
}
