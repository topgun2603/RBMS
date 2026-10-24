import type Anthropic from "@anthropic-ai/sdk";
import type { AiProvider, ProviderRequest, ProviderResponse } from "./types";

/** What a test or the dev server can script: given the request, return text (or null to fall through to the default). */
export type MockResponder = (req: ProviderRequest) => string | null | undefined;

/** Markers in the input text that make the mock misbehave on purpose, so error paths can be tried without a model. */
export const MOCK_MARKERS = {
  refuse: "[mock:refuse]",
  truncate: "[mock:truncate]",
  fail: "[mock:fail]",
  badJson: "[mock:badjson]",
} as const;

const approxTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));

function lastUserText(messages: Anthropic.MessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    return m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
  }
  return "";
}

function hasToolResult(messages: Anthropic.MessageParam[]): boolean {
  return messages.some((m) => typeof m.content !== "string" && m.content.some((b) => b.type === "tool_result"));
}

/** A deterministic sample value for a JSON schema: first enum value, "Sample" strings, zeros, empty arrays, required keys only. */
export function sampleFor(schema: unknown, depth = 0): unknown {
  if (!schema || typeof schema !== "object" || depth > 6) return null;
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  if (s.const !== undefined) return s.const;
  const anyOf = (s.anyOf ?? s.oneOf) as unknown[] | undefined;
  if (Array.isArray(anyOf) && anyOf.length) return sampleFor(anyOf.find((x) => (x as { type?: string })?.type !== "null") ?? anyOf[0], depth + 1);
  const type = Array.isArray(s.type) ? (s.type.find((t) => t !== "null") ?? s.type[0]) : s.type;
  switch (type) {
    case "object": {
      const props = (s.properties ?? {}) as Record<string, unknown>;
      const required = new Set((s.required as string[] | undefined) ?? Object.keys(props));
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) if (required.has(k)) out[k] = sampleFor(v, depth + 1);
      return out;
    }
    case "array":
      return [];
    case "string":
      return "Sample";
    case "integer":
    case "number":
      return typeof s.minimum === "number" ? s.minimum : 0;
    case "boolean":
      return false;
    default:
      return null;
  }
}

/**
 * Deterministic provider for development and tests: no network, no key, no cost. Structured requests get a sample object
 * of the schema, tool requests call the first tool once, plain requests echo the start of the input. Same input, same
 * output, so tests and evals are repeatable. Token counts are estimated from the text length.
 */
export class MockProvider implements AiProvider {
  readonly kind = "mock" as const;
  readonly calls: ProviderRequest[] = [];
  constructor(private readonly responders: MockResponder[] = []) {}

  /** Adds a scripted answer (checked before the defaults). */
  respond(fn: MockResponder) {
    this.responders.unshift(fn);
    return this;
  }

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    this.calls.push(req);
    const input = lastUserText(req.messages);
    const inputTokens = approxTokens(req.system) + approxTokens(JSON.stringify(req.messages));
    const base = { model: req.model, toolUses: [], assistant: [] as Anthropic.ContentBlockParam[], fallbackUsed: false };
    const done = (text: string, stop: ProviderResponse["stopReason"] = "end_turn"): ProviderResponse => ({
      ...base,
      stopReason: stop,
      text,
      assistant: [{ type: "text", text }],
      segments: [{ model: req.model, usage: { inputTokens, outputTokens: Math.min(req.maxTokens, approxTokens(text)), cacheReadTokens: 0, cacheWriteTokens: 0 } }],
    });

    if (input.includes(MOCK_MARKERS.fail)) throw new Error("mock provider failure");
    if (input.includes(MOCK_MARKERS.refuse)) return { ...done(""), stopReason: "refusal", refusalCategory: "general_harms", assistant: [] };
    if (input.includes(MOCK_MARKERS.truncate)) return done("{\"partial\":", "max_tokens");

    for (const r of this.responders) {
      const text = r(req);
      if (typeof text === "string") return done(text);
    }

    if (req.tools?.length && !hasToolResult(req.messages)) {
      const tool = req.tools[0]!;
      const use = { id: "toolu_mock_1", name: tool.name, input: (sampleFor(tool.input_schema) ?? {}) as Record<string, unknown> };
      return {
        ...base,
        stopReason: "tool_use",
        text: "",
        toolUses: [use],
        assistant: [{ type: "tool_use", id: use.id, name: use.name, input: use.input }],
        segments: [{ model: req.model, usage: { inputTokens, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } }],
      };
    }
    if (req.jsonSchema) return done(input.includes(MOCK_MARKERS.badJson) ? "not json" : JSON.stringify(sampleFor(req.jsonSchema)));
    if (/^\s*ping\b/i.test(input)) return done("OK");
    const snippet = input.replace(/\s+/g, " ").trim().slice(0, 80);
    return done(`[Mock AI] ${snippet}`);
  }
}
