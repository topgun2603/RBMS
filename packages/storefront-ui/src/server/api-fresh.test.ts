import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "cauvery.localhost:3003"]]),
  cookies: async () => ({ get: () => undefined }),
}));

const { apiGetFresh } = await import("./api");

type Init = RequestInit & { next?: { revalidate?: number }; cache?: string };

function mockFetch(answers: (() => Response)[]) {
  const calls: Init[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: Init) => {
      calls.push(init);
      return answers.shift()!();
    }),
  );
  return calls;
}
const json = (v: unknown, status = 200) => () => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("apiGetFresh: empty answers never stick in the cache", () => {
  const empty = (v: { total: number } | null) => !v?.total;

  it("a non-empty cached answer is used as is (one cached request)", async () => {
    const calls = mockFetch([json({ total: 12 })]);
    expect(await apiGetFresh("/catalog/public/search", null, empty, { revalidate: 300 })).toEqual({ total: 12 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.next?.revalidate).toBe(300);
  });

  it("an empty cached answer is checked once more without the cache", async () => {
    const calls = mockFetch([json({ total: 0 }), json({ total: 9 })]);
    expect(await apiGetFresh("/catalog/public/search", null, empty, { revalidate: 300 })).toEqual({ total: 9 });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.cache).toBe("no-store");
    expect(calls[1]!.next).toBeUndefined();
  });

  it("an upstream error falls back (and is retried uncached), never throws", async () => {
    const calls = mockFetch([json({ error: { code: "x" } }, 502), json({ error: { code: "x" } }, 503)]);
    expect(await apiGetFresh("/cms/public/home", { sections: [] as unknown[] }, (h) => !h.sections.length)).toEqual({ sections: [] });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.cache).toBe("no-store");
  });
});
