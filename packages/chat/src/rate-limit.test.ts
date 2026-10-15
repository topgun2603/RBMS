import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  it("allows 20 per minute per key, sliding", () => {
    let now = 0;
    const rl = new RateLimiter(20, 60_000, () => now);
    for (let i = 0; i < 20; i++) {
      expect(rl.hit("u1").allowed).toBe(true);
      now += 1000; // one per second: t = 0..19 s
    }
    const refused = rl.hit("u1");
    expect(refused).toEqual({ allowed: false, remaining: 0, retryAfterMs: 40_000 }); // first hit at 0 expires at 60 s
    expect(rl.hit("u2").allowed).toBe(true); // other users unaffected
    now = 60_000; // the t=0 hit has left the window
    expect(rl.hit("u1")).toMatchObject({ allowed: true, remaining: 0 });
    expect(rl.hit("u1").allowed).toBe(false);
    now = 61_000;
    expect(rl.hit("u1").allowed).toBe(true);
  });

  it("refused attempts don't extend the block", () => {
    let now = 0;
    const rl = new RateLimiter(2, 1000, () => now);
    rl.hit("k");
    rl.hit("k");
    for (let i = 0; i < 10; i++) expect(rl.hit("k").allowed).toBe(false);
    now = 1000;
    expect(rl.hit("k").allowed).toBe(true);
  });

  it("forgets idle keys", () => {
    let now = 0;
    const rl = new RateLimiter(5, 1000, () => now);
    rl.hit("a");
    rl.hit("b");
    expect(rl.size).toBe(2);
    now = 5000;
    rl.hit("c");
    expect(rl.size).toBe(1);
  });
});
