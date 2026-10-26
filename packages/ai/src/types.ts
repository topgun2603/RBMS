import type Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";

/** Which class of model a feature needs. Models per tier come from env (AI_MODEL_LIGHT / _STANDARD / _VISION). */
export const AI_TIERS = ["light", "standard", "vision"] as const;
export type AiTier = (typeof AI_TIERS)[number];

export type AiEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** How a run ended. `blocked` = refused by us before any model call (switch off, no credits...). */
export const AI_RUN_STATUSES = ["ok", "refused", "error", "blocked"] as const;
export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];

export const AI_FEEDBACK = ["accepted", "edited", "rejected"] as const;
export type AiFeedback = (typeof AI_FEEDBACK)[number];

export type AiImageType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";
/** Content the model reads. Text is masked by default (phones, emails); images and PDFs are sent as given. */
export interface AiInput {
  text?: string;
  /** Base64 (no data: prefix). Bill photos, product shots. Needs tier "vision". */
  images?: { mediaType: AiImageType; data: string }[];
  /** Base64 PDFs, e.g. a supplier bill. Needs tier "vision". */
  pdfs?: { data: string; title?: string }[];
}

/** Structured output: the model is constrained to `jsonSchema`; the reply is then validated with `zod` when given. */
export interface AiSchema<T = unknown> {
  name: string;
  jsonSchema: Record<string, unknown>;
  zod?: ZodType<T>;
}

/**
 * A read-only tool the model may call (an "Ask your shop" query, a catalogue lookup...). The caller provides `run`,
 * which must only read, and only from the caller's own tenant. Throwing returns the message to the model as an error.
 */
export interface AiTool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  run(input: Record<string, unknown>): Promise<string | object>;
}

export interface AiMaskOptions {
  phones?: boolean;
  emails?: boolean;
  gstin?: boolean;
}

export interface AiRunRequest<T = unknown> {
  tenantId: string;
  userId?: string | null;
  /** Registry key of the feature (features.ts): decides the per-feature switch and the usage breakdown. */
  feature: string;
  tier: AiTier;
  /** Stable instructions. Keep them identical between calls so prompt caching can serve them (no dates or ids in it). */
  system: string;
  input: AiInput;
  schema?: AiSchema<T>;
  /** Hard cap on thinking plus reply. Default 4096. */
  maxTokens?: number;
  /** Depth of thinking. Default: low for the light tier, medium otherwise. */
  effort?: AiEffort;
  tools?: AiTool[];
  /** Tool loop guard. Default 6. */
  maxSteps?: number;
  /** Masking of the text input. Default: phones and emails on, GSTIN per the shop's setting. false = send as written. */
  mask?: AiMaskOptions | false;
  /**
   * A platform tool run by the RBMS team (support triage, release notes): the platform kill switch and the provider still
   * apply, but no shop's switches or credits do. Pass `tenantId: PLATFORM_TENANT_ID`; the run is recorded there and its
   * credits are counted, never charged to a shop.
   */
  platform?: boolean;
}

/** The `ai_runs` owner of platform tool runs (`platform: true`): not a shop. */
export const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AiRunResult<T = unknown> {
  /** The validated object for a schema run, else the reply text. A draft: show it for confirmation, never apply it silently. */
  output: T;
  runId: string;
  usage: AiUsage;
  /** Credits charged for this run. */
  credits: number;
  model: string;
  provider: ProviderKind;
}

// ------------------------------------------------------------------ provider port

export type ProviderKind = "claude" | "mock";
/** What an `ai_runs` row records: a model provider, or "local" for on-server work that calls no model (image cleanup). */
export type RunProvider = ProviderKind | "local";

export interface ProviderRequest {
  model: string;
  tier: AiTier;
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  effort: AiEffort;
  jsonSchema?: Record<string, unknown>;
  tools?: Anthropic.Tool[];
}

export interface ProviderToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** What one model call used; `model` differs from the requested one when a fallback model served it. */
export interface UsageSegment {
  model: string;
  usage: AiUsage;
}

export type ProviderStop = "end_turn" | "max_tokens" | "refusal" | "tool_use" | "pause_turn" | "other";

export interface ProviderResponse {
  model: string;
  stopReason: ProviderStop;
  /** Concatenated text blocks. */
  text: string;
  toolUses: ProviderToolUse[];
  /** The assistant turn to send back when continuing a tool loop. */
  assistant: Anthropic.ContentBlockParam[];
  segments: UsageSegment[];
  /** Why the model declined (refusal category), when it did. */
  refusalCategory?: string | null;
  fallbackUsed?: boolean;
}

/** The one thing a provider does: complete a request. The real one calls Claude; the mock answers from canned data. */
export interface AiProvider {
  readonly kind: ProviderKind;
  complete(req: ProviderRequest): Promise<ProviderResponse>;
}
