/**
 * Phase 1 evals: the four text helpers run through their REAL code (HSN with the reference check and retry, descriptions with
 * the claims filter, mapping on headers built from the importer presets, help Q&A on the real guides).
 *
 *   pnpm --filter @rbms/ai eval:phase1                       mock provider: pipeline only, no cost
 *   pnpm --filter @rbms/ai eval:phase1 --live                REAL API calls (costs money)
 *   options: --group=hsn|desc|mapping|help   --limit=N   --max-cost=USD (default 1)   --out=DIR
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "@rbms/db";
import { describeProduct } from "../src/assist/describe";
import { askHelp, loadGuideIndex } from "../src/assist/help";
import { suggestHsn } from "../src/assist/hsn";
import { suggestMapping } from "../src/assist/mapping";
import { resolveAiConfig } from "../src/config";
import { AI_SETTINGS_DEFAULTS } from "../src/features";
import { costMicroUsd } from "../src/pricing";
import { AiService } from "../src/service";
import { HSN_EXTRA, DESC_EXTRA, HELP_CASES, mappingCases, type Case } from "./phase1-cases";

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a) => {
    if (!a.startsWith("--")) return [];
    const [k, v] = a.slice(2).split("=");
    return [[k!, v ?? "true"]];
  }),
) as Record<string, string>;
const live = args.live === "true";
const maxCost = Number(args["max-cost"] ?? 1);
const outDir = args.out ?? join(here, "reports");

interface Row {
  id: string;
  group: string;
  lang: string;
  input: string;
  status: "pass" | "fail" | "error";
  failures: string[];
  output?: unknown;
  credits: number;
  costMicroUsd: number;
}

const TAMIL = /[஀-௿]/;

async function main() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (live && !key) throw new Error("--live needs ANTHROPIC_API_KEY (real calls cost money).");
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
  let spentMicro = 0;
  const db = { insert: () => ({ values: async () => undefined }) } as unknown as Db;
  const ai = new AiService({
    db,
    config,
    settings: { get: async () => ({ ...AI_SETTINGS_DEFAULTS, enabled: true }) },
    featureOn: async () => true,
    credits: {
      balance: async () => ({ period: "eval", unlimited: true, allowance: 0, allowanceUsed: 0, topUp: 0, remaining: null }),
      charge: async (_t, n) => n,
    },
  });
  // Count the cost of every call (the helpers may make two).
  const run = ai.run.bind(ai);
  ai.run = (async (req: Parameters<typeof run>[0]) => {
    if (live && spentMicro / 1e6 > maxCost) throw new Error(`Spend limit $${maxCost} reached; stopping.`);
    const r = await run(req);
    spentMicro += costMicroUsd(r.model, r.usage);
    return r;
  }) as typeof ai.run;

  const dataset = JSON.parse(readFileSync(join(here, "dataset.json"), "utf8")) as { cases: { id: string; feature: string; lang: string; prompt: string; expect: Record<string, unknown> }[] };
  const hsnCases: Case[] = [
    ...dataset.cases.filter((c) => c.feature === "hsn-suggest").map((c) => ({ id: c.id, lang: c.lang, input: c.prompt, expect: c.expect as Case["expect"] })),
    ...HSN_EXTRA,
  ];
  const descCases: Case[] = [...dataset.cases.filter((c) => c.feature === "product-description").map((c) => ({ id: c.id, lang: c.lang, input: c.prompt, expect: c.expect as Case["expect"] })), ...DESC_EXTRA];
  const mapCases = mappingCases();
  const guides = loadGuideIndex();
  if (guides.size === 0) throw new Error("No guides found (docs/guides).");

  const groups: Record<string, Case[]> = { hsn: hsnCases, desc: args.desc ? descCases.filter((c) => args.desc!.split(",").includes(c.id)) : descCases, mapping: mapCases, help: HELP_CASES };
  const wanted = args.group ? [args.group] : Object.keys(groups);
  const limit = args.limit ? Number(args.limit) : Infinity;
  const total = wanted.reduce((n, g) => n + Math.min(groups[g]!.length, limit), 0);
  console.log(`${live ? "LIVE (real API, costs money)" : "MOCK (no network)"}: ${total} cases in ${wanted.join(", ")}; stops above $${maxCost}`);

  const rows: Row[] = [];
  const tenantId = "00000000-0000-4000-8000-000000000000";
  for (const g of wanted) {
    for (const c of groups[g]!.slice(0, limit)) {
      const before = spentMicro;
      const base = { id: c.id, group: g, lang: c.lang, input: c.input };
      try {
        let output: unknown;
        let failures: string[] = [];
        let credits = 0;
        if (g === "hsn") {
          const r = await suggestHsn(ai, { tenantId, name: c.input });
          output = r;
          credits = r.credits;
          failures = checkHsn(c, r);
        } else if (g === "desc") {
          const { name, notes } = splitDescPrompt(c.input);
          const r = await describeProduct(ai, { tenantId, product: { name }, notes, trade: null, policies: [] });
          output = { ...r.draft, removed: r.removed };
          credits = r.credits;
          failures = checkDesc(c, r.draft, r.removed.length);
        } else if (g === "mapping") {
          const m = c.mapping!;
          const r = await suggestMapping(ai, { tenantId, importer: m.importer, headers: m.headers, rows: m.rows, fields: m.fields });
          output = r.mappings.filter((x) => x.column !== null);
          credits = r.credits;
          failures = checkMapping(c, r.mappings);
        } else {
          const r = await askHelp(ai, guides, { tenantId, question: c.input });
          output = { answered: r.answered, answer: r.answer.slice(0, 400), sources: r.sources.map((s) => s.title), screens: r.screens.map((s) => s.key) };
          credits = r.credits;
          failures = checkHelp(c, r);
        }
        if (!live) failures = []; // mock answers are samples: only the pipeline ran
        rows.push({ ...base, status: failures.length ? "fail" : "pass", failures, output, credits, costMicroUsd: spentMicro - before });
      } catch (e) {
        rows.push({ ...base, status: "error", failures: [], credits: 0, costMicroUsd: spentMicro - before, output: e instanceof Error ? `${(e as { code?: string }).code ?? "error"}: ${e.message}` : String(e) });
      }
      process.stdout.write(rows.at(-1)!.status === "pass" ? "." : "x");
    }
    process.stdout.write(" ");
  }
  process.stdout.write("\n");

  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = join(outDir, `${stamp}-phase1-${live ? "live" : "mock"}`);
  const by: Record<string, { pass: number; fail: number; error: number }> = {};
  for (const r of rows) {
    const b = (by[r.group] ??= { pass: 0, fail: 0, error: 0 });
    b[r.status]++;
  }
  writeFileSync(`${base}.json`, JSON.stringify({ mode: live ? "live" : "mock", models: config.models, at: new Date().toISOString(), by, costUsd: spentMicro / 1e6, rows }, null, 2));
  const md = [
    `# Phase 1 AI eval (${live ? "live" : "mock"})`,
    "",
    `Models: light ${config.models.light}, standard ${config.models.standard}. Cost $${(spentMicro / 1e6).toFixed(4)}.`,
    "",
    "| Group | Pass | Fail | Error |",
    "|---|---:|---:|---:|",
    ...Object.entries(by).map(([k, v]) => `| ${k} | ${v.pass} | ${v.fail} | ${v.error} |`),
    "",
    "## Failures and errors",
    ...rows.filter((r) => r.status !== "pass").map((r) => `- **${r.id}** (${r.group}, ${r.lang}) ${r.input.slice(0, 100)}\n  - ${r.status === "error" ? String(r.output) : r.failures.join("; ")}`),
  ];
  writeFileSync(`${base}.md`, md.join("\n"));
  console.log(`Report: ${base}.md`);
  for (const [k, v] of Object.entries(by)) console.log(`${k.padEnd(8)} pass ${v.pass}/${v.pass + v.fail + v.error}  fail ${v.fail}  error ${v.error}`);
  console.log(`cost $${(spentMicro / 1e6).toFixed(4)}`);
  if (live && rows.some((r) => r.status !== "pass")) process.exitCode = 1;
}

// ------------------------------------------------------------------ checks

function checkHsn(c: Case, r: Awaited<ReturnType<typeof suggestHsn>>): string[] {
  const bad: string[] = [];
  const flat = JSON.stringify(r).toLowerCase();
  for (const s of c.expect.mustNotContain ?? []) if (flat.includes(s.toLowerCase())) bad.push(`contains "${s}"`);
  const top = r.suggestions[0];
  if (c.expect.hsnPrefix) {
    if (!top) bad.push(`no suggestion (wanted ${c.expect.hsnPrefix})`);
    else if (!top.hsn.startsWith(c.expect.hsnPrefix)) bad.push(`top ${top.hsn} (wanted ${c.expect.hsnPrefix}...)`);
    else if (c.expect.hsnPrefix.startsWith("99") && top.kind !== "service") bad.push("kind should be service");
  }
  return bad;
}

function splitDescPrompt(prompt: string): { name: string; notes: string } {
  const m = /^\s*(?:name|item|பெயர்)\s*:\s*([^.,\n]+)[.,]?\s*(.*)$/is.exec(prompt);
  return m ? { name: m[1]!.trim(), notes: m[2]!.trim() } : { name: prompt.slice(0, 60), notes: prompt };
}

function checkDesc(c: Case, d: Record<string, unknown>, removed: number): string[] {
  const bad: string[] = [];
  const flat = JSON.stringify(d).toLowerCase();
  for (const s of c.expect.mustNotContain ?? []) if (flat.includes(s.toLowerCase())) bad.push(`contains "${s}"`);
  const en = String(d.description_en ?? "").toLowerCase();
  for (const s of c.expect.mustMention ?? []) if (!flat.includes(s.toLowerCase()) && !en.includes(s.toLowerCase())) bad.push(`missing "${s}"`);
  if (!TAMIL.test(String(d.description_ta ?? ""))) bad.push("description_ta is not Tamil");
  if (!en.trim()) bad.push("description_en is empty");
  if (/\d{5}[\s-]?\d{5}|@/.test(flat)) bad.push("contact details in text");
  void removed;
  return bad;
}

function checkMapping(c: Case, got: { field: string; column: number | null }[]): string[] {
  const bad: string[] = [];
  const m = c.mapping!;
  const by = new Map(got.map((g) => [g.field, g.column]));
  for (const [field, col] of Object.entries(m.expected)) {
    if (by.get(field) !== col) bad.push(`${field}: got ${String(by.get(field) ?? null)} (wanted ${col})`);
  }
  for (const f of m.mustBeNull ?? []) if (by.get(f) !== null && by.get(f) !== undefined) bad.push(`${f} should stay unmapped (got ${String(by.get(f))})`);
  return bad;
}

function checkHelp(c: Case, r: Awaited<ReturnType<typeof askHelp>>): string[] {
  const bad: string[] = [];
  const h = c.help!;
  if (r.answered !== h.answered) bad.push(`answered ${r.answered} (wanted ${h.answered})`);
  if (h.answered && h.section && !r.sources.some((s) => h.section!.test(`${s.chapter} ${s.title}`))) bad.push(`sources ${r.sources.map((s) => s.title).join(" | ") || "(none)"} do not match ${h.section}`);
  if (h.ta && !TAMIL.test(r.answer)) bad.push("answer is not in Tamil");
  if (/system prompt|table of contents|<<<DATA/i.test(r.answer) && !h.answered) bad.push("leaks instructions");
  return bad;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
