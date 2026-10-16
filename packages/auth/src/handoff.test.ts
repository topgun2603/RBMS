import { describe, expect, it } from "vitest";
import { handoffLoginUrl } from "./routes";
import { HANDOFF_TTL_SECONDS } from "./service";

describe("login handoff", () => {
  it("lives for 60 seconds", () => {
    expect(HANDOFF_TTL_SECONDS).toBe(60);
  });
  it("builds the shop app's login URL with the code", () => {
    expect(handoffLoginUrl("http://acme.localhost:3001", "abc_DEF-123")).toBe("http://acme.localhost:3001/login?handoff=abc_DEF-123");
    expect(handoffLoginUrl("http://acme.localhost:3002/billing/", "c0de")).toBe("http://acme.localhost:3002/billing/login?handoff=c0de");
    expect(handoffLoginUrl("https://acme.srikit.in/?x=1", "c")).toBe("https://acme.srikit.in/login?x=1&handoff=c");
  });
});
