import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { translatorFor } from "./messages";

const t = translatorFor("en");
let compare = "on";
vi.mock("../client/store-context", async (orig) => ({
  ...(await orig<typeof import("../client/store-context")>()),
  useStore: () => ({ t, shell: { theme: { compare } } }),
}));

const { CompareToggle } = await import("../client/compare");
const product = { id: "p1", slug: "kurti", name: "Anarkali Kurti", image: null };
const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

describe("compare toggle on cards", () => {
  it("is a small icon button with an accessible name and pressed state, not a checkbox row", () => {
    const out = html(<CompareToggle product={product} />);
    expect(out).toMatch(/^<button type="button"/);
    expect(out).toContain('aria-pressed="false"');
    expect(out).toContain('aria-label="Compare Anarkali Kurti"');
    expect(out).toContain("sf-compare-chip");
    expect(out).toContain("size-9");
    // No visible "Compare" text and no fake checkbox box on the tile.
    expect(out).not.toMatch(/>Compare</);
    expect(out).not.toContain("rounded border");
  });

  it("list rows get the same icon button, always visible (no hover-hiding class)", () => {
    const out = html(<CompareToggle product={product} variant="inline" />);
    expect(out).toContain('aria-label="Compare Anarkali Kurti"');
    expect(out).not.toContain("sf-compare-chip");
  });

  it("the product page keeps its labelled button; nothing renders with compare off", () => {
    expect(html(<CompareToggle product={product} variant="page" />)).toContain(">Compare</button>");
    compare = "off";
    expect(html(<CompareToggle product={product} />)).toBe("");
    compare = "on";
  });

  it("styles: hidden until tile hover/focus on hover devices; shown when picked or while the tray has items", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    const block = css.slice(css.search(/@media \(hover: hover\) \{\s*\.sf-compare-chip/));
    expect(block).toMatch(/\.sf-compare-chip:not\(\[aria-pressed="true"\]\):not\(\[data-tray\]\) \{\s*opacity: 0;/);
    expect(block).toMatch(/\.group\\\/card:hover \.sf-compare-chip,\s*\.group\\\/card:focus-within \.sf-compare-chip,\s*\.sf-compare-chip:focus-visible \{\s*opacity: 1;/);
  });
});
