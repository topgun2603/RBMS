import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CATEGORY_LAYOUTS } from "../../lib/content";
import { moreEn as en, moreTa as ta } from "../../lib/messages-more";
import { CategoryLayoutThumb } from "./category-layout-thumbs";
import { CATEGORY_LAYOUT_ORDER } from "./section-forms-shelves";

describe("category layout picker", () => {
  it("offers every layout once, each with a sketch and EN/TA labels", () => {
    expect([...CATEGORY_LAYOUT_ORDER].sort()).toEqual([...CATEGORY_LAYOUTS].sort());
    for (const layout of CATEGORY_LAYOUTS) {
      const svg = renderToStaticMarkup(<CategoryLayoutThumb layout={layout} />);
      expect(svg, layout).toContain(`data-thumb="${layout}"`);
      expect(svg, layout).toMatch(/<(rect|circle|path)/);
      expect(en[`site.home.catLayout.${layout}`], layout).toBeTruthy();
      expect(ta[`site.home.catLayout.${layout}`], layout).toBeTruthy();
    }
  });
});
