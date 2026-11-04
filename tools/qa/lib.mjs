// Shared by the QA scripts: the throwaway stack they all run against. See tools/qa/README.md.
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const OUT = join(ROOT, "tools", "qa", "out");
mkdirSync(OUT, { recursive: true });

export const QA_DB = "rbms_qa";
export const API_PORT = 4010;
export const API = `http://127.0.0.1:${API_PORT}`;
export const OWNER = "e2e-owner@example.com";
export const OTP = "123456";
export const TENANT = "e2e-bill";
const DB_URL = `postgres://srikit:srikit@127.0.0.1:5432/${QA_DB}`;

/** Env for anything touching the QA stack. Real DB, Redis and every outside provider are overridden, so nothing leaves this copy. */
export const qaEnv = () => {
  if (!DB_URL.endsWith("_qa")) throw new Error("Refusing to run: the QA database name must end in _qa");
  return {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_URL: DB_URL,
    REDIS_URL: "memory",
    CORS_ORIGINS: "http://*.localhost:3101,http://*.localhost:3103",
    PORT: String(API_PORT),
    LOG_LEVEL: "warn",
    RATE_LIMIT_ENABLED: "false",
    TEST_OTP_CODE: OTP,
    TEST_OTP_TARGETS: "+9199990*,e2e-*@example.com",
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_DIR: join(OUT, "uploads"),
    SENTRY_DSN: "",
    ANTHROPIC_API_KEY: "",
    AI_PROVIDER: "mock",
    MSG91_AUTH_KEY: "",
    RESEND_API_KEY: "",
    WHATSAPP_TOKEN: "",
    FCM_SERVICE_ACCOUNT_JSON: "",
    PLATFORM_RAZORPAY_KEY_ID: "",
    PLATFORM_RAZORPAY_KEY_SECRET: "",
    PLATFORM_RAZORPAY_WEBHOOK_SECRET: "",
    EINVOICE_GSP_BASE_URL: "",
    EINVOICE_GSP_SANDBOX_URL: "",
    BACKUP_S3_BUCKET: "",
  };
};

const psql = (db, sql) => execSync(`docker exec srikit-postgres-1 psql -U srikit -d ${db} -tAc "${sql}"`, { encoding: "utf8" }).trim();
export const shopCount = (db) => Number(psql(db, "select count(*) from tenants"));

/** Creates the QA database if needed, migrates and seeds it. Never touches the real one. */
export function setup() {
  if (psql("postgres", `select 1 from pg_database where datname='${QA_DB}'`) !== "1") {
    psql("postgres", `create database ${QA_DB}`);
    console.log(`created database ${QA_DB}`);
  }
  const run = (cmd) => execSync(cmd, { cwd: ROOT, env: qaEnv(), stdio: ["ignore", "ignore", "inherit"], shell: true });
  run("pnpm --filter @rbms/api db:migrate");
  execSync(`docker exec -i srikit-postgres-1 psql -q -U srikit -d ${QA_DB}`, { input: readFileSync(join(ROOT, "apps/api/test/e2e/fixtures/pincode-cache.sql")), stdio: ["pipe", "ignore", "ignore"] });
  run("pnpm --filter @rbms/api seed");
  run("pnpm --filter @rbms/api seed:e2e");
  console.log(`seeded: QA has ${shopCount(QA_DB)} shops; your real database still has ${shopCount("srikit")}`);
}

let child = null;
export const apiUp = async () => {
  try {
    return (await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
};

/** Starts the QA API if it isn't up. Its errors go to out/api.log, which the report reads for root causes. */
export async function startApi() {
  if (await apiUp()) return;
  // A file, not a pipe: the API must outlive any script that started it.
  const log = openSync(join(OUT, "api.log"), "a");
  child = spawn("pnpm --filter @rbms/api start", { cwd: ROOT, env: qaEnv(), shell: true, stdio: ["ignore", log, log] });
  for (let i = 0; i < 180; i++) {
    if (await apiUp()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("QA API did not start: see tools/qa/out/api.log");
}

export function stopApi() {
  if (child?.pid) {
    try {
      execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: "ignore" });
    } catch {
      child.kill();
    }
  }
}

export async function ownerToken() {
  const post = (path, body) => fetch(`${API}/v1${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await post("/auth/otp/request", { target: OWNER });
  const res = await post("/auth/otp/verify", { target: OWNER, code: OTP });
  const json = await res.json();
  if (!json.token) throw new Error(`owner sign-in failed: ${JSON.stringify(json).slice(0, 200)}`);
  return json.token;
}

export const readJsonl = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
