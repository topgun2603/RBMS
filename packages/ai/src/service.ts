import Anthropic from "@anthropic-ai/sdk";
import { AppError, badRequest, notFound } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { AiRuntimeConfig } from "./config";
import { AI_FEATURE_REGISTRY, AI_SETTINGS_DEFAULTS, featureInfo, type AiSettings } from "./features";
import { maskText } from "./masking";
import { creditsForCost, CREDIT_MICRO_USD, creditsToInr, segmentsCost, segmentsUsage, ZERO_USAGE } from "./pricing";
import { aiRuns, type AiRunRow } from "./schema";
import type {
  AiEffort,
  AiFeedback,
  AiRunRequest,
  AiRunResult,
  AiRunStatus,
  AiTier,
  AiUsage,
  ProviderRequest,
  ProviderResponse,
  UsageSegment,
} from "./types";
import { AI_FEEDBACK } from "./types";

/** The shop's credits this month. `allowance` is the plan's monthly credits (add-ons included); `topUp` are bought packs. */
export interface CreditBalance {
  /** IST month, "2026-10". */
  period: string;
  /** The plan has no cap (enterprise). */
  unlimited: boolean;
  allowance: number;
  /** Taken from the allowance so far this month. */
  allowanceUsed: number;
  /** Credits left from packs; they never expire and are used after the monthly allowance. */
  topUp: number;
  /** Credits that can still be spent now; null when unlimited. */
  remaining: number | null;
}

/** Where credits live. The API host backs it with the plans module (monthly counter + credit packs). */
export interface CreditsPort {
  balance(tenantId: string): Promise<CreditBalance>;
  /** Takes up to `credits` (never more than is left) and returns what was taken. */
  charge(tenantId: string, credits: number): Promise<number>;
}

export interface AiLogger {
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface AiDeps {
  db: Db;
  config: AiRuntimeConfig;
  /** The shop's AI settings (namespace "ai"). */
  settings: { get(tenantId: string): Promise<AiSettings> };
  /** The `ai` module feature: plan, app profile and the owner's Features switch. */
  featureOn(tenantId: string): Promise<boolean>;
  credits: CreditsPort;
  /** Names for the platform usage table. */
  shops?: (ids: string[]) => Promise<Map<string, { slug: string; name: string }>>;
  log?: AiLogger;
  now?: () => Date;
}

const IST_MS = 330 * 60_000;
/** "2026-10": the IST month a moment belongs to (credits reset when it changes, no cron). */
export function monthKey(d: Date): string {
  const l = new Date(d.getTime() + IST_MS);
  return `${l.getUTCFullYear()}-${String(l.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const DEBUG_KEEP_DAYS = 7;
const MAX_MEDIA_CHARS = 20_000_000;
const TOOL_RESULT_MAX = 20_000;

const err = {
  disabled: () => new AppError(503, "ai_disabled", "AI is switched off on this platform right now."),
  unavailable: () => new AppError(503, "ai_unavailable", "AI isn't set up yet. Please try again later."),
  notInPlan: () => new AppError(403, "ai_not_available", "AI is not part of your plan or has been hidden for this shop."),
  off: () => new AppError(403, "ai_off", "AI is switched off for your shop. The owner can switch it on in Settings > AI."),
  featureOff: (feature: string) => new AppError(403, "ai_feature_off", "This AI helper is switched off for your shop. The owner can switch it on in Settings > AI.", { feature }),
  exhausted: (b: CreditBalance) =>
    new AppError(402, "ai_credits_exhausted", "You have used all your AI credits for this month. They renew next month, or you can add a credit pack.", {
      period: b.period,
      allowance: b.allowance,
      topUp: b.topUp,
    }),
  refused: (runId: string) => new AppError(422, "ai_refused", "The AI could not help with this request. Please change it and try again.", { runId }),
  truncated: (runId: string) => new AppError(502, "ai_truncated", "The AI ran out of room before it finished. Try a shorter request.", { runId }),
  invalid: (runId: string) => new AppError(502, "ai_invalid_output", "The AI gave an answer we could not use. Please try again.", { runId }),
  busy: () => new AppError(503, "ai_busy", "The AI is busy right now. Please try again in a minute."),
  failed: () => new AppError(502, "ai_failed", "The AI could not answer right now. Please try again."),
  steps: (runId: string) => new AppError(502, "ai_too_many_steps", "The AI took too many steps for this request.", { runId }),
};

/** Maps an SDK error to what the shop sees. Rate limits and outages are retryable; our own key or billing problems are not the shop's fault. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof Anthropic.RateLimitError) return err.busy();
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return err.unavailable();
  if (e instanceof Anthropic.APIConnectionError) return err.busy();
  if (e instanceof Anthropic.APIError) {
    if (e.status === 402) return err.unavailable(); // the platform's own Anthropic billing, not the shop's
    if (e.status === 529 || (e.status !== undefined && e.status >= 500)) return err.busy();
    return err.failed();
  }
  return err.failed();
}

const DEFAULT_EFFORT: Record<AiTier, AiEffort> = { light: "low", standard: "medium", vision: "medium" };

export class AiService {
  private readonly now: () => Date;
  constructor(private readonly deps: AiDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  get config() {
    return this.deps.config;
  }

  // ------------------------------------------------------------------ run

  /**
   * The one entry point for AI. Checks the switches and the credits, minimises and masks the input, calls the model
   * (looping over read-only tools when given), validates structured output, charges the actual usage and records the run
   * (metadata only). The result is a DRAFT: callers show it for the person to confirm, then report back through
   * `feedback`. Failures throw an AppError with a stable `ai_*` code; the run is recorded either way.
   */
  async run<T = string>(req: AiRunRequest<T>): Promise<AiRunResult<T>> {
    if (!req.tenantId) throw badRequest("AI runs belong to a shop");
    const media = (req.input.images?.length ?? 0) + (req.input.pdfs?.length ?? 0);
    if (media > 0 && req.tier !== "vision") throw badRequest("Images and PDFs need the vision tier");
    if (!req.input.text && media === 0) throw badRequest("Nothing to send to the AI");
    const mediaChars = [...(req.input.images ?? []), ...(req.input.pdfs ?? [])].reduce((n, m) => n + m.data.length, 0);
    if (mediaChars > MAX_MEDIA_CHARS) throw new AppError(413, "ai_input_too_large", "The file is too large for the AI. Use a smaller photo or PDF.");

    const { config } = this.deps;
    const model = config.models[req.tier];
    const started = Date.now();
    const base = { tenantId: req.tenantId, userId: req.userId ?? null, feature: req.feature, tier: req.tier, model, provider: config.providerKind ?? "mock" };
    const id = randomUUID();
    const blocked = async (e: AppError): Promise<never> => {
      await this.record({ ...base, id, status: "blocked", errorCode: e.code, usage: ZERO_USAGE, costMicroUsd: 0, credits: 0, steps: 0, latencyMs: Date.now() - started });
      throw e;
    };

    if (!config.enabled) return blocked(err.disabled());
    if (!config.provider) return blocked(err.unavailable());
    if (!(await this.deps.featureOn(req.tenantId))) return blocked(err.notInPlan());
    const settings = await this.settingsOf(req.tenantId);
    if (!settings.enabled) return blocked(err.off());
    if (settings.features[req.feature] === false) return blocked(err.featureOff(req.feature));
    const balance = await this.deps.credits.balance(req.tenantId);
    if (balance.remaining !== null && balance.remaining <= 0) return blocked(err.exhausted(balance));

    const maskOpts = req.mask === false ? false : { gstin: settings.maskGstin, ...(req.mask ?? {}) };
    const text = req.input.text === undefined ? undefined : maskOpts === false ? req.input.text : maskText(req.input.text, maskOpts);

    const content: Anthropic.ContentBlockParam[] = [
      ...(req.input.images ?? []).map((i): Anthropic.ContentBlockParam => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.data } })),
      ...(req.input.pdfs ?? []).map((p): Anthropic.ContentBlockParam => ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: p.data }, ...(p.title ? { title: p.title } : {}) })),
      ...(text ? [{ type: "text" as const, text }] : []),
    ];
    const messages: Anthropic.MessageParam[] = [{ role: "user", content }];
    const tools = req.tools?.map((t): Anthropic.Tool => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
    const providerReq = (): ProviderRequest => ({
      model,
      tier: req.tier,
      system: req.system,
      messages,
      maxTokens: req.maxTokens ?? 4096,
      effort: req.effort ?? DEFAULT_EFFORT[req.tier],
      ...(req.schema ? { jsonSchema: req.schema.jsonSchema } : {}),
      ...(tools?.length ? { tools } : {}),
    });

    const segments: UsageSegment[] = [];
    let steps = 0;
    let servedModel = model;
    let finished = false;
    const finish = async (status: AiRunStatus, errorCode: string | null, output?: string) => {
      finished = true;
      const usage = segmentsUsage(segments);
      const micro = segmentsCost(segments);
      const charged = await this.charge(req.tenantId, creditsForCost(micro));
      await this.record({
        ...base,
        id,
        model: servedModel,
        status,
        errorCode,
        usage,
        costMicroUsd: micro,
        credits: charged,
        steps,
        latencyMs: Date.now() - started,
        debug: settings.storePrompts ? { input: text ?? "", output: output ?? "" } : null,
      });
      return { usage, charged };
    };

    try {
      const maxSteps = Math.max(1, Math.min(req.maxSteps ?? 6, 12));
      let last: ProviderResponse | null = null;
      while (steps < maxSteps) {
        const r: ProviderResponse = await config.provider.complete(providerReq());
        steps++;
        servedModel = r.model;
        segments.push(...r.segments);
        last = r;
        // stop_reason first: a refusal or a cut-off reply has no usable content.
        if (r.stopReason === "refusal") {
          await finish("refused", "ai_refused");
          throw err.refused(id);
        }
        if (r.stopReason === "max_tokens") {
          await finish("error", "ai_truncated");
          throw err.truncated(id);
        }
        if (r.stopReason === "pause_turn") {
          messages.push({ role: "assistant", content: r.assistant });
          continue;
        }
        if (r.stopReason === "tool_use" && r.toolUses.length > 0) {
          if (!req.tools?.length) {
            await finish("error", "ai_failed");
            throw err.failed();
          }
          if (steps >= maxSteps) break; // no more steps allowed: do not run the tools for an answer we cannot ask for
          // Do not keep spending past what the shop has left.
          if (balance.remaining !== null && creditsForCost(segmentsCost(segments)) >= balance.remaining) {
            await finish("error", "ai_credits_exhausted");
            throw err.exhausted(balance);
          }
          messages.push({ role: "assistant", content: r.assistant });
          messages.push({ role: "user", content: await this.runTools(req, r) });
          continue;
        }
        break;
      }
      if (!last || last.stopReason === "tool_use" || last.stopReason === "pause_turn") {
        await finish("error", "ai_too_many_steps");
        throw err.steps(id);
      }

      let output: unknown = last.text;
      if (req.schema) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(last.text);
        } catch {
          await finish("error", "ai_invalid_output", last.text);
          throw err.invalid(id);
        }
        if (req.schema.zod) {
          const v = req.schema.zod.safeParse(parsed);
          if (!v.success) {
            await finish("error", "ai_invalid_output", last.text);
            throw err.invalid(id);
          }
          parsed = v.data;
        }
        output = parsed;
      }
      const { usage, charged } = await finish("ok", null, last.text);
      return { output: output as T, runId: id, usage, credits: charged, model: servedModel, provider: config.provider.kind };
    } catch (e) {
      if (finished) throw e; // the run was already recorded and charged
      // A provider or tool failure: record what was used and report it in plain words.
      const mapped = toAppError(e);
      this.deps.log?.warn({ err: e instanceof Error ? e.message : String(e), feature: req.feature, tenantId: req.tenantId }, "ai: run failed");
      await finish("error", mapped.code);
      throw mapped;
    }
  }

  private async runTools(req: AiRunRequest<unknown>, r: ProviderResponse): Promise<Anthropic.ToolResultBlockParam[]> {
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of r.toolUses) {
      const tool = req.tools?.find((t) => t.name === use.name);
      if (!tool) {
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: `Unknown tool ${use.name}` });
        continue;
      }
      try {
        const out = await tool.run(use.input);
        const text = typeof out === "string" ? out : JSON.stringify(out);
        results.push({ type: "tool_result", tool_use_id: use.id, content: text.length > TOOL_RESULT_MAX ? `${text.slice(0, TOOL_RESULT_MAX)} [truncated]` : text });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: e instanceof Error ? e.message : "Tool failed" });
      }
    }
    return results;
  }

  private async settingsOf(tenantId: string): Promise<AiSettings> {
    const s = await this.deps.settings.get(tenantId);
    return { ...AI_SETTINGS_DEFAULTS, ...s, features: { ...(s?.features ?? {}) } };
  }

  /** Takes credits, never failing the run over bookkeeping: a failed charge is logged and counts as 0. */
  private async charge(tenantId: string, credits: number): Promise<number> {
    if (credits <= 0) return 0;
    try {
      return await this.deps.credits.charge(tenantId, credits);
    } catch (e) {
      this.deps.log?.error({ err: e instanceof Error ? e.message : String(e), tenantId, credits }, "ai: charging credits failed");
      return 0;
    }
  }

  private async record(r: {
    id: string;
    tenantId: string;
    userId: string | null;
    feature: string;
    tier: AiTier;
    model: string;
    provider: "claude" | "mock";
    status: AiRunStatus;
    errorCode: string | null;
    usage: AiUsage;
    costMicroUsd: number;
    credits: number;
    steps: number;
    latencyMs: number;
    debug?: { input: string; output: string } | null;
  }) {
    try {
      await this.deps.db.insert(aiRuns).values({
        id: r.id,
        tenantId: r.tenantId,
        userId: r.userId,
        feature: r.feature,
        tier: r.tier,
        model: r.model,
        provider: r.provider,
        status: r.status,
        errorCode: r.errorCode,
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
        cacheReadTokens: r.usage.cacheReadTokens,
        cacheWriteTokens: r.usage.cacheWriteTokens,
        costMicroUsd: r.costMicroUsd,
        credits: r.credits,
        steps: r.steps,
        latencyMs: r.latencyMs,
        period: monthKey(this.now()),
        debug: r.debug ?? null,
      });
    } catch (e) {
      this.deps.log?.error({ err: e instanceof Error ? e.message : String(e), runId: r.id }, "ai: recording the run failed");
    }
  }

  // ------------------------------------------------------------------ feedback

  /** "Was the draft good?": accepted as it was, edited before saving, or rejected. Only the shop's own successful runs. */
  async feedback(tenantId: string, runId: string, outcome: AiFeedback, note?: string | null) {
    if (!AI_FEEDBACK.includes(outcome)) throw badRequest("outcome must be accepted, edited or rejected");
    const rows = await this.deps.db
      .update(aiRuns)
      .set({ feedback: outcome, feedbackNote: note?.trim() ? note.trim().slice(0, 500) : null, feedbackAt: this.now() })
      .where(and(eq(aiRuns.id, runId), eq(aiRuns.tenantId, tenantId), eq(aiRuns.status, "ok")))
      .returning({ id: aiRuns.id });
    if (rows.length === 0) throw notFound("AI run");
    return { ok: true as const, runId, outcome };
  }

  // ------------------------------------------------------------------ reading

  async status(tenantId: string) {
    const { config } = this.deps;
    const [settings, balance, featureOn, spent] = await Promise.all([
      this.settingsOf(tenantId),
      this.deps.credits.balance(tenantId),
      this.deps.featureOn(tenantId),
      this.spentIn(tenantId, monthKey(this.now())),
    ]);
    const available = config.enabled && !!config.provider;
    return {
      /** Everything needed for a helper to run for this shop right now. */
      ready: available && featureOn && settings.enabled && (balance.remaining === null || balance.remaining > 0),
      platformEnabled: config.enabled,
      available,
      provider: config.providerKind,
      mock: config.providerKind === "mock",
      shopEnabled: settings.enabled,
      models: config.models,
      credits: {
        ...balance,
        usedThisMonth: spent,
        /** What one credit is: $0.001 of model cost. */
        creditUsd: CREDIT_MICRO_USD / 1_000_000,
        creditInr: creditsToInr(1, config.usdInr),
      },
      features: AI_FEATURE_REGISTRY.map((f) => ({
        key: f.key,
        status: f.status,
        tier: f.tier,
        label: f.label,
        labelTa: f.labelTa,
        description: f.description,
        descriptionTa: f.descriptionTa,
        enabled: settings.enabled && settings.features[f.key] !== false,
        allowed: settings.features[f.key] !== false,
      })),
      settings: { enabled: settings.enabled, maskGstin: settings.maskGstin, storePrompts: settings.storePrompts },
    };
  }

  private async spentIn(tenantId: string, period: string): Promise<number> {
    const [r] = await this.deps.db
      .select({ n: sql<number>`coalesce(sum(${aiRuns.credits}), 0)::int` })
      .from(aiRuns)
      .where(and(eq(aiRuns.tenantId, tenantId), eq(aiRuns.period, period)));
    return r?.n ?? 0;
  }

  /** Usage by helper and by day over the last `days` days (IST days), plus how often drafts were accepted as they were. */
  async usage(tenantId: string, days = 30) {
    const d = Math.min(Math.max(Math.floor(days), 1), 366);
    const since = new Date(this.now().getTime() - d * 86_400_000);
    const day = sql<string>`to_char(${aiRuns.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;
    const where = and(eq(aiRuns.tenantId, tenantId), gte(aiRuns.createdAt, since));
    const totals = {
      runs: sql<number>`count(*)::int`,
      ok: sql<number>`count(*) filter (where ${aiRuns.status} = 'ok')::int`,
      failed: sql<number>`count(*) filter (where ${aiRuns.status} in ('error','refused'))::int`,
      blocked: sql<number>`count(*) filter (where ${aiRuns.status} = 'blocked')::int`,
      credits: sql<number>`coalesce(sum(${aiRuns.credits}), 0)::int`,
      costMicroUsd: sql<number>`coalesce(sum(${aiRuns.costMicroUsd}), 0)::int`,
      accepted: sql<number>`count(*) filter (where ${aiRuns.feedback} = 'accepted')::int`,
      edited: sql<number>`count(*) filter (where ${aiRuns.feedback} = 'edited')::int`,
      rejected: sql<number>`count(*) filter (where ${aiRuns.feedback} = 'rejected')::int`,
    };
    const [byFeature, byDay] = await Promise.all([
      this.deps.db.select({ feature: aiRuns.feature, ...totals }).from(aiRuns).where(where).groupBy(aiRuns.feature).orderBy(desc(sql`sum(${aiRuns.credits})`)),
      this.deps.db.select({ day, ...totals }).from(aiRuns).where(where).groupBy(day).orderBy(day),
    ]);
    const sum = (k: "accepted" | "edited" | "rejected") => byFeature.reduce((n, r) => n + r[k], 0);
    const accepted = sum("accepted");
    const judged = accepted + sum("edited") + sum("rejected");
    return { days: d, byFeature, byDay, savedWithoutEdits: judged === 0 ? null : accepted / judged };
  }

  async recentRuns(tenantId: string, limit = 25) {
    const rows = await this.deps.db
      .select()
      .from(aiRuns)
      .where(eq(aiRuns.tenantId, tenantId))
      .orderBy(desc(aiRuns.createdAt))
      .limit(Math.min(Math.max(Math.floor(limit), 1), 100));
    return rows.map((r) => runView(r));
  }

  /** Platform view: every shop's runs, cost and credits in a month (default this one). */
  async adminUsage(month?: string) {
    const period = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : monthKey(this.now());
    const rows = await this.deps.db
      .select({
        tenantId: aiRuns.tenantId,
        runs: sql<number>`count(*)::int`,
        ok: sql<number>`count(*) filter (where ${aiRuns.status} = 'ok')::int`,
        errors: sql<number>`count(*) filter (where ${aiRuns.status} in ('error','refused'))::int`,
        blocked: sql<number>`count(*) filter (where ${aiRuns.status} = 'blocked')::int`,
        inputTokens: sql<number>`coalesce(sum(${aiRuns.inputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${aiRuns.outputTokens}), 0)::bigint`,
        costMicroUsd: sql<number>`coalesce(sum(${aiRuns.costMicroUsd}), 0)::bigint`,
        credits: sql<number>`coalesce(sum(${aiRuns.credits}), 0)::int`,
        lastAt: sql<Date>`max(${aiRuns.createdAt})`,
      })
      .from(aiRuns)
      .where(eq(aiRuns.period, period))
      .groupBy(aiRuns.tenantId)
      .orderBy(desc(sql`sum(${aiRuns.costMicroUsd})`));
    const names = (await this.deps.shops?.(rows.map((r) => r.tenantId))) ?? new Map();
    const items = rows.map((r) => ({
      ...r,
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      costMicroUsd: Number(r.costMicroUsd),
      slug: names.get(r.tenantId)?.slug ?? null,
      name: names.get(r.tenantId)?.name ?? null,
    }));
    const total = items.reduce((t, r) => ({ runs: t.runs + r.runs, costMicroUsd: t.costMicroUsd + r.costMicroUsd, credits: t.credits + r.credits }), { runs: 0, costMicroUsd: 0, credits: 0 });
    return { period, provider: this.deps.config.providerKind, total, items };
  }

  /** Clears the stored prompts of runs older than 7 days. Returns how many rows were cleared. */
  async purgeDebug(): Promise<number> {
    const cutoff = new Date(this.now().getTime() - DEBUG_KEEP_DAYS * 86_400_000);
    const rows = await this.deps.db
      .update(aiRuns)
      .set({ debug: null })
      .where(and(isNotNull(aiRuns.debug), lt(aiRuns.createdAt, cutoff)))
      .returning({ id: aiRuns.id });
    return rows.length;
  }
}

/** A run as shown to the shop: no stored text, only whether any exists. */
export function runView(r: AiRunRow) {
  return {
    id: r.id,
    feature: r.feature,
    label: featureInfo(r.feature)?.label ?? r.feature,
    labelTa: featureInfo(r.feature)?.labelTa ?? r.feature,
    tier: r.tier,
    model: r.model,
    provider: r.provider,
    status: r.status,
    errorCode: r.errorCode,
    credits: r.credits,
    steps: r.steps,
    latencyMs: r.latencyMs,
    feedback: r.feedback,
    hasDebug: r.debug !== null,
    createdAt: r.createdAt,
  };
}
