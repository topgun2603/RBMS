#!/usr/bin/env node
// Backs up the database (pg_dump -Fc, gzipped, timestamped) to S3 (BACKUP_S3_BUCKET) or ./backups, then prunes old
// backups (keep BACKUP_KEEP_DAILY daily + BACKUP_KEEP_MONTHLY monthly). See docs/ops.md.
//
//   node scripts/ops/backup-db.mjs [--url <postgres-url>] [--dir ./backups] [--docker|--local]
//                                  [--no-upload] [--keep-local] [--no-prune] [--dry-run-prune]
//                                  [--keep-daily 7] [--keep-monthly 12] [--json]
import { fmtBytes, loadEnv, parseArgs } from "./lib/common.mjs";
import { backup, prune } from "./lib/backup.mjs";

loadEnv();
const { flags } = parseArgs(process.argv.slice(2), ["docker", "local", "keep-local", "json", "dry-run-prune", "help"]);
if (flags.help) {
  console.log("usage: node scripts/ops/backup-db.mjs [--url URL] [--dir DIR] [--docker|--local] [--no-upload] [--keep-local] [--no-prune] [--keep-daily N] [--keep-monthly M] [--json]");
  process.exit(0);
}

const url = flags.url ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (and no --url given)");
  process.exit(2);
}
const int = (v, d) => (v === undefined ? d : Number.parseInt(String(v), 10));
const keepDaily = int(flags["keep-daily"] ?? process.env.BACKUP_KEEP_DAILY, 7);
const keepMonthly = int(flags["keep-monthly"] ?? process.env.BACKUP_KEEP_MONTHLY, 12);
const tool = flags.docker ? "docker" : flags.local ? "local" : "auto";
const log = flags.json ? () => {} : (s) => console.log(`[backup] ${s}`);

try {
  const result = await backup({
    url,
    dir: flags.dir,
    tool,
    upload: !flags["no-upload"],
    keepLocal: !!flags["keep-local"],
    prune: !flags["no-prune"] && !flags["dry-run-prune"],
    keepDaily,
    keepMonthly,
    log,
  });
  if (flags["dry-run-prune"]) await prune({ database: result.database, keepDaily, keepMonthly, dir: flags.dir, dryRun: true, log });
  if (flags.json) console.log(JSON.stringify(result));
  else log(`done: ${result.location} (${fmtBytes(result.size)})`);
} catch (err) {
  console.error(`[backup] FAILED: ${err.message}`);
  process.exit(1);
}
