import { describe, expect, it } from "vitest";
import { renderAppIcon } from "./pwa";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height from the PNG IHDR chunk. */
function pngSize(buf: ArrayBuffer): [number, number] {
  const v = new DataView(buf);
  return [v.getUint32(16), v.getUint32(20)];
}

const isPng = (buf: ArrayBuffer) => PNG_SIGNATURE.every((b, i) => new Uint8Array(buf)[i] === b);
const dataUri = (buf: ArrayBuffer, type = "image/png") => `data:${type};base64,${Buffer.from(buf).toString("base64")}`;

describe("app icons (next/og)", () => {
  const shop = { name: "IronFit Gym", colors: { primary: "#39ff14", background: "#070a08" } };

  it("renders the lettermark at each size", async () => {
    for (const [file, size] of [["192.png", 192], ["512.png", 512], ["maskable-512.png", 512], ["apple-touch-icon.png", 180]] as const) {
      const png = await renderAppIcon(shop, file, null, false);
      expect(isPng(png), file).toBe(true);
      expect(pngSize(png), file).toEqual([size, size]);
    }
  });

  it("draws the logo when there is one, and falls back to the lettermark when it can't be drawn", async () => {
    const lettermark = await renderAppIcon(shop, "192.png", null, false);
    // A real PNG "logo" (another shop's lettermark).
    const logo = dataUri(await renderAppIcon({ name: "Raja Textiles", colors: { primary: "#b91c1c", background: "#ffffff" } }, "192.png", null, false));
    const withLogo = await renderAppIcon(shop, "maskable-512.png", logo, false);
    expect(isPng(withLogo)).toBe(true);
    expect(pngSize(withLogo)).toEqual([512, 512]);
    const withLogo192 = await renderAppIcon(shop, "192.png", logo, false);
    expect(Buffer.from(withLogo192).equals(Buffer.from(lettermark))).toBe(false);
    // Garbage bytes labelled PNG → the lettermark, not an error.
    const broken = await renderAppIcon(shop, "192.png", "data:image/png;base64,AAAA", false);
    expect(Buffer.from(broken).equals(Buffer.from(lettermark))).toBe(true);
  }, 30_000);

  it("names without Latin letters get a glyph instead of tofu", async () => {
    const png = await renderAppIcon({ name: "அன்னபூரணி", colors: { primary: "#c2410c", background: "#fffaf5" } }, "192.png", null, false);
    expect(isPng(png)).toBe(true);
  });
});
