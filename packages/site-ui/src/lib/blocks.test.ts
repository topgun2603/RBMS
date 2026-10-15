import { describe, expect, it } from "vitest";
import { BLOCK_TYPES, blockSchema } from "./content";
import { BLOCK_FIXTURES } from "./fixtures";
import { checkBlock, checkBlocks, duplicateBlockForm, fromBlockForm, newBlockForm, toBlockForm } from "./blocks";

describe("block form ↔ schema round-trips", () => {
  for (const fixture of BLOCK_FIXTURES) {
    it(`${fixture.type}`, () => {
      const parsed = blockSchema.parse(fixture);
      const form = toBlockForm(parsed, "k1");
      expect(blockSchema.parse(fromBlockForm(form))).toEqual(parsed);
      expect(toBlockForm(blockSchema.parse(fromBlockForm(form)), "k1")).toEqual(form);
    });
  }

  it("accepts a YouTube link and stores only the id", () => {
    const f = { ...newBlockForm("video", "k"), video: "https://youtu.be/dQw4w9WgXcQ?t=10" } as ReturnType<typeof newBlockForm>;
    const c = checkBlock(f);
    expect(c.ok && c.value).toMatchObject({ type: "video", youtubeId: "dQw4w9WgXcQ" });
    const bad = checkBlock({ ...f, video: "https://vimeo.com/123" } as typeof f);
    expect(bad.ok).toBe(false);
    expect(bad.errors.video).toBeTruthy();
  });

  it("new blocks: divider is valid at once; others report what's missing", () => {
    for (const type of BLOCK_TYPES) {
      const c = checkBlock(newBlockForm(type, "k"));
      if (type === "divider") expect(c.ok).toBe(true);
      else expect(c.ok, type).toBe(false);
    }
    expect(checkBlock(newBlockForm("faq", "k")).errors).toMatchObject({ "items.0.q": "required", "items.0.a": "required" });
  });

  it("checkBlocks returns blocks only when all are valid, errors by key", () => {
    const good = toBlockForm({ type: "divider" }, "a");
    const bad = newBlockForm("heading", "b");
    expect(checkBlocks([good]).blocks).toEqual([{ type: "divider" }]);
    const r = checkBlocks([good, bad]);
    expect(r.blocks).toBeNull();
    expect(Object.keys(r.errors)).toEqual(["b"]);
  });

  it("duplicate drops the stored id and gets a new key", () => {
    const f = toBlockForm({ type: "heading", id: "keep", level: 2, text: "x" }, "a");
    const d = duplicateBlockForm(f, "b");
    expect(d.key).toBe("b");
    expect("id" in d && d.id).toBeFalsy();
  });
});
