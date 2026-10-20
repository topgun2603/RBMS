import { BUSINESS_TYPES, PACKS, starterHome } from "@srirealtime/verticals";
import { describe, expect, it } from "vitest";
import { homeSectionSchema } from "./content";

describe("business pack starter homes", () => {
  it("every pack's starter home is valid CMS content, in both languages", () => {
    for (const t of BUSINESS_TYPES) {
      for (const lang of ["en", "ta"] as const) {
        for (const s of starterHome(PACKS[t], "Test Shop", lang)) expect(homeSectionSchema.safeParse(s).success, `${t} ${lang} ${s.type}`).toBe(true);
      }
    }
  });
});
