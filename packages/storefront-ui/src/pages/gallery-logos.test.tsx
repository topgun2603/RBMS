import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HomeSectionOf } from "../types";
import { GallerySection, LogosSection, masonryColumns } from "./home-sections";

const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

describe("masonry gallery", () => {
  it("chooses columns from the image count so none is left empty", () => {
    expect(masonryColumns(9)).toEqual({ ph: 2, md: 3, lg: 3 });
    expect(masonryColumns(8)).toEqual({ ph: 2, md: 3, lg: 4 });
    expect(masonryColumns(12)).toEqual({ ph: 2, md: 3, lg: 4 });
    expect(masonryColumns(2)).toEqual({ ph: 2, md: 2, lg: 2 });
    expect(masonryColumns(1)).toEqual({ ph: 1, md: 1, lg: 1 });
    for (let n = 2; n <= 24; n++) expect(n).toBeGreaterThanOrEqual(masonryColumns(n).lg);
  });

  it("renders a dense row-span grid (not CSS columns) with the counts and tile spans", () => {
    const s = { type: "gallery", layout: "masonry", title: "Our work", images: Array.from({ length: 9 }, (_, i) => ({ url: `https://img/${i}.jpg`, alt: `Look ${i}` })) } as HomeSectionOf<"gallery">;
    const out = html(<GallerySection s={s} />);
    expect(out).toContain('class="sf-masonry-grid"');
    expect(out).toContain("--c-lg:3");
    expect(out).not.toContain("columns-2");
    expect(out.match(/--rows:/g)).toHaveLength(9);
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.sf-masonry-grid\s*\{[^}]*grid-auto-flow: row dense/);
    expect(css).toMatch(/\.sf-masonry\s*\{[^}]*container-type: inline-size/);
  });
});

describe("logos strip", () => {
  it("text-only entries render as wordmarks (linked when they have a link); pictures stay images", () => {
    const s = {
      type: "logos",
      title: "Brands we use",
      grayscale: true,
      items: [{ name: "Wella" }, { name: "Schwarzkopf", href: "https://schwarzkopf.com" }, { name: "Titan", imageUrl: "https://cdn/titan.png" }],
    } as HomeSectionOf<"logos">;
    const out = html(<LogosSection s={s} />);
    expect(out.match(/data-logo="wordmark"/g)).toHaveLength(2);
    expect(out).toContain(">Wella</span>");
    expect(out).toMatch(/<a href="https:\/\/schwarzkopf\.com"[^>]*target="_blank"[^>]*><span[^>]*data-logo="wordmark"[^>]*>Schwarzkopf<\/span><\/a>/);
    expect(out).toContain('alt="Titan"');
    expect(out).toContain("font-display");
  });
});
