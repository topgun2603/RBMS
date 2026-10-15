import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// The original (pure, zod-only) cms schemas — used only to prove the copy is identical.
import * as cms from "../../../cms/src/content";
import * as cmsSlug from "../../../cms/src/slug";
import * as local from "./content";
import * as localSlug from "./slug";
import { SECTION_FIXTURES, BLOCK_FIXTURES, MENU_FIXTURE } from "./fixtures";

const strip = (src: string) => src.replace(/^\/\*[\s\S]*?\*\/\s*/, "").trim();

describe("content.ts is an exact copy of packages/cms/src/content.ts", () => {
  it("has the same source (after the copy header)", () => {
    const original = readFileSync(join(__dirname, "../../../cms/src/content.ts"), "utf8");
    const copy = readFileSync(join(__dirname, "content.ts"), "utf8");
    expect(strip(copy)).toBe(original.trim());
  });

  it("slug.ts matches the cms original", () => {
    const original = readFileSync(join(__dirname, "../../../cms/src/slug.ts"), "utf8");
    const copy = readFileSync(join(__dirname, "slug.ts"), "utf8");
    expect(strip(copy)).toBe(original.trim());
    expect([...localSlug.RESERVED_SLUGS].sort()).toEqual([...cmsSlug.RESERVED_SLUGS].sort());
  });

  it("parses every fixture the same way as the original schemas", () => {
    for (const s of SECTION_FIXTURES) {
      expect(local.homeSectionSchema.parse(s), s.type).toEqual(cms.homeSectionSchema.parse(s));
    }
    for (const b of BLOCK_FIXTURES) {
      expect(local.blockSchema.parse(b), b.type).toEqual(cms.blockSchema.parse(b));
    }
    expect(local.menuItemsSchema.parse(MENU_FIXTURE)).toEqual(cms.menuItemsSchema.parse(MENU_FIXTURE));
  });

  it("covers every section and block type", () => {
    expect(new Set(SECTION_FIXTURES.map((s) => s.type))).toEqual(new Set(local.HOME_SECTION_TYPES));
    expect(new Set(BLOCK_FIXTURES.map((b) => b.type))).toEqual(new Set(local.BLOCK_TYPES));
  });
});
