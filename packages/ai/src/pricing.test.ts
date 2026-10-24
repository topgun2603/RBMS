import { describe, expect, it } from "vitest";
import { addUsage, costMicroUsd, creditsForCost, creditsToInr, CREDIT_MICRO_USD, rateFor, segmentsCost, ZERO_USAGE } from "./pricing";

describe("pricing", () => {
  it("costs tokens at the model rate: $/MTok equals micro-USD per token", () => {
    // Opus 5.5: $4 in, $20 out. 2,000 in + 500 out = 8,000 + 10,000 micro-USD = $0.018
    expect(costMicroUsd("claude-opus-5-5", { ...ZERO_USAGE, inputTokens: 2000, outputTokens: 500 })).toBe(18_000);
    // Haiku 5.5: $0.10 in, $0.50 out.
    expect(costMicroUsd("claude-haiku-5-5", { ...ZERO_USAGE, inputTokens: 1000, outputTokens: 200 })).toBe(200);
  });

  it("bills cache reads cheaply and cache writes at 1.25x input", () => {
    const u = { inputTokens: 100, outputTokens: 0, cacheReadTokens: 10_000, cacheWriteTokens: 1000 };
    // 100*4 + 10000*0.2 + 1000*5
    expect(costMicroUsd("claude-opus-5-5", u)).toBe(400 + 2000 + 5000);
  });

  it("rates the sonnet tier and never undercharges an unknown model", () => {
    expect(rateFor("claude-sonnet-5-5").input).toBe(2);
    expect(rateFor("claude-sonnet-5-6").input).toBe(2);
    expect(rateFor("claude-haiku-9").output).toBe(0.5);
    expect(rateFor("something-new")).toEqual(rateFor("claude-opus-5-5"));
  });

  it("turns cost into credits: 1 credit = $0.001, rounded up, at least 1 when anything was used", () => {
    expect(CREDIT_MICRO_USD).toBe(1000);
    expect(creditsForCost(0)).toBe(0);
    expect(creditsForCost(3)).toBe(1);
    expect(creditsForCost(1000)).toBe(1);
    expect(creditsForCost(1001)).toBe(2);
    expect(creditsForCost(18_000)).toBe(18);
  });

  it("sums the attempts of a fallback run at each model's own rate", () => {
    const u = { ...ZERO_USAGE, inputTokens: 1000, outputTokens: 100 };
    expect(segmentsCost([{ model: "claude-opus-5-5", usage: u }, { model: "claude-haiku-5-5", usage: u }])).toBe(costMicroUsd("claude-opus-5-5", u) + costMicroUsd("claude-haiku-5-5", u));
    expect(addUsage(u, u).inputTokens).toBe(2000);
  });

  it("shows credits in rupees (display only)", () => {
    // 1,000 credits = $1 = Rs 85
    expect(creditsToInr(1000, 85)).toBeCloseTo(85);
    expect(creditsToInr(2000)).toBeCloseTo(170);
  });
});
