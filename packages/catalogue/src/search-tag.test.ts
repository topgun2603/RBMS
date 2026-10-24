import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "./search";

describe("public search: tag filter", () => {
  it("takes one exact tag, lowercased (the home finder and tag links send it)", () => {
    expect(parseSearchQuery({ tag: " Class-1-5 " }).tag).toBe("class-1-5");
    expect(parseSearchQuery({}).tag).toBeUndefined();
    expect(() => parseSearchQuery({ tag: "x".repeat(41) })).toThrow();
  });

  it("takes several tags (repeated or comma-separated), all required (AND), deduplicated", () => {
    expect(parseSearchQuery({ tag: ["Class-1-5", "tamil-medium"] }).tags).toEqual(["class-1-5", "tamil-medium"]);
    expect(parseSearchQuery({ tag: "class-1-5, state-board,class-1-5" }).tags).toEqual(["class-1-5", "state-board"]);
    expect(parseSearchQuery({ tag: ["a", "b,c"] })).toMatchObject({ tags: ["a", "b", "c"], tag: "a" });
    expect(parseSearchQuery({}).tags).toEqual([]);
    expect(parseSearchQuery({ tag: " , " }).tags).toEqual([]);
    expect(() => parseSearchQuery({ tag: ["a", "b", "c", "d", "e", "f"] })).toThrow();
  });
});
