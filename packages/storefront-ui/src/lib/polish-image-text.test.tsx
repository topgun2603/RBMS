import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeSectionView } from "../pages/home";
import type { HomeSection, StoreConfig } from "../types";
import { translatorFor } from "./messages";

const t = translatorFor("en");
const config = { shop: { name: "Vayal", social: {}, businessType: "organic" }, policies: {}, codEnabled: false } as unknown as StoreConfig;
const section = (imageSide: "left" | "right"): HomeSection => ({ type: "image-text", imageUrl: "/x.jpg", heading: "From farmers we know", markdown: "Hi", imageSide });
const copyClass = (side: "left" | "right") => {
  const out = renderToStaticMarkup(<HomeSectionView section={section(side)} index={2} t={t} ratings={new Map()} config={config} />);
  return /class="sf-image-text-copy ([^"]+)"/.exec(out)?.[1] ?? "";
};

describe("image-text section", () => {
  it("pads the text column on its outer side, whichever side the picture is on", () => {
    expect(copyClass("left")).toContain("md:pe-12");
    expect(copyClass("left")).toContain("md:ps-0");
    expect(copyClass("right")).toContain("md:ps-12");
    expect(copyClass("right")).toContain("md:pe-0");
  });
});
