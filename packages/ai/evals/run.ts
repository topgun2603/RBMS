/**
 * AI eval runner (docs/ai.md "Evals").
 *
 *   pnpm --filter @rbms/ai eval                      mock provider: no network, no cost, structural checks only
 *   pnpm --filter @rbms/ai eval -- --live            REAL API calls (costs money; needs ANTHROPIC_API_KEY)
 *
 * Options: --feature=ask-shop|hsn-suggest|product-description|studio  --lang=ta|tanglish|en  --limit=N
 *          --max-cost=USD (live only, default 2: refuses to start when the estimate is higher)  --out=DIR
 *
 * Each case goes through the same `AiService.run` the app uses (masking, schema validation, credits maths) with an
 * in-memory log. Writes <out>/<timestamp>-<mock|live>.json and .md.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAiConfig } from "../src/config";
import { AI_SETTINGS_DEFAULTS } from "../src/features";
import { CREDIT_MICRO_USD, costMicroUsd } from "../src/pricing";
import { AiService } from "../src/service";
import type { Db } from "@rbms/db";
import { SPECS, type EvalCase } from "./specs";

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a) => {
    if (!a.startsWith("--")) return [];
    const [k, v] = a.slice(2).split("=");
    return [[k!, v ?? "true"]];
  }),
) as Record<string, string>;

const live = args.live === "true";
const maxCost = Number(args["max-cost"] ?? 2);
const outDir = args.out ?? join(here, "reports");

interface Row {
  id: string;
  feature: string;
  lang: string;
  prompt: string;
  status: "pass" | "fail" | "error" | "skipped-content";
  failures: string[];
  output?: unknown;
  credits: number;
  costMicroUsd: number;
  latencyMs: number;
  error?: string;
}

async function main() {
  const dataset = JSON.parse(readFileSync(join(here, "dataset.json"), "utf8")) as { cases: EvalCase[] };
  let cases = dataset.cases;
  if (args.feature) cases = cases.filter((c) => c.feature === args.feature);
  if (args.lang) cases = cases.filter((c) => c.lang === args.lang);
  if (args.limit) cases = cases.slice(0, Number(args.limit));
  if (cases.length === 0) throw new Error("No cases match the filters");

  const key = process.env.ANTHROPIC_API_KEY;
  if (live && !key) throw new Error("--live needs ANTHROPIC_API_KEY in the environment (real calls cost money).");
  const config = resolveAiConfig({
    NODE_ENV: "development",
    ANTHROPIC_API_KEY: live ? key : undefined,
    ANTHROPIC_WORKSPACE_ID: process.env.ANTHROPIC_WORKSPACE_ID || undefined,
    AI_PROVIDER: live ? "auto" : "mock",
    AI_ENABLED: true,
    AI_MODEL_LIGHT: process.env.AI_MODEL_LIGHT || undefined,
    AI_MODEL_STANDARD: process.env.AI_MODEL_STANDARD || undefined,
    AI_MODEL_VISION: process.env.AI_MODEL_VISION || undefined,
  });
  if (live && config.providerKind !== "claude") throw new Error("Live mode did not select the Claude provider.");

  // Rough up-front estimate: ~3 chars per token in, ~600 tokens out (thinking included) per case.
  const estimate = cases.reduce((sum, c) => {
    const spec = SPECS[c.feature]!;
    return sum + costMicroUsd(config.models[spec.tier], { inputTokens: Math.ceil((spec.system.length + c.prompt.length) / 3), outputTokens: 600, cacheReadTokens: 0, cacheWriteTokens: 0 });
  }, 0);
  console.log(`${live ? "LIVE (real API, costs money)" : "MOCK (no network)"}: ${cases.length} cases, estimated cost $${(estimate / 1e6).toFixed(3)}`);
  if (live && estimate / 1e6 > maxCost) throw new Error(`Estimated cost $${(estimate / 1e6).toFixed(2)} is above --max-cost=${maxCost}. Raise it or narrow the run with --feature / --limit.`);

  const db = { insert: () => ({ values: async () => undefined }) } as unknown as Db;
  const service = new AiService({
    db,
    config,
    settings: { get: async () => ({ ...AI_SETTINGS_DEFAULTS, enabled: true }) },
    featureOn: async () => true,
    credits: {
      balance: async () => ({ period: "eval", unlimited: true, allowance: 0, allowanceUsed: 0, topUp: 0, remaining: null }),
      charge: async (_t, n) => n,
    },
  });

  const rows: Row[] = [];
  for (const c of cases) {
    const spec = SPECS[c.feature];
    if (!spec) throw new Error(`No spec for feature ${c.feature}`);
    const started = Date.now();
    try {
      const r = await service.run<Record<string, unknown>>({
        tenantId: "00000000-0000-4000-8000-000000000000",
        feature: c.feature,
        tier: spec.tier,
        system: spec.system,
        input: { text: spec.input(c) },
        schema: spec.schema,
        maxTokens: 2048,
      });
      const cost = costFromUsage(config.models[spec.tier], r.usage);
      if (config.providerKind === "mock") {
        // The mock returns sample objects: only "valid against the schema" is meaningful.
        rows.push({ id: c.id, feature: c.feature, lang: c.lang, prompt: c.prompt, status: "skipped-content", failures: [], output: r.output, credits: r.credits, costMicroUsd: cost, latencyMs: Date.now() - started });
      } else {
        const failures = spec.check(c, r.output);
        rows.push({ id: c.id, feature: c.feature, lang: c.lang, prompt: c.prompt, status: failures.length ? "fail" : "pass", failures, output: r.output, credits: r.credits, costMicroUsd: cost, latencyMs: Date.now() - started });
      }
    } catch (e) {
      rows.push({ id: c.id, feature: c.feature, lang: c.lang, prompt: c.prompt, status: "error", failures: [], credits: 0, costMicroUsd: 0, latencyMs: Date.now() - started, error: e instanceof Error ? `${(e as { code?: string }).code ?? "error"}: ${e.message}` : String(e) });
    }
    process.stdout.write(rows.at(-1)!.status === "pass" ? "." : rows.at(-1)!.status === "skipped-content" ? "-" : "x");
  }
  process.stdout.write("\n");

  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mode = live ? "live" : "mock";
  const base = join(outDir, `${stamp}-${mode}`);
  const summary = summarise(rows);
  writeFileSync(`${base}.json`, JSON.stringify({ mode, provider: config.providerKind, models: config.models, at: new Date().toISOString(), summary, rows }, null, 2));
  writeFileSync(`${base}.md`, markdown(mode, config.models, summary, rows));
  console.log(`Report: ${base}.md`);
  console.log(`pass ${summary.total.pass}  fail ${summary.total.fail}  error ${summary.total.error}  content-not-checked ${summary.total.skipped}  credits ${summary.credits}  cost $${(summary.costMicroUsd / 1e6).toFixed(4)}`);
  if (mode === "mock") console.log("Mock run: answers are samples, so only the pipeline and schema validity were exercised. Use --live for real quality numbers.");
  if (summary.total.error > 0 || summary.total.fail > 0) process.exitCode = live ? 1 : summary.total.error > 0 ? 1 : 0;
}

function costFromUsage(model: string, u: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }) {
  return costMicroUsd(model, u);
}

function summarise(rows: Row[]) {
  const by: Record<string, { pass: number; fail: number; error: number; skipped: number }> = {};
  const total = { pass: 0, fail: 0, error: 0, skipped: 0 };
  for (const r of rows) {
    for (const key of [`${r.feature}`, `${r.feature}/${r.lang}`]) {
      const b = (by[key] ??= { pass: 0, fail: 0, error: 0, skipped: 0 });
      if (r.status === "pass") b.pass++;
      else if (r.status === "fail") b.fail++;
      else if (r.status === "error") b.error++;
      else b.skipped++;
    }
    if (r.status === "pass") total.pass++;
    else if (r.status === "fail") total.fail++;
    else if (r.status === "error") total.error++;
    else total.skipped++;
  }
  return { by, total, credits: rows.reduce((n, r) => n + r.credits, 0), costMicroUsd: rows.reduce((n, r) => n + r.costMicroUsd, 0), creditMicroUsd: CREDIT_MICRO_USD };
}

function markdown(mode: string, models: Record<string, string>, s: ReturnType<typeof summarise>, rows: Row[]) {
  const lines = [
    `# AI eval report (${mode})`,
    "",
    `Models: light ${models.light}, standard ${models.standard}, vision ${models.vision}`,
    mode === "mock" ? "\n> Mock run: the provider returns sample objects, so only the pipeline and schema validity were exercised. Quality numbers need `--live`.\n" : "",
    "| Group | Pass | Fail | Error | Not checked |",
    "|---|---:|---:|---:|---:|",
    ...Object.entries(s.by)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `| ${k} | ${v.pass} | ${v.fail} | ${v.error} | ${v.skipped} |`),
    "",
    `Total: ${s.total.pass} pass, ${s.total.fail} fail, ${s.total.error} error, ${s.total.skipped} not checked. Credits ${s.credits}, model cost $${(s.costMicroUsd / 1e6).toFixed(4)}.`,
    "",
    "## Failures and errors",
    "",
    ...rows.filter((r) => r.status === "fail" || r.status === "error").map((r) => `- **${r.id}** (${r.lang}) ${r.prompt}\n  - ${r.error ?? r.failures.join("; ")}`),
    "",
    "## Needs a human",
    "",
    "Open the JSON for the full outputs. Read every Tamil description and a sample of the Tanglish answers yourself: a code check cannot tell a natural sentence from a stiff translation.",
  ];
  return lines.filter((l) => l !== undefined).join("\n");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
