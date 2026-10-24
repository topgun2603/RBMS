import { describe, expect, it, vi } from "vitest";
import { ClaudeProvider, FALLBACK_BETA, segmentsOf, type ClaudeClientLike } from "./claude-provider";
import { resolveAiConfig } from "./config";
import type { ProviderRequest } from "./types";

function fakeClient(reply: unknown) {
  const plain = vi.fn(async () => reply);
  const beta = vi.fn(async () => reply);
  const client = { messages: { create: plain }, beta: { messages: { create: beta } } } as unknown as ClaudeClientLike;
  return { client, plain, beta };
}

const reply = (over: Record<string, unknown> = {}) => ({
  model: "claude-haiku-5-5",
  stop_reason: "end_turn",
  content: [{ type: "text", text: "OK" }],
  usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 400, cache_creation_input_tokens: 50 },
  ...over,
});

const req = (over: Partial<ProviderRequest> = {}): ProviderRequest => ({
  model: "claude-haiku-5-5",
  tier: "light",
  system: "Stable instructions.",
  messages: [{ role: "user", content: "hi" }],
  maxTokens: 800,
  effort: "low",
  ...over,
});

describe("ClaudeProvider request", () => {
  it("caches the stable system prompt and sends only the fields these models allow", async () => {
    const f = fakeClient(reply());
    const p = new ClaudeProvider({ client: f.client });
    const params = p.buildParams(req());
    expect(params.system).toEqual([{ type: "text", text: "Stable instructions.", cache_control: { type: "ephemeral" } }]);
    expect(params.output_config).toEqual({ effort: "low" });
    for (const banned of ["thinking", "temperature", "top_p", "top_k", "tool_choice"]) expect(params).not.toHaveProperty(banned);
    expect(params.max_tokens).toBe(800);
  });

  it("asks for structured output with output_config.format and strict tools", () => {
    const p = new ClaudeProvider({ client: fakeClient(reply()).client });
    const params = p.buildParams(
      req({ jsonSchema: { type: "object", properties: { a: { type: "string" } } }, tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }] }),
    );
    expect(params.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema: { type: "object", properties: { a: { type: "string" } } } } });
    expect((params.tools as { strict: boolean }[])[0]!.strict).toBe(true);
  });

  it("uses the plain API for the light tier and the beta API with the default fallback for Opus 5.5", async () => {
    const light = fakeClient(reply());
    await new ClaudeProvider({ client: light.client }).complete(req());
    expect(light.plain).toHaveBeenCalledTimes(1);
    expect(light.beta).not.toHaveBeenCalled();

    const opus = fakeClient(reply({ model: "claude-opus-5-5" }));
    await new ClaudeProvider({ client: opus.client }).complete(req({ model: "claude-opus-5-5", tier: "standard", effort: "medium" }));
    expect(opus.plain).not.toHaveBeenCalled();
    const sent = (opus.beta.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(sent.betas).toEqual([FALLBACK_BETA]);
    expect(sent.fallbacks).toBe("default");
    expect(sent.model).toBe("claude-opus-5-5");

    const sonnet = fakeClient(reply({ model: "claude-sonnet-5-5" }));
    await new ClaudeProvider({ client: sonnet.client }).complete(req({ model: "claude-sonnet-5-5", tier: "standard" }));
    expect(sonnet.plain).toHaveBeenCalledTimes(1);

    const off = fakeClient(reply());
    await new ClaudeProvider({ client: off.client, refusalFallback: false }).complete(req({ model: "claude-opus-5-5" }));
    expect(off.plain).toHaveBeenCalledTimes(1);
  });
});

describe("ClaudeProvider response", () => {
  it("reads text and usage including cache tokens", async () => {
    const r = await new ClaudeProvider({ client: fakeClient(reply()).client }).complete(req());
    expect(r.stopReason).toBe("end_turn");
    expect(r.text).toBe("OK");
    expect(r.segments).toEqual([{ model: "claude-haiku-5-5", usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 400, cacheWriteTokens: 50 } }]);
  });

  it("checks stop_reason first: a refusal has no text to read", async () => {
    const r = await new ClaudeProvider({ client: fakeClient(reply({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" }, content: [] })).client }).complete(req());
    expect(r.stopReason).toBe("refusal");
    expect(r.refusalCategory).toBe("cyber");
    expect(r.text).toBe("");
  });

  it("reports max_tokens, tool calls and keeps only text and tool_use for the next turn (no thinking blocks)", async () => {
    const cut = await new ClaudeProvider({ client: fakeClient(reply({ stop_reason: "max_tokens" })).client }).complete(req());
    expect(cut.stopReason).toBe("max_tokens");

    const tool = await new ClaudeProvider({
      client: fakeClient(
        reply({
          stop_reason: "tool_use",
          content: [
            { type: "thinking", thinking: "", signature: "x" },
            { type: "text", text: "Let me look." },
            { type: "tool_use", id: "tu1", name: "sales", input: { day: "today" } },
          ],
        }),
      ).client,
    }).complete(req());
    expect(tool.stopReason).toBe("tool_use");
    expect(tool.toolUses).toEqual([{ id: "tu1", name: "sales", input: { day: "today" } }]);
    expect(tool.assistant.map((b) => b.type)).toEqual(["text", "tool_use"]);
  });

  it("prices every attempt when a fallback model served the request", async () => {
    const usage = {
      input_tokens: 100,
      output_tokens: 50,
      iterations: [
        { type: "message", model: "claude-opus-5-5", input_tokens: 100, output_tokens: 0 },
        { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 100, output_tokens: 50 },
      ],
    };
    const r = await new ClaudeProvider({ client: fakeClient(reply({ model: "claude-opus-4-8", usage })).client }).complete(req({ model: "claude-opus-5-5" }));
    expect(r.fallbackUsed).toBe(true);
    expect(r.segments.map((s) => s.model)).toEqual(["claude-opus-5-5", "claude-opus-4-8"]);
    expect(segmentsOf("a", "b", { input_tokens: 1, output_tokens: 2 })).toEqual([{ model: "b", usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 } }]);
  });
});

describe("provider selection", () => {
  it("uses the mock with no key outside production, and none (503) in production", () => {
    expect(resolveAiConfig({ NODE_ENV: "development" }).providerKind).toBe("mock");
    expect(resolveAiConfig({ NODE_ENV: "test" }).providerKind).toBe("mock");
    const prod = resolveAiConfig({ NODE_ENV: "production" });
    expect(prod.provider).toBeNull();
    expect(prod.enabled).toBe(false);
  });

  it("uses Claude when a key is set, unless the mock is forced", () => {
    const f = fakeClient(reply());
    expect(resolveAiConfig({ NODE_ENV: "production", ANTHROPIC_API_KEY: "sk-x", AI_ENABLED: true }, { client: f.client }).providerKind).toBe("claude");
    expect(resolveAiConfig({ NODE_ENV: "development", ANTHROPIC_API_KEY: "sk-x", AI_PROVIDER: "mock" }).providerKind).toBe("mock");
  });

  it("routes tiers to models from the environment, with the documented defaults", () => {
    expect(resolveAiConfig({}).models).toEqual({ light: "claude-haiku-5-5", standard: "claude-opus-5-5", vision: "claude-opus-5-5" });
    const c = resolveAiConfig({ AI_MODEL_STANDARD: "claude-sonnet-5-5", AI_MODEL_VISION: "claude-sonnet-5-5" });
    expect(c.models).toEqual({ light: "claude-haiku-5-5", standard: "claude-sonnet-5-5", vision: "claude-sonnet-5-5" });
  });

  it("the kill switch defaults on in development and off in production", () => {
    expect(resolveAiConfig({ NODE_ENV: "development" }).enabled).toBe(true);
    expect(resolveAiConfig({ NODE_ENV: "development", AI_ENABLED: false }).enabled).toBe(false);
    expect(resolveAiConfig({ NODE_ENV: "production", ANTHROPIC_API_KEY: "k", AI_ENABLED: true }).enabled).toBe(true);
  });
});
