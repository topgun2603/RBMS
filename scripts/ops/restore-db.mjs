#!/usr/bin/env node
// Restores a backup into a target database. The target's name must end in "_restore" unless --force is passed.
//
//   node scripts/ops/restore-db.mjs <file.dump.gz | s3://bucket/key | latest> --target <postgres-url>
//                                   [--fresh] [--force] [--docker|--local]
//
//   --target   database URL to restore into (or RESTORE_DATABASE_URL)
//   --fresh    drop and recreate the target first (otherwise objects are dropped/recreated by pg_restore --clean)
//   --force    allow a target whose name doesn't end in _restore (e.g. production recovery). Be sure.
import { loadEnv, parseArgs, pgTarget } from "./lib/common.mjs";
import { assertRestoreTarget, prepareDatabase, resolveDump, restoreDump } from "./lib/restore.mjs";

loadEnv();
const { flags, positionals } = parseArgs(process.argv.slice(2), ["fresh", "force", "docker", "local", "help"]);
const source = positionals[0];
const targetUrl = flags.target ?? process.env.RESTORE_DATABASE_URL;
if (flags.help || !source || !targetUrl) {
  console.log("usage: node scripts/ops/restore-db.mjs <file.dump.gz|s3://bucket/key|latest> --target URL [--fresh] [--force] [--docker|--local]");
  process.exit(flags.help ? 0 : 2);
}
const log = (s) => console.log(`[restore] ${s}`);

try {
  const target = pgTarget(targetUrl);
  assertRestoreTarget(target.database, !!flags.force);
  if (flags.force && !target.database.endsWith("_restore")) log(`--force: restoring over "${target.database}"`);
  const source_db = process.env.DATABASE_URL ? pgTarget(process.env.DATABASE_URL).database : undefined;
  const dump = await resolveDump(source, { database: source === "latest" ? source_db : undefined, log });
  try {
    await prepareDatabase(targetUrl, { fresh: !!flags.fresh, log });
    const r = await restoreDump({ file: dump.file, url: targetUrl, tool: flags.docker ? "docker" : flags.local ? "local" : "auto", log });
    log(`done in ${r.ms} ms → ${target.display}`);
  } finally {
    await dump.cleanup();
  }
} catch (err) {
  console.error(`[restore] FAILED: ${err.message}`);
  process.exit(1);
}
