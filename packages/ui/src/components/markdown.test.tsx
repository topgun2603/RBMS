import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseTableDelimiter, renderMarkdown, splitTableRow } from "./markdown";

const html = (src: string) => renderToStaticMarkup(<>{renderMarkdown(src)}</>);

describe("markdown tables (GFM)", () => {
  it("splits rows, dropping outer pipes and honouring escaped pipes", () => {
    expect(splitTableRow("| a | b |")).toEqual(["a", "b"]);
    expect(splitTableRow("a | b")).toEqual(["a", "b"]);
    expect(splitTableRow("| x \\| y | z |")).toEqual(["x | y", "z"]);
    expect(splitTableRow("| a |  |")).toEqual(["a", ""]);
  });

  it("reads delimiter alignments and rejects non-delimiters", () => {
    expect(parseTableDelimiter("| --- | :-: | --: | :-- |")).toEqual([null, "center", "right", "left"]);
    expect(parseTableDelimiter("---|---")).toEqual([null, null]);
    expect(parseTableDelimiter("| a | b |")).toBeNull();
    expect(parseTableDelimiter("| : | - |")).toEqual(null);
  });

  it("renders a header, striped body rows and inline markup in cells", () => {
    const out = html("Intro\n\n| Size | Bust (in) |\n| :-- | --: |\n| **S** | 34 |\n| M | 36 |\n\nAfter");
    expect(out).toContain('<div class="md-table');
    expect(out).toContain('role="region"');
    expect(out).toContain('tabindex="0"');
    expect(out).toMatch(/<th scope="col" style="text-align:left"[^>]*>Size<\/th>/);
    expect(out).toMatch(/<th scope="col" style="text-align:right"[^>]*>Bust \(in\)<\/th>/);
    expect(out).toContain("<strong>S</strong>");
    expect(out.match(/<tr /g)?.length).toBe(2); // two body rows (the header row has no class)
    expect(out).toContain("even:bg-muted/40");
    expect(out).toContain("<p>Intro</p>");
    expect(out).toContain("<p>After</p>");
    expect(out).not.toContain("| Size |");
  });

  it("pads short rows and trims long ones to the header width", () => {
    const out = html("| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |");
    const cells = out.match(/<td[^>]*>([^<]*)<\/td>/g)!;
    expect(cells).toHaveLength(4);
    expect(out).not.toContain(">3<");
  });

  it("ends the table at a blank line or a line without pipes", () => {
    const out = html("| a | b |\n|---|---|\n| 1 | 2 |\nplain text");
    expect(out).toContain("<p>plain text</p>");
  });

  it("leaves pipes alone when there is no delimiter row, or the column count differs", () => {
    expect(html("| a | b |\nno delimiter")).toContain("<p>| a | b |");
    expect(html("| a | b |\n|---|---|---|")).not.toContain("<table");
  });

  it("stays safe: raw HTML is text and unsafe links are dropped inside cells", () => {
    const out = html('| a | b |\n|---|---|\n| <img src=x onerror=alert(1)> | [x](javascript:alert(1)) |');
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
    expect(out).not.toContain("javascript:");
  });
});
