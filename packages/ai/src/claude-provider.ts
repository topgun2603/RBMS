import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider, AiUsage, ProviderRequest, ProviderResponse, ProviderStop, ProviderToolUse, UsageSegment } from "./types";

/**
 * The slice of the SDK client the provider uses, so tests pass a fake (no network). The real `Anthropic` client fits.
 * Responses are read through the loose shapes below because the plain and beta messages share these fields.
 */
export interface ClaudeClientLike {
  messages: { create(params: Record<string, unknown>): Promise<unknown> };
  beta: { messages: { create(params: Record<string, unknown>): Promise<unknown> } };
}

interface RawUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  iterations?: ({ type: string; model?: string } & RawUsage)[] | null;
}
interface RawMessage {
  model?: string;
  stop_reason?: string | null;
  stop_details?: { category?: string | null } | null;
  content?: Anthropic.ContentBlock[];
  usage?: RawUsage | null;
}

/** Server-side refusal fallback (Opus 5 family): a policy decline is retried on a substitute model inside the same call. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const supportsFallback = (model: string) => model.startsWith("claude-opus-5");

export interface ClaudeProviderOptions {
  apiKey?: string;
  /** Test double or a pre-built client. Default: `new Anthropic({ apiKey })`. */
  client?: ClaudeClientLike;
  /** Request the server-side refusal fallback on Opus 5.x models. Default true. */
  refusalFallback?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
}

const usageOf = (u: RawUsage | null | undefined): AiUsage => ({
  inputTokens: u?.input_tokens ?? 0,
  outputTokens: u?.output_tokens ?? 0,
  cacheReadTokens: u?.cache_read_input_tokens ?? 0,
  cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
});

/** Per-attempt usage when the API lists iterations (a fallback model may have run), else the top-level usage. */
export function segmentsOf(requested: string, served: string, usage: RawUsage | null | undefined): UsageSegment[] {
  const its = (usage?.iterations ?? []).filter((i) => i.type === "message" || i.type === "fallback_message");
  if (its.length > 0) return its.map((i) => ({ model: i.type === "fallback_message" ? (i.model ?? served) : (i.model ?? requested), usage: usageOf(i) }));
  return [{ model: served, usage: usageOf(usage) }];
}

const STOPS: Record<string, ProviderStop> = {
  end_turn: "end_turn",
  stop_sequence: "end_turn",
  max_tokens: "max_tokens",
  model_context_window_exceeded: "max_tokens",
  refusal: "refusal",
  tool_use: "tool_use",
  pause_turn: "pause_turn",
};

export class ClaudeProvider implements AiProvider {
  readonly kind = "claude" as const;
  private readonly client: ClaudeClientLike;
  private readonly fallback: boolean;

  constructor(opts: ClaudeProviderOptions = {}) {
    this.client =
      opts.client ?? (new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 90_000, maxRetries: opts.maxRetries ?? 2 }) as unknown as ClaudeClientLike);
    this.fallback = opts.refusalFallback ?? true;
  }

  /** The request body for the Messages API (exposed for tests). No thinking, temperature or prefill: not allowed on these models. */
  buildParams(req: ProviderRequest): Record<string, unknown> {
    const params: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens,
      // The stable instructions are the cache prefix; per-request content stays in `messages`.
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: req.messages,
      output_config: { effort: req.effort, ...(req.jsonSchema ? { format: { type: "json_schema", schema: req.jsonSchema } } : {}) },
    };
    if (req.tools?.length) params.tools = req.tools.map((t) => ({ ...t, strict: true }));
    return params;
  }

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    const params = this.buildParams(req);
    const useFallback = this.fallback && supportsFallback(req.model);
    const raw = (useFallback
      ? await this.client.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: "default" })
      : await this.client.messages.create(params)) as RawMessage;

    // Always look at stop_reason before the content: a refusal is a normal 200 with no usable text.
    const stopReason = STOPS[raw.stop_reason ?? ""] ?? "other";
    const content = raw.content ?? [];
    const text = content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const toolUses: ProviderToolUse[] = content.flatMap((b) =>
      b.type === "tool_use" ? [{ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }] : [],
    );
    const served = raw.model ?? req.model;
    const segments = segmentsOf(req.model, served, raw.usage);
    return {
      model: served,
      stopReason,
      text,
      toolUses,
      // Thinking blocks are bound to the model and conversation: only text and tool_use go back into the next turn.
      assistant: content.flatMap((b): Anthropic.ContentBlockParam[] => {
        if (b.type === "text") return [{ type: "text", text: b.text }];
        if (b.type === "tool_use") return [{ type: "tool_use", id: b.id, name: b.name, input: b.input }];
        return [];
      }),
      segments,
      refusalCategory: stopReason === "refusal" ? (raw.stop_details?.category ?? null) : undefined,
      fallbackUsed: (raw.usage?.iterations ?? []).some((i) => i.type === "fallback_message"),
    };
  }
}
