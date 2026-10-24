import { z } from "zod";
import { ClaudeProvider, type ClaudeClientLike } from "./claude-provider";
import { MockProvider } from "./mock-provider";
import type { AiProvider, AiTier, ProviderKind } from "./types";

export const DEFAULT_MODELS: Record<AiTier, string> = {
  light: "claude-haiku-5-5",
  standard: "claude-opus-5-5",
  vision: "claude-opus-5-5",
};

const flag = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "true"));
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = () => z.preprocess(blank, z.string().trim().min(1).optional());

/**
 * The AI variables of the API environment (apps/api/src/env.ts spreads `aiEnvShape`). Everything is optional: with no
 * key outside production the mock provider answers, so development and tests never need a key or spend money.
 */
export const aiEnvShape = {
  /** Anthropic API key. Unset = the mock provider (development); in production AI calls answer 503 `ai_unavailable`. */
  ANTHROPIC_API_KEY: optionalString(),
  /** Platform kill switch. Default: on in development and test, off in production until set to true. */
  AI_ENABLED: z.preprocess(blank, flag),
  /** `auto` (default): Claude when a key is set, else the mock outside production. `mock` forces the mock. */
  AI_PROVIDER: z.preprocess(blank, z.enum(["auto", "mock"]).default("auto")),
  /** Model ids per tier. Standard and vision can be switched to claude-sonnet-5-5 to cut the cost. */
  AI_MODEL_LIGHT: z.preprocess(blank, z.string().trim().min(1).default(DEFAULT_MODELS.light)),
  AI_MODEL_STANDARD: z.preprocess(blank, z.string().trim().min(1).default(DEFAULT_MODELS.standard)),
  AI_MODEL_VISION: z.preprocess(blank, z.string().trim().min(1).default(DEFAULT_MODELS.vision)),
  /** Rupees per US dollar, for showing what credits cost in rupees (display only). */
  AI_USD_INR: z.preprocess(blank, z.coerce.number().min(1).max(1000).default(85)),
};

export interface AiEnvInput {
  NODE_ENV?: string;
  ANTHROPIC_API_KEY?: string;
  AI_ENABLED?: boolean;
  AI_PROVIDER?: "auto" | "mock";
  AI_MODEL_LIGHT?: string;
  AI_MODEL_STANDARD?: string;
  AI_MODEL_VISION?: string;
  AI_USD_INR?: number;
}

export interface AiRuntimeConfig {
  /** Platform kill switch. */
  enabled: boolean;
  /** null: no provider (production without a key), calls answer 503 `ai_unavailable`. */
  provider: AiProvider | null;
  providerKind: ProviderKind | null;
  models: Record<AiTier, string>;
  usdInr: number;
}

/** Turns the environment into a provider, the models per tier and the kill switch. `client` is for tests. */
export function resolveAiConfig(env: AiEnvInput, opts: { client?: ClaudeClientLike; mock?: MockProvider } = {}): AiRuntimeConfig {
  const production = env.NODE_ENV === "production";
  const models: Record<AiTier, string> = {
    light: env.AI_MODEL_LIGHT ?? DEFAULT_MODELS.light,
    standard: env.AI_MODEL_STANDARD ?? DEFAULT_MODELS.standard,
    vision: env.AI_MODEL_VISION ?? DEFAULT_MODELS.vision,
  };
  let provider: AiProvider | null = null;
  const forceMock = env.AI_PROVIDER === "mock";
  if (env.ANTHROPIC_API_KEY && !forceMock) provider = new ClaudeProvider({ apiKey: env.ANTHROPIC_API_KEY, client: opts.client });
  else if (forceMock || !production) provider = opts.mock ?? new MockProvider();
  return {
    enabled: env.AI_ENABLED ?? !production,
    provider,
    providerKind: provider?.kind ?? null,
    models,
    usdInr: env.AI_USD_INR ?? 85,
  };
}
