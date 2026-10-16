import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { backupS3Config, fmtBytes, pgTarget, pgTool, ROOT, s3Client, s3Sdk, start } from "./common.mjs";
import { backupName, planRetention } from "./retention.mjs";

export const DEFAULT_DIR = join(ROOT, "backups");

const sha256 = async (file) => {
  const h = createHash("sha256");
  await pipeline(createReadStream(file), h);
  return h.digest("hex");
};

/**
 * `pg_dump -Fc` of a database, gzipped into `<dir>/<db>-<UTC stamp>.dump.gz`. The custom format's own compression is
 * off (`-Z0`) so the dump is compressed once, by gzip. With `snapshot`, the dump sees exactly that exported snapshot
 * (the restore drill counts rows in the same snapshot).
 *
 * @param {{ url: string, dir?: string, snapshot?: string, tool?: "auto"|"local"|"docker", log?: (s: string) => void }} o
 */
export async function dumpDatabase(o) {
  const log = o.log ?? (() => {});
  const target = pgTarget(o.url);
  const dir = resolve(o.dir ?? DEFAULT_DIR);
  await mkdir(dir, { recursive: true });
  const name = backupName(target.database);
  const file = join(dir, name);
  const partial = `${file}.partial`;
  const tool = pgTool("pg_dump", target, o.tool ?? "auto");
  log(`pg_dump (${tool.how}) ${target.display} → ${file}`);

  const args = ["-Fc", "-Z0", "--no-password"];
  if (o.snapshot) args.push(`--snapshot=${o.snapshot}`);
  const started = Date.now();
  const { child, exited } = start(tool, args, { stdout: true });
  const [piped, result] = await Promise.allSettled([pipeline(child.stdout, createGzip({ level: 6 }), createWriteStream(partial)), exited]);
  const code = result.status === "fulfilled" ? result.value.code : 1;
  const stderr = result.status === "fulfilled" ? result.value.stderr : String(result.reason);
  if (code !== 0 || piped.status === "rejected") {
    await rm(partial, { force: true });
    throw new Error(`pg_dump failed (exit ${code}): ${stderr.trim().split("\n").slice(-5).join(" | ") || piped.reason}`);
  }
  await rename(partial, file);
  const size = (await stat(file)).size;
  if (size < 100) throw new Error(`pg_dump produced a suspiciously small file (${size} bytes)`);
  const out = { file, name, size, sha256: await sha256(file), ms: Date.now() - started, how: tool.how, database: target.database };
  log(`dump ok: ${fmtBytes(size)} in ${out.ms} ms, sha256 ${out.sha256.slice(0, 16)}…`);
  return out;
}

/** Uploads a dump to s3://bucket/prefix/name (server-side encrypted, sha256 in metadata). */
export async function uploadDump(dump, cfg, log = () => {}) {
  const { PutObjectCommand } = await s3Sdk();
  const client = await s3Client(cfg);
  const key = `${cfg.prefix}${dump.name}`;
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: createReadStream(dump.file),
      ContentLength: dump.size,
      ContentType: "application/gzip",
      ServerSideEncryption: cfg.endpoint ? undefined : "AES256",
      Metadata: { sha256: dump.sha256, database: dump.database },
    }),
  );
  log(`uploaded s3://${cfg.bucket}/${key}`);
  return key;
}

/** Backup names in the local directory. */
export async function listLocal(dir = DEFAULT_DIR) {
  try {
    return (await readdir(dir)).filter((n) => n.endsWith(".dump.gz"));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

/** Backup keys (full keys) under the S3 prefix. */
export async function listS3(cfg) {
  const { ListObjectsV2Command } = await s3Sdk();
  const client = await s3Client(cfg);
  const keys = [];
  let token;
  do {
    const r = await client.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: cfg.prefix, ContinuationToken: token }));
    for (const o of r.Contents ?? []) if (o.Key?.endsWith(".dump.gz")) keys.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** Applies the retention policy to the local directory or the S3 prefix. Only names of one database are compared. */
export async function prune({ database, keepDaily, keepMonthly, s3, dir = DEFAULT_DIR, dryRun = false, log = () => {} }) {
  const own = (n) => n.split("/").pop().startsWith(`${database}-`);
  const names = (s3 ? await listS3(s3) : await listLocal(dir)).filter(own);
  const plan = planRetention(names, { keepDaily, keepMonthly });
  if (plan.prune.length === 0) {
    log(`retention: keep ${plan.keep.length}, nothing to prune`);
    return plan;
  }
  log(`retention: keep ${plan.keep.length}, prune ${plan.prune.length}${dryRun ? " (dry run)" : ""}`);
  if (dryRun) return plan;
  if (s3) {
    const { DeleteObjectCommand } = await s3Sdk();
    const client = await s3Client(s3);
    for (const key of plan.prune) await client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: key }));
  } else {
    for (const n of plan.prune) await rm(join(dir, n), { force: true });
  }
  for (const n of plan.prune) log(`  pruned ${n}`);
  return plan;
}

/** The whole backup: dump, then upload + prune on S3 (BACKUP_S3_BUCKET) or prune ./backups. */
export async function backup(o) {
  const log = o.log ?? console.log;
  const s3 = o.upload === false ? null : backupS3Config();
  const dump = await dumpDatabase({ ...o, log });
  const keep = { keepDaily: o.keepDaily, keepMonthly: o.keepMonthly };
  let location = dump.file;
  if (s3) {
    const key = await uploadDump(dump, s3, log);
    location = `s3://${s3.bucket}/${key}`;
    if (!o.keepLocal) await rm(dump.file, { force: true });
  }
  if (o.prune !== false) await prune({ database: dump.database, ...keep, s3, dir: o.dir ?? DEFAULT_DIR, log });
  return { ...dump, location };
}
