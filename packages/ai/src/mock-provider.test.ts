import { describe, expect, it } from "vitest";
import { MOCK_MARKERS, MockProvider, sampleFor } from "./mock-provider";
import type { ProviderRequest } from "./types";

const req = (text: string, over: Partial<ProviderRequest> = {}): ProviderRequest => ({
  model: "claude-haiku-5-5",
  tier: "light",
  system: "You help a shop.",
  messages: [{ role: "user", content: [{ type: "text", text }] }],
  maxTokens: 1000,
  effort: "low",
  ...over,
});

describe("MockProvider", () => {
  it("is deterministic: the same input gives the same output and usage", async () => {
    const m = new MockProvider();
    const a = await m.complete(req("hello shop"));
    const b = await m.complete(req("hello shop"));
    expect(a).toEqual(b);
    expect(a.text).toBe("[Mock AI] hello shop");
    expect(a.stopReason).toBe("end_turn");
    expect(a.segments[0]!.usage.inputTokens).toBeGreaterThan(0);
    expect(m.kind).toBe("mock");
  });

  it("answers ping with OK", async () => {
    expect((await new MockProvider().complete(req("ping"))).text).toBe("OK");
  });

  it("returns a sample object for a JSON schema", async () => {
    const schema = {
      type: "object",
      properties: { hsn: { type: "string" }, rate: { type: "integer" }, kind: { type: "string", enum: ["goods", "service"] }, tags: { type: "array", items: { type: "string" } }, note: { type: ["string", "null"] } },
      required: ["hsn", "rate", "kind", "tags"],
    };
    const r = await new MockProvider().complete(req("rice", { jsonSchema: schema }));
    expect(JSON.parse(r.text)).toEqual({ hsn: "Sample", rate: 0, kind: "goods", tags: [] });
    expect(sampleFor({ type: "boolean" })).toBe(false);
  });

  it("calls the first tool once, then answers", async () => {
    const m = new MockProvider();
    const tool = { name: "sales_today", description: "d", input_schema: { type: "object" as const, properties: { shop: { type: "string" } }, required: ["shop"] } };
    const first = await m.complete(req("sales?", { tools: [tool] }));
    expect(first.stopReason).toBe("tool_use");
    expect(first.toolUses[0]).toMatchObject({ name: "sales_today", input: { shop: "Sample" } });
    const second = await m.complete({
      ...req("sales?", { tools: [tool] }),
      messages: [
        { role: "user", content: "sales?" },
        { role: "assistant", content: first.assistant },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_mock_1", content: "123" }] },
      ],
    });
    expect(second.stopReason).toBe("end_turn");
  });

  it("misbehaves on request so error paths can be tried", async () => {
    const m = new MockProvider();
    expect((await m.complete(req(`x ${MOCK_MARKERS.refuse}`))).stopReason).toBe("refusal");
    expect((await m.complete(req(`x ${MOCK_MARKERS.truncate}`))).stopReason).toBe("max_tokens");
    await expect(m.complete(req(`x ${MOCK_MARKERS.fail}`))).rejects.toThrow("mock provider failure");
  });

  it("takes scripted responders first", async () => {
    const m = new MockProvider().respond((r) => (r.system.includes("HSN") ? "6109" : null));
    expect((await m.complete(req("t-shirt", { system: "Suggest HSN" }))).text).toBe("6109");
    expect((await m.complete(req("t-shirt"))).text).toContain("[Mock AI]");
  });
});
