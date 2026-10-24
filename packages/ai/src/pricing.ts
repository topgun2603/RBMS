import type { AiUsage, UsageSegment } from "./types";

/**
 * Model rates in one place. USD per million tokens. Because $1 per MTok is exactly 1 micro-USD per token, a rate is
 * also "micro-USD per token": cost = tokens x rate, with no rounding until the end.
 * Cache reads are billed at a fraction of input; cache writes (5 minute TTL) at 1.25x input.
 */
export interface ModelRate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const MODEL_RATES: Record<string, ModelRate> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

/** Used for a model id that is not in the map (billing must never undercharge): the dearest rate. */
export const FALLBACK_RATE: ModelRate = MODEL_RATES["claude-opus-5-5"]!;

export function rateFor(model: string): ModelRate {
  const exact = MODEL_RATES[model];
  if (exact) return exact;
  if (model.includes("haiku")) return MODEL_RATES["claude-haiku-5-5"]!;
  if (model.includes("sonnet")) return MODEL_RATES["claude-sonnet-5-5"]!;
  return FALLBACK_RATE;
}

/**
 * 1 credit = $0.001 of model cost = 1,000 micro-USD. A typical standard-tier reply (2,000 tokens in, 500 out) costs
 * about 18 credits; a light-tier one about 0.5, charged as 1.
 */
export const CREDIT_MICRO_USD = 1000;

export const ZERO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export function addUsage(a: AiUsage, b: AiUsage): AiUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** Cost of one call in micro-USD (rounded up to a whole micro-dollar). */
export function costMicroUsd(model: string, u: AiUsage): number {
  const r = rateFor(model);
  return Math.ceil(u.inputTokens * r.input + u.outputTokens * r.output + u.cacheReadTokens * r.cacheRead + u.cacheWriteTokens * r.cacheWrite);
}

export const segmentsCost = (segments: UsageSegment[]) => segments.reduce((s, x) => s + costMicroUsd(x.model, x.usage), 0);
export const segmentsUsage = (segments: UsageSegment[]) => segments.reduce((s, x) => addUsage(s, x.usage), ZERO_USAGE);

/** Credits for a cost: rounded up, at least 1 when anything was used. */
export function creditsForCost(micro: number): number {
  return micro <= 0 ? 0 : Math.max(1, Math.ceil(micro / CREDIT_MICRO_USD));
}

/** Display only: INR for a number of credits at a USD to INR rate (default 85). */
export const creditsToInr = (credits: number, usdInr = 85) => (credits * CREDIT_MICRO_USD * usdInr) / 1_000_000;
