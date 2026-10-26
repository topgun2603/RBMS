import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(join(__dirname, p), "utf8");

/**
 * Regression guards for "letters overlap / page scrolls sideways" on narrow screens with long Tamil labels:
 * a single-column `grid` needs `grid-cols-[minmax(0,1fr)]`, otherwise its implicit `auto` track grows to the widest
 * nowrap child (truncate rows, sticky bars) and pushes the form past the viewport.
 */
describe("narrow-screen layout guards", () => {
  it("wraps the description label row so the Write / Preview tabs never leave the screen", () => {
    const s = src("components/product-editor/sections-basic.tsx");
    expect(s).toMatch(/flex flex-wrap items-center justify-between[^"]*">\s*<FormLabel className="mr-auto">/);
  });

  it("collection editor form has a shrinkable single column on phones", () => {
    expect(src("components/collection-editor.tsx")).toMatch(/<form [^>]*className="grid grid-cols-\[minmax\(0,1fr\)\] gap-section/);
  });
});
