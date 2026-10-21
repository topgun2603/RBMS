import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("@srirealtime/web", async (orig) => {
  const real = await orig<typeof import("@srirealtime/web")>();
  const api = Object.assign(vi.fn(), real.api, { get: (...args: unknown[]) => get(...args) });
  return { ...real, api };
});

const lib = await import("./media-library");
const { MEDIA_LIMITS, brandStockColors, checkMediaFile, mediaKeys, mediaListOptions, mediaListParams, shopTrade, stockGroup, stockItems } = lib;

const file = (id: string) => ({ id, originalName: `${id}.webp`, contentType: "image/webp", size: 10, width: 1, height: 1, url: `http://api/f/${id}`, thumbUrl: null, createdAt: "2026-10-21T00:00:00Z" });

describe("media library list", () => {
  beforeEach(() => get.mockReset());

  it("asks for public files of a kind, trimmed search, and the cursor", () => {
    expect(mediaListParams("image", "")).toEqual({ kind: "image", visibility: "public", limit: 24 });
    expect(mediaListParams("video", "  saree ", "abc")).toEqual({ kind: "video", visibility: "public", limit: 24, q: "saree", cursor: "abc" });
    expect(mediaKeys.list("image", "x")[0]).toBe(mediaKeys.all[0]);
  });

  it("pages with nextCursor until the last page", async () => {
    get.mockResolvedValueOnce({ items: [file("a"), file("b")], nextCursor: "c1" }).mockResolvedValueOnce({ items: [file("c")], nextCursor: null });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const opts = mediaListOptions("image", " kanchi ");
    const data = await qc.fetchInfiniteQuery({ ...opts, pages: 2 });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenNthCalledWith(1, "/uploads", { kind: "image", visibility: "public", limit: 24, q: "kanchi" });
    expect(get).toHaveBeenLastCalledWith("/uploads", { kind: "image", visibility: "public", limit: 24, q: "kanchi", cursor: "c1" });
    expect(data.pages.flatMap((p) => p.items.map((f) => f.id))).toEqual(["a", "b", "c"]);
    expect(opts.getNextPageParam(data.pages[1]!, data.pages, null, [null])).toBeNull();
    expect(opts.queryKey).toEqual(["site", "media", "image", "kanchi"]);
  });
});

describe("checkMediaFile", () => {
  it("accepts images up to 10 MB and MP4 / WebM up to 50 MB", () => {
    expect(checkMediaFile({ type: "image/jpeg", size: 1000 }, "image")).toBeNull();
    expect(checkMediaFile({ type: "image/jpeg", size: MEDIA_LIMITS.image + 1 }, "image")).toBe("size");
    expect(checkMediaFile({ type: "application/pdf", size: 10 }, "image")).toBe("type");
    expect(checkMediaFile({ type: "video/webm", size: 40 * 1024 * 1024 }, "video")).toBeNull();
    expect(checkMediaFile({ type: "video/quicktime", size: 10 }, "video")).toBe("type");
    expect(checkMediaFile({ type: "video/mp4", size: MEDIA_LIMITS.video + 1 }, "video")).toBe("size");
  });
});

describe("stock artwork for the shop", () => {
  it("lists eight pictures as API site paths with inline previews", () => {
    const items = stockItems("bakery", { primary: "#7c2d12", accent: "#fbe8ec", background: "#fffaf8" });
    expect(items).toHaveLength(8);
    expect(items[0]!.path).toBe("/v1/branding/stock/bakery/hero-1.svg?p=7c2d12&a=fbe8ec&b=fffaf8");
    expect(items.every((i) => i.preview.startsWith("data:image/svg+xml"))).toBe(true);
    expect(items.map((i) => i.group)).toEqual(["hero", "hero", "hero", "split", "split", "tile", "tile", "banner"]);
    expect(stockGroup("banner-1")).toBe("banner");
  });

  it("uses the shop's trade, else its app's default trade", () => {
    expect(shopTrade("jewellery", "EC")).toBe("jewellery");
    expect(shopTrade(null, "PH")).toBe("pharmacy");
    expect(shopTrade("unknown", "RS")).toBe("restaurant");
  });

  it("takes colours from the branding record", () => {
    expect(brandStockColors({ tokens: { colors: { primary: "#111111", accent: "#222222" } } })).toEqual({ primary: "#111111", accent: "#222222", background: null });
    expect(brandStockColors(undefined).primary).toBe("#7c3aed");
  });
});
