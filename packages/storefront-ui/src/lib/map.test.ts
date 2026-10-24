import { describe, expect, it } from "vitest";
import { osmEmbedUrl } from "./map";

describe("osmEmbedUrl", () => {
  it("builds a clean bbox (no float noise) and marker", () => {
    expect(osmEmbedUrl({ lat: 9.9165, lng: 78.1139 })).toBe(
      "https://www.openstreetmap.org/export/embed.html?bbox=78.1079%2C9.9105%2C78.1199%2C9.9225&layer=mapnik&marker=9.9165%2C78.1139",
    );
  });
  it("rejects missing or out-of-range pins", () => {
    expect(osmEmbedUrl(null)).toBeNull();
    expect(osmEmbedUrl({ lat: 91, lng: 0 })).toBeNull();
    expect(osmEmbedUrl({ lat: Number.NaN, lng: 0 })).toBeNull();
  });
});
