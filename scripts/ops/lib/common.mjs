// Shared helpers for the backup / restore / drill scripts. Plain Node (>= 22), Windows and Linux.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const COMPOSE_FILE = join(ROOT, "docker-compose.yml");
export const COMPOSE_SERVICE = process.env.BACKUP_COMPOSE_SERVICE || "postgres";

/** Loads apps/api/.env (then the root .env) for variables that aren't already set. */
export function loadEnv() {
  for (const file of [join(ROOT, "apps/api/.env"), join(ROOT, ".env")]) {
    if (!existsSync(file)) continue;
    try {
      process.loadEnvFile(file);
    } catch {
      // unreadable env file: rely on the process environment
    }
  }
}

/** `--name value`, `--name=value` and boolean `--flag`; the rest are positionals. */
export function parseArgs(argv, booleans = []) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positionals.push(a);
      continue;
    }
    const [k, v] = a.slice(2).split(/=(.*)/s);
    if (v !== undefined) flags[k] = v;
    else if (booleans.includes(k) || k.startsWith("no-")) flags[k] = true;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
    else flags[k] = true;
  }
  return { flags, positionals };
}

/** Parsed connection URL. `display` never contains the password. */
export function pgTarget(url) {
  const u = new URL(url);
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!database) throw new Error("The database URL has no database name");
  const masked = new URL(url);
  if (masked.password) masked.password = "***";
  return {
    url,
    host: u.hostname,
    port: u.port || "5432",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
    local: ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname),
    display: masked.toString(),
    /** Same server, another database. */
    withDatabase(name) {
      const n = new URL(url);
      n.pathname = `/${encodeURIComponent(name)}`;
      return n.toString();
    },
  };
}

/** libpq environment for a target (password via PGPASSWORD, never on the command line). */
export function pgEnv(t) {
  const env = { ...process.env, PGHOST: t.host, PGPORT: t.port, PGUSER: t.user, PGDATABASE: t.database };
  if (t.password) env.PGPASSWORD = t.password;
  const ssl = new URL(t.url).searchParams.get("sslmode");
  if (ssl) env.PGSSLMODE = ssl;
  return env;
}

const hasTool = (bin) => {
  const r = spawnSync(bin, ["--version"], { stdio: "ignore" });
  return r.status === 0;
};

/**
 * How to run a Postgres client tool (pg_dump / pg_restore): on PATH, or inside the docker compose Postgres container
 * (local dev without client tools). `mode`: "auto" | "local" | "docker".
 */
export function pgTool(bin, target, mode = "auto") {
  const useDocker = mode === "docker" || (mode === "auto" && !hasTool(bin));
  if (!useDocker) {
    return { how: "local", command: bin, prefix: [], env: pgEnv(target), connArgs: [] };
  }
  if (!target.local) {
    throw new Error(`${bin} is not on PATH and ${target.host} is not the local docker Postgres. Install the Postgres client tools.`);
  }
  if (!hasTool("docker")) throw new Error(`${bin} is not on PATH and docker is not available`);
  // Inside the container the tool connects over the unix socket as the container's superuser role.
  return {
    how: "docker",
    command: "docker",
    prefix: ["compose", "-f", COMPOSE_FILE, "exec", "-T", COMPOSE_SERVICE, bin],
    env: process.env,
    connArgs: ["-U", target.user, "-d", target.database],
  };
}

/**
 * Starts a tool. `child.stdin` / `child.stdout` are pipes when asked for; `exited` resolves with the exit code and
 * stderr once the process is gone.
 */
export function start(tool, args, { stdin = false, stdout = false } = {}) {
  const child = spawn(tool.command, [...tool.prefix, ...args, ...tool.connArgs], {
    env: tool.env,
    stdio: [stdin ? "pipe" : "ignore", stdout ? "pipe" : "ignore", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));
  const exited = new Promise((resolvePromise, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stderr }));
  });
  return { child, exited };
}

/** Loads a dependency installed for a workspace package (the root has none of its own). */
async function workspaceImport(pkgDir, name) {
  const req = createRequire(join(ROOT, pkgDir, "package.json"));
  return import(pathToFileURL(req.resolve(name)).href);
}

/** The `postgres` (postgres.js) client from packages/db. */
export async function sqlClient(url, opts = {}) {
  const mod = await workspaceImport("packages/db", "postgres");
  const postgres = mod.default ?? mod;
  return postgres(url, { max: 2, onnotice: () => {}, ...opts });
}

/** @aws-sdk/client-s3 from packages/uploads (already a dependency of the repo). */
export async function s3Sdk() {
  return workspaceImport("packages/uploads", "@aws-sdk/client-s3");
}

/** S3 settings for backups, or null when BACKUP_S3_BUCKET is unset. */
export function backupS3Config() {
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!bucket) return null;
  let prefix = process.env.BACKUP_S3_PREFIX ?? "db/";
  if (prefix && !prefix.endsWith("/")) prefix += "/";
  return {
    bucket,
    prefix,
    region: process.env.BACKUP_S3_REGION || process.env.AWS_REGION || "ap-south-1",
    endpoint: process.env.BACKUP_S3_ENDPOINT || undefined,
  };
}

export async function s3Client(cfg) {
  const { S3Client } = await s3Sdk();
  // Credentials: the default AWS chain (env, profile, ECS task role); BACKUP_S3_ACCESS_KEY_ID/SECRET override.
  const credentials =
    process.env.BACKUP_S3_ACCESS_KEY_ID && process.env.BACKUP_S3_SECRET_ACCESS_KEY
      ? { accessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY }
      : undefined;
  return new S3Client({ region: cfg.region, endpoint: cfg.endpoint, forcePathStyle: !!cfg.endpoint, credentials });
}

export const fmtBytes = (n) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1024 ** 2).toFixed(1)} MiB`;

export const fmtMs = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

/** Identifier quoting for CREATE/DROP DATABASE. */
export const quoteIdent = (s) => `"${String(s).replace(/"/g, '""')}"`;
