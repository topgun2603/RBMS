// Seeds the dedicated e2e shops, then runs every end-to-end script in sequence against the running API.
//   pnpm --filter @srirealtime/api test:e2e:all
// Needs the API in development with the test OTP on (apps/api/.env: TEST_OTP_CODE, TEST_OTP_TARGETS); see
// docs/features.md "End-to-end shops". Then the storefront browser test (apps/store test:e2e) when the api and store
// dev servers are up (skipped with a message otherwise). Exit code 1 when the seed or any script fails.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, "..", "..");
const SCRIPTS = ["batch1.mjs", "batch2.mjs", "billing.mjs"];

const seed = spawnSync("pnpm run seed:e2e", { cwd: apiDir, shell: true, encoding: "utf8" });
if (seed.status !== 0) {
  console.error(`seed:e2e failed (exit ${seed.status})\n${(seed.stderr || seed.stdout || "").slice(-2000)}`);
  process.exit(1);
}
console.log("seed:e2e ok\n");

const totals = [];
for (const script of SCRIPTS) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [join(here, script)], { cwd: apiDir, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
  process.stdout.write(`===== ${script}\n${r.stdout}`);
  const m = /(\d+)\/(\d+) passed/.exec(r.stdout ?? "");
  totals.push({ script, passed: m ? Number(m[1]) : 0, total: m ? Number(m[2]) : 0, ok: r.status === 0, seconds: (Date.now() - started) / 1000 });
}

// The storefront browser test (apps/store/test/e2e.cjs) also needs the store app on :3003; it exits 2 when the api or
// store server isn't up, which is reported as skipped rather than failed.
{
  const started = Date.now();
  const storeDir = join(apiDir, "..", "store");
  const r = spawnSync(process.execPath, [join(storeDir, "test", "e2e.cjs")], { cwd: storeDir, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
  process.stdout.write(`===== store test/e2e.cjs (browser)\n${r.stdout}`);
  const m = /(\d+)\/(\d+) passed/.exec(r.stdout ?? "");
  totals.push({
    script: "store e2e",
    passed: m ? Number(m[1]) : 0,
    total: m ? Number(m[2]) : 0,
    ok: r.status === 0 || r.status === 2,
    skipped: r.status === 2,
    seconds: (Date.now() - started) / 1000,
  });
}

console.log("\n===== summary");
for (const t of totals) {
  if (t.skipped) console.log(`SKIP  ${t.script.padEnd(12)} (api or store dev server not running; start them with pnpm dev)`);
  else console.log(`${t.ok ? "PASS" : "FAIL"}  ${t.script.padEnd(12)} ${t.passed}/${t.total}  (${t.seconds.toFixed(1)} s)`);
}
const passed = totals.reduce((s, t) => s + t.passed, 0);
const total = totals.reduce((s, t) => s + t.total, 0);
console.log(`${passed}/${total} steps passed`);
process.exitCode = totals.every((t) => t.ok) ? 0 : 1;
