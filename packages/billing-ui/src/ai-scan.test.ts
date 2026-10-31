import { ApiError } from "@rbms/web";
import { describe, expect, it } from "vitest";
import { scanErrorKind } from "./lib/ai-scan";
import { en, ta } from "./lib/messages/ai-scan";

describe("ai scan", () => {
  it("maps API errors to the message the owner sees", () => {
    const k = (status: number, code: string) => scanErrorKind(new ApiError(status, code, "x"));
    expect(k(403, "ai_off")).toBe("off");
    expect(k(403, "ai_feature_off")).toBe("off");
    expect(k(402, "ai_credits_exhausted")).toBe("credits");
    expect(k(422, "ai_unreadable_image")).toBe("unreadable");
    expect(k(400, "ai_bad_image")).toBe("badImage");
    expect(k(503, "ai_busy")).toBe("busy");
    expect(scanErrorKind(new Error("x"))).toBe("other");
  });
  it("has the same strings in English and Tamil", () => {
    expect(Object.keys(ta).sort()).toEqual(Object.keys(en).sort());
  });
});
