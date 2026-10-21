import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { STOCK_SIZES, STOCK_SLOTS, STOCK_TRADES, stockArtDataUrl, stockArtFor, stockArtPath, stockArtSvg, stockColorsFromQuery, stockPalette, tradeColors } from "./stock-art";
import { stockMotifs } from "./stock-motifs";
import { stockArtRoutes } from "./stock-routes";

/** Minimal well-formedness check: every tag closes in order, attributes are quoted, no stray '<'. */
function assertWellFormed(svg: string) {
  const stack: string[] = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    expect(svg.slice(last, m.index), "text between tags").not.toMatch(/[<>]/);
    last = re.lastIndex;
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) expect(stack.pop(), `closing </${name}>`).toBe(name);
    else stack.push(name!);
  }
  expect(svg.slice(last)).toBe("");
  expect(stack).toEqual([]);
}

const kanchi = { primary: "#8a1538", accent: "#f8ead0", background: "#fffaf2" };

describe("stock art", () => {
  it("every trade × slot is a well-formed, script-free SVG of the slot's size", () => {
    for (const trade of STOCK_TRADES)
      for (const slot of STOCK_SLOTS) {
        const svg = stockArtSvg(trade, slot, tradeColors(trade));
        const { w, h } = STOCK_SIZES[slot];
        expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"`)).toBe(true);
        expect(svg).not.toMatch(/<script|on\w+=|href=|<text|<image|NaN|undefined/i);
        assertWellFormed(svg);
        expect(svg.length).toBeLessThan(60_000);
      }
  });

  it("paints with the shop's brand colours", () => {
    const violet = stockArtSvg("fashion", "hero-1", { primary: "#7c3aed" });
    const teal = stockArtSvg("fashion", "hero-1", { primary: "#0f766e" });
    expect(violet).toContain("#7c3aed");
    expect(teal).toContain("#0f766e");
    expect(violet).not.toContain("#0f766e");
    const pal = stockPalette({ primary: "#7c3aed" });
    expect(violet).toContain(pal.soft);
    expect(violet).toContain(pal.deep);
  });

  it("handles dark themes and golden brands", () => {
    const dark = stockPalette({ primary: "#22d3ee", background: "#080d1a" });
    expect(dark.dark).toBe(true);
    expect(dark.paper).toBe("#080d1a");
    // A gold brand gets ruby velvet / gems so jewellery doesn't vanish into it.
    const gold = stockPalette({ primary: "#d4a64a", accent: "#2c141a", background: "#1a0b10" });
    expect(gold.gem).not.toBe("#d4a64a");
    assertWellFormed(stockArtSvg("jewellery", "tile-2", { primary: "#d4a64a", accent: "#2c141a", background: "#1a0b10" }));
  });

  it("is distinct per trade and per slot, and the same every time", () => {
    const heroes = STOCK_TRADES.map((t) => stockArtSvg(t, "hero-1", kanchi));
    expect(new Set(heroes).size).toBe(STOCK_TRADES.length);
    const slots = STOCK_SLOTS.map((s) => stockArtSvg("bakery", s, kanchi));
    expect(new Set(slots).size).toBe(STOCK_SLOTS.length);
    expect(stockArtSvg("gym", "tile-1", kanchi)).toBe(stockArtSvg("gym", "tile-1", kanchi));
    const names = STOCK_TRADES.flatMap((t) => stockMotifs(t).map((m) => m.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it("builds CMS-safe site paths and data URLs", () => {
    expect(stockArtPath("fashion", "hero-1", kanchi)).toBe("/v1/branding/stock/fashion/hero-1.svg?p=8a1538&a=f8ead0&b=fffaf2");
    expect(stockArtPath("gym", "tile-1")).toBe("/v1/branding/stock/gym/tile-1.svg");
    // The trade's own preset colours by default; unknown trades fall back to fashion.
    expect(stockArtFor("pharmacy", "hero-1")).toBe("/v1/branding/stock/pharmacy/hero-1.svg?p=047857&a=e3f5ee&b=f7fbfa");
    expect(stockArtFor("bakery", "split-1", { primary: "#123456" })).toBe("/v1/branding/stock/bakery/split-1.svg?p=123456");
    expect(stockArtFor("spaceship", "tile-1")).toMatch(/^\/v1\/branding\/stock\/fashion\/tile-1\.svg\?/);
    for (const t of STOCK_TRADES) expect(stockArtFor(t, "hero-1").length).toBeLessThan(1000);
    expect(stockArtDataUrl("salon", "tile-1", kanchi)).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  });

  it("reads colours back from the query, ignoring junk", () => {
    expect(stockColorsFromQuery("gym", { p: "AABBCC", a: "nothex", b: "ffffff" })).toEqual({ primary: "#aabbcc", accent: null, background: "#ffffff" });
    expect(stockColorsFromQuery("gym", { p: "<script>" })).toEqual(tradeColors("gym"));
  });
});

describe("GET /v1/branding/stock/:trade/:slot.svg", () => {
  async function app() {
    const a = Fastify();
    await a.register(stockArtRoutes(), { prefix: "/v1/branding" });
    return a;
  }

  it("serves the SVG with a strict CSP and long caching", async () => {
    const res = await (await app()).inject({ method: "GET", url: "/v1/branding/stock/optical/hero-2.svg?p=1d4ed8" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/svg+xml; charset=utf-8");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["cache-control"]).toContain("max-age=604800");
    expect(res.body).toContain("#1d4ed8");
  });

  it("404s unknown trades, slots and extensions", async () => {
    const a = await app();
    for (const url of ["/v1/branding/stock/nope/hero-1.svg", "/v1/branding/stock/gym/hero-9.svg", "/v1/branding/stock/gym/hero-1.png"])
      expect((await a.inject({ method: "GET", url })).statusCode).toBe(404);
  });
});
