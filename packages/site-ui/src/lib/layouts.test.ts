import { describe, expect, it } from "vitest";
import { checkSection, emptyFinderOption, fromSectionForm, layoutChecks, sizeList, toSectionForm, type SectionForm } from "./sections";

/* Editor rules of the layout sections that the schema can't hold (lib/sections `layoutChecks`). */

const P1 = "0b6f5f36-0000-4000-8000-000000000001";
const sale = (p: Partial<Extract<SectionForm, { type: "flash-sale" }>>): SectionForm => ({
  type: "flash-sale",
  title: "",
  text: "",
  startsAt: "",
  endsAt: "2026-11-01T18:30",
  dailyFrom: "",
  dailyTo: "",
  source: "pick",
  productIds: [],
  collectionSlug: "",
  layout: "carousel",
  limit: "8",
  ctaLabel: "",
  ctaHref: "",
  ...p,
});

describe("layout section checks", () => {
  it("a flash sale's daily window: both times, different, 00:00 as the end = until midnight", () => {
    expect(checkSection(sale({ productIds: [P1], dailyFrom: "18:00" })).errors.dailyTo).toBe("required");
    expect(checkSection(sale({ productIds: [P1], dailyFrom: "18:00", dailyTo: "18:00" })).errors.dailyTo).toBe("invalid");
    const ok = checkSection(sale({ productIds: [P1], dailyFrom: "18:00", dailyTo: "21:00" }));
    expect(ok.errors).toEqual({});
    expect(fromSectionForm(sale({ productIds: [P1], dailyFrom: "18:00", dailyTo: "00:00" }))).toMatchObject({ daily: { from: "18:00", to: "24:00" } });
    expect(fromSectionForm(sale({ productIds: [P1] }))).not.toHaveProperty("daily");
    const back = toSectionForm({ type: "flash-sale", endsAt: "2026-11-01T18:30:00.000Z", productIds: [P1], source: "pick", layout: "carousel", limit: 8, daily: { from: "18:00", to: "24:00" } });
    expect(back).toMatchObject({ dailyFrom: "18:00", dailyTo: "00:00" });
  });

  it("a flash sale needs its products or collection, and an end after the start", () => {
    expect(checkSection(sale({})).errors.productIds).toBe("minItems");
    expect(checkSection(sale({ source: "collection" })).errors.collectionSlug).toBe("required");
    expect(checkSection(sale({ source: "sale" })).ok).toBe(true);
    expect(checkSection(sale({ productIds: [P1], startsAt: "2026-11-02T10:00" })).errors.endsAt).toBe("endBeforeStart");
    expect(checkSection(sale({ productIds: [P1] })).ok).toBe(true);
  });

  it("a finder answer must filter something, and an option filter needs both halves", () => {
    const f: SectionForm = {
      type: "finder",
      title: "",
      text: "",
      layout: "chips",
      results: "inline",
      buttonLabel: "",
      imageUrl: "",
      ctaLabel: "",
      ctaHref: "",
      limit: "8",
      questions: [{ label: "Class", options: [{ ...emptyFinderOption(), label: "LKG" }, { ...emptyFinderOption(), label: "1–5", filterName: "Class" }] }],
    };
    const e = layoutChecks(f);
    expect(e["questions.0.options.0.filter"]).toBe("noFilter");
    expect(e["questions.0.options.1.filterValue"]).toBe("required");
    const ok = { ...f, questions: [{ label: "Class", options: [{ ...emptyFinderOption(), label: "LKG", tag: "lkg-ukg" }, { ...emptyFinderOption(), label: "1–5", href: "/collections/class-1-5" }] }] };
    expect(checkSection(ok).ok).toBe(true);
  });

  it("sizes are typed with commas (so UK 8 stays one size) and round-trip", () => {
    expect(sizeList("UK 6, UK 7,UK 7\nUK 8")).toEqual(["UK 6", "UK 7", "UK 8"]);
    const stored = { type: "size-finder" as const, optionName: "Size", footLength: true, groups: [{ label: "Men", sizes: ["UK 6", "UK 7"] }] };
    expect(fromSectionForm(toSectionForm(stored))).toEqual(stored);
  });
});
