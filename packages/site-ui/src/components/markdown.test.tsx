import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

describe("editor markdown preview", () => {
  it("renders GFM tables like the storefront (shared renderer), and stays safe", () => {
    const out = renderToStaticMarkup(<Markdown source={"| Size | Bust |\n| :-- | :-: |\n| **S** | 34 |\n\n<script>x</script>"} />);
    expect(out).toContain('<div class="md-table');
    expect(out).toContain("<strong>S</strong>");
    expect(out).toMatch(/<th scope="col" style="text-align:center"[^>]*>Bust<\/th>/);
    expect(out).not.toContain("<script>");
  });
});
