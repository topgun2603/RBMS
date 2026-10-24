import { describe, expect, it } from "vitest";
import { en, ta } from "../lib/messages";
import { sizeKindFor } from "./size-guide";

describe("sizeKindFor", () => {
  it("keeps the clothing charts for clothing", () => {
    expect(sizeKindFor("fashion", "Blouses", "Raw silk blouse, maroon")).toBe("saree");
    expect(sizeKindFor("fashion", "Sarees", "Kanchipuram silk saree")).toBe("saree");
    expect(sizeKindFor("fashion", "Men", "Silk veshti with gold border")).toBe("bottom");
    expect(sizeKindFor("fashion", "Kurtis", "Chikankari kurti, white")).toBe("top");
    expect(sizeKindFor("tailoring", "Shirts", "Oxford shirt, blue")).toBe("top");
    expect(sizeKindFor("Jeans", "Bootcut jeans")).toBe("bottom");
  });

  it("gives footwear the shoe chart, on the men's, women's or kids' tab", () => {
    expect(sizeKindFor("footwear", "Formal shoes", "Men's leather Oxford, black")).toBe("shoe-men");
    expect(sizeKindFor("footwear", "Men", "Leather Derby, brown")).toBe("shoe-men");
    expect(sizeKindFor("footwear", "Women", "Block-heel mule, white")).toBe("shoe-women");
    expect(sizeKindFor("footwear", "Sandals & chappals", "Women's embroidered juttis")).toBe("shoe-women");
    expect(sizeKindFor("footwear", "School shoes", "Boys' black school shoes")).toBe("shoe-kids");
    expect(sizeKindFor("footwear", "Kids", "Velcro sneakers")).toBe("shoe-kids");
    // A clothing shop's footwear shelf gets it too.
    expect(sizeKindFor("fashion", "Footwear", "Kolhapuri chappal")).toBe("shoe-men");
    expect(sizeKindFor(null, "Ladies", "Wedges, black")).toBe("shoe-women");
  });

  it("has the shoe chart's words in English and Tamil", () => {
    for (const k of ["size.shoe.men", "size.shoe.women", "size.shoe.kids", "size.shoe.note", "size.shoe.kidsNote", "size.shoe.howFoot", "size.shoe.room", "size.col.uk", "size.col.ind", "size.col.eu", "size.col.us", "size.col.foot", "size.fullGuide"]) {
      expect(en[k], k).toBeTruthy();
      expect(ta[k], k).toBeTruthy();
    }
    expect(ta["size.shoe.kids"]).toMatch(/[஀-௿]/);
  });
});
