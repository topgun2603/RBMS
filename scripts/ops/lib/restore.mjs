import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { backupS3Config, pgTarget, pgTool, quoteIdent, s3Client, s3Sdk, sqlClient, start } from "./common.mjs";
import { DEFAULT_DIR, listLocal, listS3 } from "./backup.mjs";
import { parseBackupDate } from "./retention.mjs";

/** Restoring over a database is only allowed for `*_restore` names, unless forced. */
export function assertRestoreTarget(database, force) {
  if (database.endsWith("_restore") || force) return;
  throw new Error(
    `Refusing to restore into "${database}": the target database name must end in "_restore" (pass --force to overwrite it anyway).`,
  );
}

/**
 * A local dump file for `source`: a path, `s3://bucket/key`, or `latest` (newest in S3 when BACKUP_S3_BUCKET is set,
 * otherwise in ./backups). Returns { file, cleanup }.
 */
export async function resolveDump(source, { database, log = () => {} } = {}) {
  if (source === "latest") {
    const s3 = backupS3Config();
    const names = (s3 ? await listS3(s3) : await listLocal()).filter((n) => !database || n.split("/").pop().startsWith(`${database}-`));
    const newest = names.sort((a, b) => parseBackupDate(b) - parseBackupDate(a))[0];
    if (!newest) throw new Error(`No backups found ${s3 ? `in s3://${s3.bucket}/${s3.prefix}` : `in ${DEFAULT_DIR}`}`);
    source = s3 ? `s3://${s3.bucket}/${newest}` : join(DEFAULT_DIR, newest);
    log(`latest backup: ${source}`);
  }
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(source);
  if (!m) return { file: source, cleanup: async () => {} };
  const cfg = backupS3Config() ?? { bucket: m[1], prefix: "", region: process.env.BACKUP_S3_REGION || "ap-south-1" };
  const { GetObjectCommand } = await s3Sdk();
  const client = await s3Client(cfg);
  const dir = await mkdtemp(join(tmpdir(), "srikit-restore-"));
  const file = join(dir, m[2].split("/").pop());
  const r = await client.send(new GetObjectCommand({ Bucket: m[1], Key: m[2] }));
  await pipeline(r.Body, createWriteStream(file));
  log(`downloaded ${source}`);
  return { file, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Creates the target database when missing; with `fresh`, drops it first (terminating its connections). */
export async function prepareDatabase(url, { fresh = false, log = () => {} } = {}) {
  const t = pgTarget(url);
  const admin = await sqlClient(t.withDatabase("postgres"));
  try {
    if (fresh) {
      await admin.unsafe(`drop database if exists ${quoteIdent(t.database)} with (force)`);
      log(`dropped ${t.database} (fresh restore)`);
    }
    const exists = await admin`select 1 from pg_database where datname = ${t.database}`;
    if (exists.length === 0) {
      await admin.unsafe(`create database ${quoteIdent(t.database)}`);
      log(`created database ${t.database}`);
    }
  } finally {
    await admin.end();
  }
}

export async function dropDatabase(url) {
  const t = pgTarget(url);
  const admin = await sqlClient(t.withDatabase("postgres"));
  try {
    await admin.unsafe(`drop database if exists ${quoteIdent(t.database)} with (force)`);
  } finally {
    await admin.end();
  }
}

/**
 * Streams a `.dump.gz` into pg_restore (`--no-owner --no-acl --clean --if-exists`), so a restore works on a fresh or
 * an existing database and under another role (RDS master user).
 */
export async function restoreDump({ file, url, tool = "auto", log = () => {} }) {
  const t = pgTarget(url);
  const pg = pgTool("pg_restore", t, tool);
  log(`pg_restore (${pg.how}) ${file} → ${t.display}`);
  const started = Date.now();
  const { child, exited } = start(pg, ["--no-owner", "--no-acl", "--clean", "--if-exists", "--no-password"], { stdin: true });
  const [piped, result] = await Promise.allSettled([pipeline(createReadStream(file), createGunzip(), child.stdin), exited]);
  const code = result.status === "fulfilled" ? result.value.code : 1;
  const stderr = result.status === "fulfilled" ? result.value.stderr.trim() : String(result.reason);
  if (code !== 0) throw new Error(`pg_restore failed (exit ${code}): ${stderr.split("\n").slice(-8).join(" | ")}`);
  if (piped.status === "rejected") throw new Error(`reading the dump failed: ${piped.reason?.message ?? piped.reason}`);
  if (stderr) log(`pg_restore warnings:\n${stderr}`);
  return { ms: Date.now() - started, how: pg.how };
}
