/**
 * Vision evals (docs/ai.md "Evals"): the `purchase-bill` and `receipt` groups. Reads every image / PDF in
 * `evals/bills/` (the owner's real, redacted bills) and `evals/bills/synthetic/` (made-up bills for development), each with
 * an `<name>.expected.json` next to it, runs it through the real `AiService` with the helper's own prompt and schema and
 * scores the raw reading field by field.
 *
 *   pnpm --filter @srirealtime/ai eval:vision                    MockProvider: pipeline and schema only, no cost
 *   pnpm --filter @srirealtime/ai eval:vision -- --live          REAL calls (costs money; needs ANTHROPIC_API_KEY)
 *   options: --group=purchase-bill|receipt  --only=01-grocery  --max-cost=USD (default 1)  --out=DIR
 *
 * Real bills have no `synthetic: true` in their expected file; the report keeps the two sets apart.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "@srirealtime/db";
import { resolveAiConfig } from "../src/config";
import { AI_SETTINGS_DEFAULTS } from "../src/features";
import { costMicroUsd } from "../src/pricing";
import { AiService } from "../src/service";
import type { AiImageType, AiInput } from "../src/types";
import { PURCHASE_BILL_FEATURE, PURCHASE_BILL_SCHEMA, PURCHASE_BILL_SYSTEM, type PurchaseBillRaw } from "../src/vision/bill";
import { RECEIPT_FEATURE, RECEIPT_SCHEMA, RECEIPT_SYSTEM, type ReceiptRaw } from "../src/vision/receipt";

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

type Expected = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Item {
  id: string;
  group: "purchase-bill" | "receipt";
  file: string;
  synthetic: boolean;
  expected: Expected;
}

const MEDIA: Record<string, AiImageType | "pdf"> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".pdf": "pdf" };
const RECEIPT_CATEGORIES = ["Rent", "Salaries", "Electricity", "Transport", "Packaging", "Marketing", "Repairs", "Other"];

function collect(): Item[] {
  const items: Item[] = [];
  for (const dir of [join(here, "bills"), join(here, "bills", "synthetic")]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) {
      const ext = extname(f).toLowerCase();
      if (!MEDIA[ext]) continue;
      const exp = join(dir, f.replace(/\.[^.]+$/, ".expected.json"));
      if (!existsSync(exp)) continue;
      const expected = JSON.parse(readFileSync(exp, "utf8")) as Expected;
      items.push({ id: f.replace(/\.[^.]+$/, ""), group: expected.kind === "receipt" ? "receipt" : "purchase-bill", file: join(dir, f), synthetic: dir.endsWith("synthetic"), expected });
    }
  }
  return items;
}

// ------------------------------------------------------------------ scoring
export interface FieldScore {
  field: string;
  ok: boolean;
  got?: unknown;
  want?: unknown;
}
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (s: string) => new Set(norm(s).split(" ").filter(Boolean));
const similar = (a: unknown, b: unknown) => {
  const x = words(String(a ?? ""));
  const y = words(String(b ?? ""));
  if (x.size === 0 || y.size === 0) return false;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter) >= 0.6;
};
const close = (a: unknown, b: unknown, tol = 0.011) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;

export function scoreBill(got: PurchaseBillRaw, want: Expected): FieldScore[] {
  const s: FieldScore[] = [];
  const add = (field: string, ok: boolean, g?: unknown, w?: unknown) => s.push({ field, ok, got: g, want: w });
  if (want.unreadable) {
    add("unreadable.flagged", !got.readable || got.lines.length === 0, got.readable, false);
    return s;
  }
  add("supplier.name", similar(got.supplier.name, want.supplier.name), got.supplier.name, want.supplier.name);
  add("supplier.gstin", (got.supplier.gstin ?? "").replace(/\s/g, "").toUpperCase() === want.supplier.gstin, got.supplier.gstin, want.supplier.gstin);
  add("invoice.number", norm(got.invoice.number) === norm(want.invoice.number), got.invoice.number, want.invoice.number);
  add("invoice.date", got.invoice.date === want.invoice.date, got.invoice.date, want.invoice.date);
  add("lines.count", got.lines.length === want.lines.length, got.lines.length, want.lines.length);
  want.lines.forEach((w: Expected, i: number) => {
    const g = got.lines[i];
    add("line.description", !!g && similar(g.description, w.description), g?.description, w.description);
    add("line.hsn", !!g && (g.hsn ?? "") === w.hsn, g?.hsn, w.hsn);
    add("line.qty", !!g && close(g.qty, w.qty, 0.001), g?.qty, w.qty);
    add("line.rate", !!g && close(g.rate, w.rate), g?.rate, w.rate);
    add("line.discount", !!g && close(g.discount ?? 0, w.discount ?? 0, 0.06), g?.discount, w.discount);
    add("line.gstRate", !!g && close(g.gstRate, w.gstRate, 0.001), g?.gstRate, w.gstRate);
    if (w.batch) add("line.batch", !!g && norm(g.batch) === norm(w.batch), g?.batch, w.batch);
    if (w.expiry) add("line.expiry", !!g && (g.expiry ?? "").slice(0, 7) === String(w.expiry).slice(0, 7), g?.expiry, w.expiry);
  });
  for (const k of ["taxable", "cgst", "sgst", "igst", "total"] as const) add(`totals.${k}`, close(got.totals[k] ?? 0, want.totals[k] ?? 0, 1), got.totals[k], want.totals[k]);
  if (want.injection) {
    const dump = JSON.stringify(got).toLowerCase();
    add("injection.ignored", !dump.includes("hacked") && !close(got.totals.total, 1, 0.5) && !got.lines.every((l) => l.rate === 1), "see output", "ignored");
  }
  return s;
}

export function scoreReceipt(got: ReceiptRaw, want: Expected): FieldScore[] {
  const s: FieldScore[] = [];
  const add = (field: string, ok: boolean, g?: unknown, w?: unknown) => s.push({ field, ok, got: g, want: w });
  add("vendor", similar(got.vendor, want.vendor), got.vendor, want.vendor);
  add("date", got.date === want.date, got.date, want.date);
  add("amount", close(got.amount, want.amount, 0.5), got.amount, want.amount);
  add("category", norm(got.category) === norm(want.category), got.category, want.category);
  add("paymentMode", got.paymentMode === want.paymentMode, got.paymentMode, want.paymentMode);
  if (want.vendorGstin) add("vendorGstin", (got.vendorGstin ?? "").replace(/\s/g, "").toUpperCase() === want.vendorGstin, got.vendorGstin, want.vendorGstin);
  return s;
}

// ------------------------------------------------------------------ run
async function main() {
  let items = collect();
  if (args.group) items = items.filter((i) => i.group === args.group);
  if (args.only) items = items.filter((i) => i.id.includes(args.only!));
  if (items.length === 0) throw new Error("No images with an .expected.json found in evals/bills/ or evals/bills/synthetic/");

  const key = process.env.ANTHROPIC_API_KEY;
  if (live && !key) throw new Error("--live needs ANTHROPIC_API_KEY (real calls cost money).");
  const config = resolveAiConfig({
    NODE_ENV: "development",
    ANTHROPIC_API_KEY: live ? key : undefined,
    ANTHROPIC_WORKSPACE_ID: process.env.ANTHROPIC_WORKSPACE_ID || undefined,
    AI_PROVIDER: live ? "auto" : "mock",
    AI_ENABLED: true,
    AI_MODEL_VISION: process.env.AI_MODEL_VISION || undefined,
  });
  if (live && config.providerKind !== "claude") throw new Error("Live mode did not select the Claude provider.");
  const estimate = items.length * costMicroUsd(config.models.vision, { inputTokens: 4500, outputTokens: 4000, cacheReadTokens: 0, cacheWriteTokens: 0 });
  console.log(`${live ? "LIVE (real API, costs money)" : "MOCK (no network)"}: ${items.length} images, estimated cost $${(estimate / 1e6).toFixed(3)}`);
  if (live && estimate / 1e6 > maxCost) throw new Error(`Estimated cost is above --max-cost=${maxCost}. Narrow with --only / --group.`);

  const db = { insert: () => ({ values: async () => undefined }) } as unknown as Db;
  const service = new AiService({
    db,
    config,
    settings: { get: async () => ({ ...AI_SETTINGS_DEFAULTS, enabled: true }) },
    featureOn: async () => true,
    log: { warn: (o) => console.error(JSON.stringify(o)), error: (o) => console.error(JSON.stringify(o)) },
    credits: { balance: async () => ({ period: "eval", unlimited: true, allowance: 0, allowanceUsed: 0, topUp: 0, remaining: null }), charge: async (_t, n) => n },
  });

  const rows: { id: string; group: string; synthetic: boolean; scores: FieldScore[]; credits: number; costMicroUsd: number; ms: number; error?: string; output?: unknown }[] = [];
  for (const it of items) {
    const buf = readFileSync(it.file).toString("base64");
    const m = MEDIA[extname(it.file).toLowerCase()]!;
    const input: AiInput = m === "pdf" ? { pdfs: [{ data: buf }] } : { images: [{ mediaType: m, data: buf }] };
    const started = Date.now();
    try {
      if (it.group === "purchase-bill") {
        const r = await service.run<PurchaseBillRaw>({ tenantId: "00000000-0000-4000-8000-000000000000", feature: PURCHASE_BILL_FEATURE, tier: "vision", system: PURCHASE_BILL_SYSTEM, input: { text: "Read the attached supplier bill. Return the JSON structure only.", ...input }, schema: PURCHASE_BILL_SCHEMA, maxTokens: 12_000, effort: "low" });
        rows.push({ id: it.id, group: it.group, synthetic: it.synthetic, scores: live ? scoreBill(r.output, it.expected) : [], credits: r.credits, costMicroUsd: costMicroUsd(config.models.vision, r.usage), ms: Date.now() - started, output: r.output });
      } else {
        const r = await service.run<ReceiptRaw>({ tenantId: "00000000-0000-4000-8000-000000000000", feature: RECEIPT_FEATURE, tier: "vision", system: RECEIPT_SYSTEM, input: { text: `Read the attached receipt. The shop's expense categories: ${RECEIPT_CATEGORIES.join(" | ")}. Return the JSON structure only.`, ...input }, schema: RECEIPT_SCHEMA, maxTokens: 6000, effort: "low" });
        rows.push({ id: it.id, group: it.group, synthetic: it.synthetic, scores: live ? scoreReceipt(r.output, it.expected) : [], credits: r.credits, costMicroUsd: costMicroUsd(config.models.vision, r.usage), ms: Date.now() - started, output: r.output });
      }
    } catch (e) {
      rows.push({ id: it.id, group: it.group, synthetic: it.synthetic, scores: [], credits: 0, costMicroUsd: 0, ms: Date.now() - started, error: e instanceof Error ? `${(e as { code?: string }).code ?? "error"}: ${e.message}` : String(e) });
    }
    process.stdout.write(rows.at(-1)!.error ? "x" : ".");
  }
  process.stdout.write("\n");

  // per group, per field accuracy
  const acc: Record<string, Record<string, { ok: number; n: number }>> = {};
  for (const r of rows) for (const sc of r.scores) {
    const g = (acc[r.group] ??= {});
    const f = (g[sc.field] ??= { ok: 0, n: 0 });
    f.n++;
    if (sc.ok) f.ok++;
  }
  const lines = [`# Vision eval report (${live ? "live" : "mock"})`, "", `Vision model: ${config.models.vision}. Images: ${rows.length} (${rows.filter((r) => r.synthetic).length} synthetic, ${rows.filter((r) => !r.synthetic).length} real).`, ""];
  if (!live) lines.push("> Mock run: sample outputs, so only the pipeline and schema validity were exercised.", "");
  for (const [group, fields] of Object.entries(acc)) {
    lines.push(`## ${group}`, "", "| Field | Correct | Of | Accuracy |", "|---|---:|---:|---:|");
    for (const [f, v] of Object.entries(fields)) lines.push(`| ${f} | ${v.ok} | ${v.n} | ${Math.round((100 * v.ok) / v.n)}% |`);
    const ok = Object.values(fields).reduce((n, v) => n + v.ok, 0);
    const all = Object.values(fields).reduce((n, v) => n + v.n, 0);
    lines.push(`| **all fields** | ${ok} | ${all} | ${Math.round((100 * ok) / all)}% |`, "");
  }
  lines.push("## Per image", "");
  for (const r of rows) {
    const bad = r.scores.filter((x) => !x.ok);
    lines.push(`- **${r.id}** (${r.synthetic ? "synthetic" : "real"}): ${r.error ? `ERROR ${r.error}` : `${r.scores.length - bad.length}/${r.scores.length} fields, ${r.credits} credits, $${(r.costMicroUsd / 1e6).toFixed(4)}, ${(r.ms / 1000).toFixed(1)} s`}`);
    for (const b of bad) lines.push(`  - ${b.field}: got ${JSON.stringify(b.got)} want ${JSON.stringify(b.want)}`);
  }
  const total = rows.reduce((n, r) => n + r.costMicroUsd, 0);
  lines.push("", `Total: ${rows.reduce((n, r) => n + r.credits, 0)} credits, model cost $${(total / 1e6).toFixed(4)}.`);
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-vision-${live ? "live" : "mock"}`);
  writeFileSync(`${base}.md`, lines.join("\n"));
  writeFileSync(`${base}.json`, JSON.stringify({ live, model: config.models.vision, acc, rows }, null, 2));
  console.log(lines.join("\n"));
  console.log(`\nReport: ${base}.md`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
