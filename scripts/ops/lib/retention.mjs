// Backup names and the retention policy (keep N daily + M monthly). Pure functions; see retention.test.mjs.

const STAMP = /-(\d{8}T\d{6}Z)\.dump\.gz$/;

/** `20261016T063000Z` for a date (UTC). */
export function stamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** `srikit-20261016T063000Z.dump.gz` — the database name, then the UTC time of the dump. */
export function backupName(dbName, date = new Date()) {
  const safe = String(dbName).replace(/[^A-Za-z0-9_-]/g, "_");
  return `${safe}-${stamp(date)}.dump.gz`;
}

/** The dump time encoded in a backup name (any path prefix allowed), or null for files that aren't backups. */
export function parseBackupDate(name) {
  const m = STAMP.exec(String(name));
  if (!m) return null;
  const s = m[1];
  const d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Calendar day / month of a date in a fixed UTC offset (IST = +330 minutes by default). */
function dayKey(date, offsetMinutes) {
  return new Date(date.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}
function monthKey(date, offsetMinutes) {
  return dayKey(date, offsetMinutes).slice(0, 7);
}

/**
 * Which backups to keep and which to prune.
 *
 * - daily: the newest backup of each of the `keepDaily` most recent days that have a backup;
 * - monthly: the newest backup of each of the `keepMonthly` most recent months that have a backup;
 * - the newest backup overall is always kept;
 * - names that don't parse as backups are never pruned (they are not ours).
 *
 * Days and months are taken in `offsetMinutes` (default IST), so "the 1st" means the 1st in India.
 *
 * @param {string[]} names
 * @param {{ keepDaily?: number, keepMonthly?: number, offsetMinutes?: number }} [opts]
 * @returns {{ keep: string[], prune: string[], reasons: Record<string, string[]> }}
 */
export function planRetention(names, opts = {}) {
  const keepDaily = opts.keepDaily ?? 7;
  const keepMonthly = opts.keepMonthly ?? 12;
  const offset = opts.offsetMinutes ?? 330;
  if (!Number.isInteger(keepDaily) || keepDaily < 1) throw new Error("keepDaily must be an integer >= 1");
  if (!Number.isInteger(keepMonthly) || keepMonthly < 0) throw new Error("keepMonthly must be an integer >= 0");

  const backups = names
    .map((name) => ({ name, date: parseBackupDate(name) }))
    .filter((b) => b.date)
    .sort((a, b) => b.date.getTime() - a.date.getTime() || (a.name < b.name ? 1 : -1));

  const reasons = {};
  const mark = (name, why) => (reasons[name] ??= []).push(why);

  if (backups.length) mark(backups[0].name, "newest");
  const days = new Set();
  const months = new Set();
  for (const b of backups) {
    const d = dayKey(b.date, offset);
    if (!days.has(d) && days.size < keepDaily) {
      days.add(d);
      mark(b.name, `daily ${d}`);
    }
    const m = monthKey(b.date, offset);
    if (!months.has(m) && months.size < keepMonthly) {
      months.add(m);
      mark(b.name, `monthly ${m}`);
    }
  }
  const keep = backups.filter((b) => reasons[b.name]).map((b) => b.name);
  const prune = backups.filter((b) => !reasons[b.name]).map((b) => b.name);
  return { keep, prune, reasons };
}
