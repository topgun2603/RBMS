// Runs every package's tests one at a time with coverage on, database tests included (against the QA database), and
// writes out/coverage.json: per package, tests passed / failed / skipped and the share of code they ran.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, QA_DB, ROOT, qaEnv } from "./lib.mjs";

const DB_VARS = ["ACCOUNTING", "AI", "API", "AUTH", "BRANCHES", "CATALOGUE", "EXPENSES", "GSTFILING", "IDEMPOTENCY", "INVENTORY", "INVOICES", "JOBCARDS", "LOYALTY", "ORDERS", "PAYROLL", "PLANS", "PLATFORM", "POS", "PRICELISTS", "SUBSCRIPTIONS", "UPLOADS"];
const dbUrl = `postgres://srikit:srikit@127.0.0.1:5432/${QA_DB}`;
const env = { ...qaEnv(), ...Object.fromEntries(DB_VARS.map((v) => [`${v}_TEST_DATABASE_URL`, dbUrl])) };

const hasTests = (dir) => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).some((e) => (e.isDirectory() ? e.name !== "node_modules" && walk(join(d, e.name)) : /\.test\.tsx?$/.test(e.name)));
  return existsSync(join(dir, "src")) && walk(join(dir, "src"));
};
const dirs = [
  ...readdirSync(join(ROOT, "packages")).map((n) => ["packages", n]),
  ...readdirSync(join(ROOT, "apps")).map((n) => ["apps", n]),
];
const results = [];
const untested = [];
for (const [group, name] of dirs) {
  const dir = join(ROOT, group, name);
  if (!existsSync(join(dir, "package.json")) || !existsSync(join(dir, "src"))) continue;
  if (!hasTests(dir)) {
    untested.push(`${group}/${name}`);
    continue;
  }
  const covDir = join(OUT, "cov", name);
  const jsonOut = join(OUT, "cov", `${name}.tests.json`);
  rmSync(covDir, { recursive: true, force: true });
  const started = Date.now();
  spawnSync(`npx vitest run --reporter=json --outputFile=${JSON.stringify(jsonOut)} --coverage --coverage.reporter=json-summary --coverage.reportOnFailure --coverage.include="src/**/*.{ts,tsx}" --coverage.exclude="**/*.test.*" --coverage.reportsDirectory=${JSON.stringify(covDir)}`, { cwd: dir, env, shell: true, stdio: "ignore", timeout: 15 * 60_000 });
  const row = { name: `${group}/${name}`, seconds: Math.round((Date.now() - started) / 1000), passed: 0, failed: 0, skipped: 0, lines: null, branches: null, functions: null, failures: [] };
  if (existsSync(jsonOut)) {
    const t = JSON.parse(readFileSync(jsonOut, "utf8"));
    row.passed = t.numPassedTests;
    row.failed = t.numFailedTests;
    row.skipped = t.numPendingTests + (t.numTodoTests ?? 0);
    for (const f of t.testResults ?? []) for (const a of f.assertionResults ?? []) if (a.status === "failed") row.failures.push(`${a.fullName}: ${(a.failureMessages?.[0] ?? "").split("\n")[0].slice(0, 160)}`);
  }
  const summary = join(covDir, "coverage-summary.json");
  if (existsSync(summary)) {
    const c = JSON.parse(readFileSync(summary, "utf8")).total;
    row.lines = c.lines.pct;
    row.branches = c.branches.pct;
    row.functions = c.functions.pct;
    row.linesTotal = c.lines.total;
    row.linesCovered = c.lines.covered;
  }
  results.push(row);
  console.log(`${row.name}: ${row.passed} passed, ${row.failed} failed, ${row.skipped} skipped, lines ${row.lines}% (${row.seconds} s)`);
  writeFileSync(join(OUT, "coverage.json"), JSON.stringify({ results, untested }, null, 1));
}
const sum = (k) => results.reduce((s, r) => s + (r[k] ?? 0), 0);
console.log(`\nTOTAL ${sum("passed")} passed, ${sum("failed")} failed, ${sum("skipped")} skipped; lines ${((sum("linesCovered") / sum("linesTotal")) * 100).toFixed(1)}%; ${untested.length} packages with no tests`);
process.exit(0);
