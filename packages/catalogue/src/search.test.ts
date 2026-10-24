import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  attributeSql,
  buildSearchText,
  categoryPath,
  FACET_SCOPE,
  groupFacetRows,
  mergeSameNameFacets,
  nameTierSql,
  translatedTextMatchSql,
  normalizeText,
  parseQuery,
  parseSearchQuery,
  priceFacet,
  relevanceOrderSql,
  rollupCategoryCounts,
  searchMatchSql,
  sortByRating,
  sortOrderSql,
  variantExistsSql,
} from "./search";

const dialect = new PgDialect();
const render = (s: SQL | SQL[]) => dialect.sqlToQuery(Array.isArray(s) ? sql.join(s, sql`, `) : s);

describe("parseQuery", () => {
  it("lowercases, collapses spaces and splits words", () => {
    expect(parseQuery("  Silk   SAREE  ")).toEqual({ text: "silk saree", words: ["silk", "saree"], tsquery: "'silk':* & 'saree':*" });
  });

  it("keeps Tamil as typed, also mixed with English", () => {
    const q = parseQuery("Kanchipuram  பட்டு Saree");
    expect(q.text).toBe("kanchipuram பட்டு saree");
    expect(q.words).toEqual(["kanchipuram", "பட்டு", "saree"]);
    expect(parseQuery("பட்டுப் புடவை").words).toEqual(["பட்டுப்", "புடவை"]);
  });

  it("normalises to NFC so composed and decomposed Tamil vowel signs match", () => {
    const decomposed = "கொ"; // க + ெ + ா
    expect(normalizeText(decomposed)).toBe("கொ"); // கொ
  });

  it("trims punctuation at word edges, separates on commas, dedupes and caps words", () => {
    expect(parseQuery("saree, (cotton) men's").words).toEqual(["saree", "cotton", "men's"]);
    expect(parseQuery("a a b").words).toEqual(["a", "b"]);
    expect(parseQuery("1 2 3 4 5 6 7 8 9 10").words).toHaveLength(8);
    expect(parseQuery("x".repeat(300)).text).toHaveLength(100);
  });

  it("returns an empty query for blank or punctuation-only input", () => {
    expect(parseQuery("   ")).toEqual({ text: "", words: [], tsquery: null });
    expect(parseQuery(undefined)).toEqual({ text: "", words: [], tsquery: null });
    expect(parseQuery("!!! ??")).toEqual({ text: "", words: [], tsquery: null });
  });

  it("quotes every tsquery lexeme so operators and quotes are literal", () => {
    expect(parseQuery("o'neil a&b !x").tsquery).toBe("'o''neil':* & 'a&b':* & 'x':*");
    expect(parseQuery("back\\slash").tsquery).toBe("'back\\\\slash':*");
  });
});

describe("buildSearchText", () => {
  it("joins name, brand, tags, attribute values, category path and option values, lowercased and deduped", () => {
    expect(
      buildSearchText({
        name: "Kanchipuram பட்டு Saree",
        brand: "Sri Silks",
        tags: ["wedding", "silk"],
        attributes: { Fabric: "Silk", Colour: "Maroon" },
        categoryNames: ["Silk Sarees", "Sarees"],
        optionValues: ["Free Size", "Free Size"],
      }),
    ).toBe("kanchipuram பட்டு saree sri silks wedding silk maroon silk sarees sarees free size");
  });

  it("skips empty pieces and caps the length", () => {
    expect(buildSearchText({ name: "Shirt", brand: null, tags: [], attributes: { a: " " } })).toBe("shirt");
    expect(buildSearchText({ name: "x".repeat(5000) })).toHaveLength(4000);
  });

  it("categoryPath walks up to the root and survives cycles", () => {
    const cats = [
      { id: "a", parentId: null, name: "Sarees" },
      { id: "b", parentId: "a", name: "Silk" },
      { id: "x", parentId: "y", name: "X" },
      { id: "y", parentId: "x", name: "Y" },
    ];
    expect(categoryPath(cats, "b")).toEqual(["Silk", "Sarees"]);
    expect(categoryPath(cats, "x")).toEqual(["X", "Y"]);
    expect(categoryPath(cats, null)).toEqual([]);
    expect(categoryPath(cats, "gone")).toEqual([]);
  });
});

describe("matching and ranking SQL", () => {
  const q = parseQuery("Silk Saree");

  it("matches every word as a substring, or trigram word similarity, or the simple tsvector", () => {
    const { sql: text, params } = render(searchMatchSql(q)!);
    expect(text).toBe(
      '(("catalog_products"."search_text" like $1 and "catalog_products"."search_text" like $2) or $3 <% "catalog_products"."search_text" or "catalog_products"."search_vector" @@ to_tsquery(\'simple\', $4))',
    );
    expect(params).toEqual(["%silk%", "%saree%", "silk saree", "'silk':* & 'saree':*"]);
    expect(searchMatchSql(parseQuery(""))).toBeNull();
  });

  it("escapes LIKE wildcards in words", () => {
    expect(render(searchMatchSql(parseQuery("100%_off"))!).params[0]).toBe("%100\\%\\_off%");
  });

  it("ranks exact name > name prefix > word prefix, then trigram similarity, then tsvector rank", () => {
    const tier = render(nameTierSql(q));
    expect(tier.sql).toBe(
      '(case when lower("catalog_products"."name") = $1 then 3 when lower("catalog_products"."name") like $2 then 2 when lower("catalog_products"."name") like $3 then 1 else 0 end)',
    );
    expect(tier.params).toEqual(["silk saree", "silk saree%", "% silk saree%"]);

    const order = render(relevanceOrderSql(q)).sql;
    const at = (s: string) => order.indexOf(s);
    expect(at("case when")).toBe(1);
    expect(order).toMatch(/end\) desc, word_similarity\(\$\d+, "catalog_products"\."search_text"\) desc, ts_rank\(/);
    expect(at("case when")).toBeLessThan(at("word_similarity"));
    expect(at("word_similarity")).toBeLessThan(at("ts_rank"));
    expect(at("ts_rank")).toBeLessThan(at('"catalog_products"."created_at" desc'));
    expect(order.endsWith('"catalog_products"."id" asc')).toBe(true);
  });

  it("falls back to newest first for relevance without a query, and sorts by the cheapest variant", () => {
    expect(render(sortOrderSql("relevance", parseQuery(""))).sql).toBe('"catalog_products"."created_at" desc, "catalog_products"."id" asc');
    expect(render(sortOrderSql("price-asc", q)).sql).toMatch(/^\(select min\(cv\.price\) from "catalog_variants" cv .*\) asc nulls last/);
    expect(render(sortOrderSql("price-desc", q)).sql).toContain("desc nulls last");
    expect(render(sortOrderSql("relevance", q)).sql).toContain("word_similarity");
  });

  it("puts price, option and stock conditions on one variant", () => {
    const { sql: text, params } = render(
      variantExistsSql({ priceMin: 100, priceMax: 500, options: { Size: ["M", "L"] }, variantIds: ["11111111-1111-4111-8111-111111111111"] })!,
    );
    expect(text).toBe(
      'exists (select 1 from "catalog_variants" cv where cv.product_id = "catalog_products"."id" and cv.deleted_at is null and cv.price >= $1 and cv.price <= $2 and (cv.option_values ->> $3::text) in ($4, $5) and cv.id in ($6::uuid))',
    );
    expect(params).toEqual([100, 500, "Size", "M", "L", "11111111-1111-4111-8111-111111111111"]);
    expect(render(variantExistsSql({ variantIds: [] })!).sql).toContain("and false)");
    expect(variantExistsSql({ options: { Size: [] } })).toBeNull();
    expect(variantExistsSql({})).toBeNull();
  });

  it("lets an option filter also match a same-named product attribute", () => {
    const { sql: text, params } = render(variantExistsSql({ options: { Cut: ["Whole"] }, optionsMatchAttributes: true })!);
    expect(text).toContain('((cv.option_values ->> $1::text) in ($2) or ("catalog_products"."attributes" ->> $3::text) in ($4))');
    expect(params).toEqual(["Cut", "Whole", "Cut", "Whole"]);
  });

  it("filters attributes by key and any of the values", () => {
    const [cond] = attributeSql({ Fabric: ["Cotton", "Silk"], Empty: [] });
    expect(render(cond!)).toMatchObject({ sql: '("catalog_products"."attributes" ->> $1::text) in ($2, $3)', params: ["Fabric", "Cotton", "Silk"] });
    expect(attributeSql({ Empty: [] })).toEqual([]);
  });
});

describe("parseSearchQuery", () => {
  it("reads attr.* and opt.* filters (repeat a parameter for several values)", () => {
    const s = parseSearchQuery({ q: "saree", "attr.Fabric": "Cotton", "opt.Size": ["M", "L", "M"], "attr.": "x", "opt.Colour": " " });
    expect(s.attributes).toEqual({ Fabric: ["Cotton"] });
    expect(s.options).toEqual({ Size: ["M", "L"] });
    expect(s.parsed.text).toBe("saree");
  });

  it("defaults and coerces", () => {
    expect(parseSearchQuery({})).toMatchObject({ sort: "relevance", limit: 24, offset: 0, attributes: {}, options: {} });
    const s = parseSearchQuery({ priceMin: "50000", priceMax: "10000", inStock: "1", limit: "10", sort: "rating" });
    expect(s).toMatchObject({ priceMin: 10000, priceMax: 50000, inStock: true, limit: 10, sort: "rating" });
    expect(parseSearchQuery({ inStock: "0" }).inStock).toBe(false);
  });

  it("rejects bad values", () => {
    expect(() => parseSearchQuery({ sort: "cheap" })).toThrow(ZodError);
    expect(() => parseSearchQuery({ categoryId: "nope" })).toThrow(ZodError);
    expect(() => parseSearchQuery({ priceMin: "-1" })).toThrow(ZodError);
    expect(() => parseSearchQuery({ limit: "500" })).toThrow(ZodError);
  });
});

describe("facets", () => {
  it("categories drill down (ignore the category filter); price ignores the price filter; the rest use the filtered set", () => {
    expect(FACET_SCOPE).toEqual({ categories: ["category"], price: ["price"], attributes: [], options: [] });
  });

  it("groups facet rows by key, counts desc then value", () => {
    expect(
      groupFacetRows([
        { key: "Size", value: "M", count: 3 },
        { key: "Size", value: "L", count: "5" },
        { key: "Size", value: "S", count: 3 },
        { key: "Fabric", value: "Cotton", count: 2 },
        { key: "Fabric", value: "", count: 9 },
        { key: "Fabric", value: "Silk", count: 0 },
      ]),
    ).toEqual({
      Fabric: [{ value: "Cotton", count: 2 }],
      Size: [
        { value: "L", count: 5 },
        { value: "M", count: 3 },
        { value: "S", count: 3 },
      ],
    });
    const many = Array.from({ length: 40 }, (_, i) => ({ key: "K", value: `v${i}`, count: 1 }));
    expect(groupFacetRows(many).K).toHaveLength(30);
  });

  it("keeps option values in the products' option order (sizes S, M, L, XL, not by count or alphabet)", () => {
    const out = groupFacetRows([
      { key: "Size", value: "XL", count: 9, rank: 4 },
      { key: "Size", value: "L", count: 2, rank: 3 },
      { key: "Size", value: "S", count: 2, rank: 1 },
      { key: "Size", value: "M", count: 5, rank: "2" },
      { key: "Size", value: "Free size", count: 1, rank: null },
    ]);
    expect(out.Size!.map((v) => v.value)).toEqual(["S", "M", "L", "XL", "Free size"]);
    expect(out.Size![0]).toEqual({ value: "S", count: 2 });
    // The option order survives folding a same-name attribute into it.
    const merged = mergeSameNameFacets({ Size: [{ value: "XXL", count: 7 }, { value: "M", count: 1 }] }, out);
    expect(merged.options.Size!.map((v) => v.value)).toEqual(["S", "M", "L", "XL", "Free size", "XXL"]);
  });

  it("merges an attribute facet into the option facet of the same name", () => {
    const merged = mergeSameNameFacets(
      { Cut: [{ value: "Whole", count: 2 }, { value: "Boneless", count: 1 }], Origin: [{ value: "Trichy", count: 4 }] },
      { Cut: [{ value: "Whole", count: 3 }, { value: "Steaks", count: 2 }], Weight: [{ value: "1 kg", count: 5 }] },
    );
    expect(merged.attributes).toEqual({ Origin: [{ value: "Trichy", count: 4 }] });
    expect(merged.options).toEqual({
      Cut: [
        { value: "Whole", count: 5 },
        { value: "Steaks", count: 2 },
        { value: "Boneless", count: 1 },
      ],
      Weight: [{ value: "1 kg", count: 5 }],
    });
    expect(mergeSameNameFacets({}, {})).toEqual({ attributes: {}, options: {} });
  });

  it("rolls category counts up to ancestors and keeps only known (active) categories", () => {
    const cats = [
      { id: "sarees", parentId: null, name: "Sarees" },
      { id: "silk", parentId: "sarees", name: "Silk" },
      { id: "cotton", parentId: "sarees", name: "Cotton" },
      { id: "men", parentId: null, name: "Men" },
    ];
    expect(
      rollupCategoryCounts(cats, [
        { categoryId: "silk", count: 4 },
        { categoryId: "cotton", count: "2" },
        { categoryId: "men", count: 1 },
        { categoryId: null, count: 7 },
        { categoryId: "inactive", count: 3 },
      ]),
    ).toEqual([
      { id: "sarees", name: "Sarees", count: 6 },
      { id: "silk", name: "Silk", count: 4 },
      { id: "cotton", name: "Cotton", count: 2 },
      { id: "men", name: "Men", count: 1 },
    ]);
  });

  it("price facet is zero for an empty set", () => {
    expect(priceFacet(undefined)).toEqual({ min: 0, max: 0 });
    expect(priceFacet({ min: null, max: null })).toEqual({ min: 0, max: 0 });
    expect(priceFacet({ min: "100", max: 900 })).toEqual({ min: 100, max: 900 });
  });
});

describe("sortByRating", () => {
  it("orders by average, then count; unrated last; ties keep the incoming order", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const ratings = [
      { productId: "b", average: 4.5, count: 2 },
      { productId: "c", average: 4.5, count: 10 },
      { productId: "d", average: 3, count: 1 },
      { productId: "e", average: 5, count: 0 },
    ];
    expect(sortByRating(ids, ratings)).toEqual(["c", "b", "d", "a", "e"]);
    expect(sortByRating(ids, [])).toEqual(ids);
  });
});

describe("translatedTextMatchSql (Tamil queries match approved Tamil names)", () => {
  it("is only added for non-English queries", () => {
    expect(translatedTextMatchSql(parseQuery("silk saree"))).toBeNull();
    expect(translatedTextMatchSql(parseQuery(""))).toBeNull();
    expect(translatedTextMatchSql(parseQuery("பட்டுப் புடவை"))).not.toBeNull();
    expect(searchMatchSql(parseQuery("பட்டு"))).not.toBeNull();
  });
});
