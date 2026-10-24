import Anthropic from "@anthropic-ai/sdk";
import { AppError } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resolveAiConfig } from "./config";
import { AI_SETTINGS_DEFAULTS, type AiSettings } from "./features";
import { MOCK_MARKERS, MockProvider } from "./mock-provider";
import { AiService, monthKey, toAppError, type CreditBalance, type CreditsPort } from "./service";
import type { AiProvider, AiRunRequest, ProviderRequest } from "./types";

const T = "11111111-1111-4111-8111-111111111111";

/** Only what run() uses of the database: insert(...).values(row). */
function fakeDb() {
  const rows: Record<string, unknown>[] = [];
  const db = { insert: () => ({ values: async (r: Record<string, unknown>) => void rows.push(r) }) } as unknown as Db;
  return { db, rows };
}

/** In-memory credits: a monthly allowance first, then top-up packs, like the plans module. */
function fakeCredits(start: { allowance?: number; topUp?: number; unlimited?: boolean } = {}) {
  const s = { allowance: start.allowance ?? 100, used: 0, topUp: start.topUp ?? 0, unlimited: start.unlimited ?? false };
  const balance = async (): Promise<CreditBalance> => ({
    period: "2026-10",
    unlimited: s.unlimited,
    allowance: s.allowance,
    allowanceUsed: s.used,
    topUp: s.topUp,
    remaining: s.unlimited ? null : Math.max(0, s.allowance - s.used) + s.topUp,
  });
  const charge = vi.fn(async (_t: string, credits: number) => {
    if (s.unlimited) {
      s.used += credits;
      return credits;
    }
    const fromAllowance = Math.min(credits, Math.max(0, s.allowance - s.used));
    s.used += fromAllowance;
    const fromTop = Math.min(credits - fromAllowance, s.topUp);
    s.topUp -= fromTop;
    return fromAllowance + fromTop;
  });
  return { port: { balance, charge } as CreditsPort, state: s, charge };
}

function setup(opts: { settings?: Partial<AiSettings>; credits?: Parameters<typeof fakeCredits>[0]; provider?: AiProvider | null; featureOn?: boolean; env?: Parameters<typeof resolveAiConfig>[0] } = {}) {
  const { db, rows } = fakeDb();
  const credits = fakeCredits(opts.credits);
  const mock = new MockProvider();
  const config = resolveAiConfig({ NODE_ENV: "test", ...opts.env }, { mock });
  if (opts.provider !== undefined) config.provider = opts.provider;
  const settings: AiSettings = { ...AI_SETTINGS_DEFAULTS, enabled: true, ...opts.settings };
  const log = { warn: vi.fn(), error: vi.fn() };
  const service = new AiService({
    db,
    config,
    settings: { get: async () => settings },
    featureOn: async () => opts.featureOn ?? true,
    credits: credits.port,
    log,
    now: () => new Date("2026-10-24T06:00:00Z"),
  });
  return { service, rows, credits, mock, log };
}

const base = (over: Partial<AiRunRequest<unknown>> = {}): AiRunRequest<unknown> => ({
  tenantId: T,
  feature: "hsn-suggest",
  tier: "light",
  system: "Suggest an HSN code.",
  input: { text: "cotton t-shirt" },
  ...over,
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return (e as AppError).code;
  }
  return "no error";
};

describe("ai.run: switches", () => {
  it("is off until the owner switches it on, and records the block (no model call)", async () => {
    const s = setup({ settings: { enabled: false } });
    expect(await code(s.service.run(base()))).toBe("ai_off");
    expect(s.mock.calls).toHaveLength(0);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ status: "blocked", errorCode: "ai_off", credits: 0, tenantId: T });
  });

  it("respects the per-helper switch; a helper not listed follows the master switch", async () => {
    const s = setup({ settings: { features: { "hsn-suggest": false } } });
    expect(await code(s.service.run(base()))).toBe("ai_feature_off");
    const err = await s.service.run(base({ feature: "ask-shop" })).catch((e) => e);
    expect(err).not.toBeInstanceOf(Error);
  });

  it("the platform kill switch blocks everything", async () => {
    const s = setup({ env: { AI_ENABLED: false } });
    expect(await code(s.service.run(base()))).toBe("ai_disabled");
    expect(s.mock.calls).toHaveLength(0);
  });

  it("answers ai_unavailable (503) when there is no provider, e.g. production without a key", async () => {
    const s = setup({ provider: null });
    const e = await s.service.run(base()).catch((x) => x as AppError);
    expect((e as AppError).status).toBe(503);
    expect((e as AppError).code).toBe("ai_unavailable");
  });

  it("is blocked when the plan or the Features switch does not give the shop AI", async () => {
    const s = setup({ featureOn: false });
    expect(await code(s.service.run(base()))).toBe("ai_not_available");
  });
});

describe("ai.run: credits", () => {
  it("answers 402 ai_credits_exhausted with a friendly message when nothing is left", async () => {
    const s = setup({ credits: { allowance: 10 } });
    s.credits.state.used = 10;
    const e = (await s.service.run(base()).catch((x) => x)) as AppError;
    expect(e.status).toBe(402);
    expect(e.code).toBe("ai_credits_exhausted");
    expect(e.message).toMatch(/credit/i);
    expect(s.mock.calls).toHaveLength(0);
    expect(s.rows[0]).toMatchObject({ status: "blocked", errorCode: "ai_credits_exhausted" });
  });

  it("charges the actual usage after the run and records it", async () => {
    const s = setup();
    // Standard tier on the mock = Opus rates; a long input makes a visible cost.
    const r = await s.service.run(base({ tier: "standard", input: { text: "x".repeat(8000) } }));
    expect(r.credits).toBeGreaterThan(1);
    expect(s.credits.charge).toHaveBeenCalledWith(T, r.credits);
    expect(s.credits.state.used).toBe(r.credits);
    expect(s.rows[0]).toMatchObject({ status: "ok", credits: r.credits, tier: "standard", model: "claude-opus-5-5", provider: "mock" });
    expect(r.usage.inputTokens).toBeGreaterThan(1900);
  });

  it("a tiny light-tier run costs 1 credit", async () => {
    const s = setup();
    expect((await s.service.run(base())).credits).toBe(1);
  });

  it("uses the monthly allowance first, then top-up credits", async () => {
    const s = setup({ credits: { allowance: 1, topUp: 50 } });
    await s.service.run(base());
    expect(s.credits.state).toMatchObject({ used: 1, topUp: 50 });
    await s.service.run(base());
    expect(s.credits.state.topUp).toBe(49);
    // allowance gone, top-up still lets the run start
    expect((await s.credits.port.balance(T)).remaining).toBe(49);
  });

  it("never charges more than the shop has left", async () => {
    const s = setup({ credits: { allowance: 3 } });
    const r = await s.service.run(base({ tier: "standard", input: { text: "x".repeat(40_000) } }));
    expect(r.credits).toBe(3);
    expect((await s.credits.port.balance(T)).remaining).toBe(0);
  });

  it("unlimited plans keep running", async () => {
    const s = setup({ credits: { unlimited: true } });
    await s.service.run(base());
    await s.service.run(base());
    expect(s.credits.state.used).toBe(2);
  });

  it("the month key rolls over at IST midnight, so the allowance resets without a cron", () => {
    expect(monthKey(new Date("2026-10-31T18:29:00Z"))).toBe("2026-10");
    expect(monthKey(new Date("2026-10-31T18:31:00Z"))).toBe("2026-11");
    const s = setup();
    return s.service.run(base()).then(() => expect(s.rows[0]!.period).toBe("2026-10"));
  });
});

describe("ai.run: privacy", () => {
  it("masks phones and emails before the model sees them, and GSTIN when the shop asks", async () => {
    const s = setup({ settings: { maskGstin: true } });
    await s.service.run(base({ input: { text: "Ravi 9876543210 ravi@gmail.com 33ABCDE1234F1Z5" } }));
    const sent = JSON.stringify(s.mock.calls[0]!.messages);
    expect(sent).toContain("XXXXXX3210");
    expect(sent).toContain("r***@gmail.com");
    expect(sent).toContain("33XXXXXXXXXX1Z5");
    expect(sent).not.toContain("9876543210");
  });

  it("can send as written only when the caller says so", async () => {
    const s = setup();
    await s.service.run(base({ input: { text: "call 9876543210" }, mask: false }));
    expect(JSON.stringify(s.mock.calls[0]!.messages)).toContain("9876543210");
  });

  it("stores no prompt or reply text by default, and a masked copy only when the shop turns debugging on", async () => {
    const off = setup();
    await off.service.run(base({ input: { text: "secret rice price 9876543210" } }));
    expect(off.rows[0]!.debug).toBeNull();
    expect(JSON.stringify(off.rows[0])).not.toContain("secret");

    const on = setup({ settings: { storePrompts: true } });
    await on.service.run(base({ input: { text: "secret rice price 9876543210" } }));
    expect(on.rows[0]!.debug).toEqual({ input: "secret rice price XXXXXX3210", output: expect.stringContaining("[Mock AI]") });
  });

  it("only the caller's tenant is recorded", async () => {
    const s = setup();
    await s.service.run(base({ userId: "u1" }));
    expect(s.rows[0]).toMatchObject({ tenantId: T, userId: "u1" });
  });
});

describe("ai.run: output", () => {
  const schema = (zod = z.object({ hsn: z.string(), rate: z.number() })) => ({
    name: "hsn",
    jsonSchema: { type: "object", properties: { hsn: { type: "string" }, rate: { type: "number" } }, required: ["hsn", "rate"] },
    zod,
  });

  it("returns a validated object for a schema run", async () => {
    const s = setup();
    s.mock.respond(() => JSON.stringify({ hsn: "6109", rate: 5 }));
    const r = await s.service.run({ ...base(), schema: schema() });
    expect(r.output).toEqual({ hsn: "6109", rate: 5 });
    expect(s.mock.calls[0]!.jsonSchema).toBeDefined();
  });

  it("rejects an answer that fails the schema, and still charges and records it", async () => {
    const s = setup();
    s.mock.respond(() => JSON.stringify({ hsn: 6109 }));
    expect(await code(s.service.run({ ...base(), schema: schema() }))).toBe("ai_invalid_output");
    expect(s.rows[0]).toMatchObject({ status: "error", errorCode: "ai_invalid_output" });
    expect(s.rows[0]!.credits).toBeGreaterThan(0);
  });

  it("rejects text that is not JSON", async () => {
    const s = setup();
    expect(await code(s.service.run({ ...base({ input: { text: `x ${MOCK_MARKERS.badJson}` } }), schema: schema() }))).toBe("ai_invalid_output");
  });

  it("handles a refusal before reading content", async () => {
    const s = setup();
    const e = (await s.service.run(base({ input: { text: `hi ${MOCK_MARKERS.refuse}` } })).catch((x) => x)) as AppError;
    expect(e.code).toBe("ai_refused");
    expect(e.status).toBe(422);
    expect(s.rows[0]).toMatchObject({ status: "refused" });
  });

  it("reports a reply cut off by max_tokens instead of returning half an answer", async () => {
    const s = setup();
    const e = (await s.service.run(base({ input: { text: `hi ${MOCK_MARKERS.truncate}` } })).catch((x) => x)) as AppError;
    expect(e.code).toBe("ai_truncated");
    expect(s.rows[0]).toMatchObject({ status: "error", errorCode: "ai_truncated" });
  });

  it("sends images and PDFs only on the vision tier", async () => {
    const s = setup();
    const img = { mediaType: "image/jpeg" as const, data: "AAAA" };
    await expect(s.service.run(base({ input: { images: [img] } }))).rejects.toMatchObject({ code: "bad_request" });
    await s.service.run(base({ tier: "vision", input: { text: "read this bill", images: [img], pdfs: [{ data: "BBBB" }] } }));
    const content = s.mock.calls[0]!.messages[0]!.content as { type: string }[];
    expect(content.map((b) => b.type)).toEqual(["image", "document", "text"]);
    expect(s.mock.calls[0]!.model).toBe("claude-opus-5-5");
  });

  it("routes each tier to its configured model", async () => {
    const s = setup({ env: { AI_MODEL_STANDARD: "claude-sonnet-5-5" } });
    await s.service.run(base({ tier: "light" }));
    await s.service.run(base({ tier: "standard" }));
    expect(s.mock.calls.map((c: ProviderRequest) => c.model)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    expect(s.mock.calls.map((c: ProviderRequest) => c.effort)).toEqual(["low", "medium"]);
  });
});

describe("ai.run: provider errors", () => {
  const failing = (e: unknown): AiProvider => ({ kind: "claude", complete: async () => Promise.reject(e) });

  it("maps typed SDK errors to plain answers and records an error run", async () => {
    const rate = Anthropic.APIError.generate(429, { type: "error", error: { type: "rate_limit_error", message: "slow" } }, "slow", new Headers());
    expect(rate).toBeInstanceOf(Anthropic.RateLimitError);
    expect(toAppError(rate).code).toBe("ai_busy");
    const auth = Anthropic.APIError.generate(401, {}, "bad key", new Headers());
    expect(toAppError(auth).code).toBe("ai_unavailable");
    expect(toAppError(Anthropic.APIError.generate(529, {}, "overloaded", new Headers())).code).toBe("ai_busy");
    expect(toAppError(Anthropic.APIError.generate(402, {}, "billing", new Headers())).code).toBe("ai_unavailable");
    expect(toAppError(Anthropic.APIError.generate(400, {}, "bad", new Headers())).code).toBe("ai_failed");
    expect(toAppError(new Error("boom")).code).toBe("ai_failed");

    const s = setup({ provider: failing(rate) });
    expect(await code(s.service.run(base()))).toBe("ai_busy");
    expect(s.rows[0]).toMatchObject({ status: "error", errorCode: "ai_busy", credits: 0 });
    expect(s.log.warn).toHaveBeenCalled();
  });

  it("does not leak the provider's message to the shop", async () => {
    const s = setup({ provider: failing(new Error("sk-ant-secret exploded")) });
    const e = (await s.service.run(base()).catch((x) => x)) as AppError;
    expect(e.message).not.toContain("sk-ant");
  });
});

describe("ai.run: tools", () => {
  const tool = (run: (i: Record<string, unknown>) => Promise<string | object>) => ({
    name: "sales_today",
    description: "Total sales today",
    inputSchema: { type: "object" as const, properties: { shop: { type: "string" } }, required: ["shop"] },
    run,
  });

  it("loops: model asks for a tool, the result goes back, then the final answer", async () => {
    const s = setup();
    const run = vi.fn(async () => ({ total: 12345 }));
    const r = await s.service.run(base({ tier: "standard", tools: [tool(run)] }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(s.mock.calls).toHaveLength(2);
    expect(JSON.stringify(s.mock.calls[1]!.messages)).toContain("12345");
    expect(r.output).toContain("[Mock AI]");
    expect(s.rows[0]).toMatchObject({ steps: 2, status: "ok" });
  });

  it("a failing tool is reported to the model, not thrown", async () => {
    const s = setup();
    await s.service.run(base({ tools: [tool(async () => Promise.reject(new Error("no access")))] }));
    expect(JSON.stringify(s.mock.calls[1]!.messages)).toContain("no access");
    expect(JSON.stringify(s.mock.calls[1]!.messages)).toContain("is_error");
  });

  it("stops a runaway loop at maxSteps", async () => {
    // A provider that always asks for the tool again.
    const loop: AiProvider = {
      kind: "mock",
      complete: async (req) => ({
        model: req.model,
        stopReason: "tool_use",
        text: "",
        toolUses: [{ id: "t", name: "sales_today", input: {} }],
        assistant: [{ type: "tool_use", id: "t", name: "sales_today", input: {} }],
        segments: [{ model: req.model, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } }],
      }),
    };
    const s2 = setup({ provider: loop });
    const run = vi.fn(async () => "x");
    expect(await code(s2.service.run(base({ tools: [tool(run)], maxSteps: 3 })))).toBe("ai_too_many_steps");
    expect(run).toHaveBeenCalledTimes(2);
    expect(s2.rows[0]).toMatchObject({ status: "error", errorCode: "ai_too_many_steps", steps: 3 });
  });

  it("stops calling the model once the shop's credits would run out mid-loop", async () => {
    const big: AiProvider = {
      kind: "mock",
      complete: async (req) => ({
        model: "claude-opus-5-5",
        stopReason: "tool_use",
        text: "",
        toolUses: [{ id: "t", name: "sales_today", input: {} }],
        assistant: [{ type: "tool_use", id: "t", name: "sales_today", input: {} }],
        segments: [{ model: "claude-opus-5-5", usage: { inputTokens: 50_000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 } }],
      }),
    };
    const s = setup({ provider: big, credits: { allowance: 20 } });
    expect(await code(s.service.run(base({ tier: "standard", tools: [tool(async () => "x")] })))).toBe("ai_credits_exhausted");
    expect(s.rows[0]).toMatchObject({ steps: 1, errorCode: "ai_credits_exhausted" });
  });
});
