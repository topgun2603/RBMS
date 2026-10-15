import { describe, expect, it } from "vitest";
import { nameMatchScore, nameTokens, normalizeName, wordSimilarity } from "./names";

describe("nameTokens / normalizeName", () => {
  it("upper-cases, strips punctuation and leading titles", () => {
    expect(normalizeName("  Mr. s.  gowtham-kumar ")).toBe("S GOWTHAM KUMAR");
    expect(normalizeName("Dr. Smt. Lakshmi")).toBe("LAKSHMI");
    expect(normalizeName("Thiru R. Venkatesh")).toBe("R VENKATESH");
  });
  it("keeps a title-like word when it is the whole name", () => {
    expect(nameTokens("Sri")).toEqual(["SRI"]);
  });
  it("drops M/s and relation clauses", () => {
    expect(normalizeName("M/s. Sri Lakshmi Traders")).toBe("LAKSHMI TRADERS");
    expect(normalizeName("R Venkatesh S/O Raman")).toBe("R VENKATESH");
    expect(normalizeName("Priya W/O Karthik")).toBe("PRIYA");
  });
  it("splits vowel-less clumps into initials and canonicalises business words", () => {
    expect(nameTokens("SK Raman")).toEqual(["S", "K", "RAMAN"]);
    expect(nameTokens("Raja Stores Private Limited")).toEqual(["RAJA", "STORES", "PVT", "LTD"]);
    expect(nameTokens("Raja & Sons Pvt. Ltd.")).toEqual(["RAJA", "AND", "SONS", "PVT", "LTD"]);
  });
  it("strips diacritics", () => expect(normalizeName("José")).toBe("JOSE"));
  it("empty input", () => {
    expect(nameTokens(null)).toEqual([]);
    expect(nameTokens("  .. ")).toEqual([]);
  });
});

describe("nameMatchScore", () => {
  it.each([
    ["S. Gowtham Kumar", "GOWTHAM KUMAR S", 100],
    ["Mr. Gowtham Kumar", "GOWTHAM KUMAR", 100],
    ["S.K. Raman", "RAMAN S K", 100],
    ["SK Raman", "Raman S. K.", 100],
    ["Raja Stores Pvt Ltd", "RAJA STORES PRIVATE LIMITED", 100],
    ["M/s Sri Lakshmi Traders", "SRI LAKSHMI TRADERS", 100],
    ["R Venkatesh S/O Raman", "VENKATESH R", 100],
  ])("same person: %s vs %s → %i", (a, b, expected) => {
    expect(nameMatchScore(a, b)).toBe(expected);
  });

  it("joined vs spaced words score at least 95", () => {
    expect(nameMatchScore("GOWTHAMKUMAR S", "S Gowtham Kumar")).toBe(95);
    expect(nameMatchScore("Gowthamkumar", "Gowtham Kumar")).toBe(95);
  });

  it("a missing initial still passes 80", () => {
    expect(nameMatchScore("Gowtham Kumar", "Gowtham Kumar S")).toBe(89);
  });

  it("initial vs expanded name passes", () => {
    expect(nameMatchScore("S Gowtham Kumar", "Sundaram Gowtham Kumar")).toBe(91);
    expect(nameMatchScore("G. Kumar", "Gowtham Kumar")).toBe(86);
  });

  it("spelling variants (transliteration) pass", () => {
    expect(nameMatchScore("Mohammed Ismail", "Mohamed Ismail")).toBeGreaterThanOrEqual(90);
    expect(nameMatchScore("Karthikeyan R", "KARTHIKEYAN. R")).toBe(100);
    expect(nameMatchScore("Senthil Kumar", "Senthilkumar")).toBeGreaterThanOrEqual(95);
  });

  it("partial names fall below 80", () => {
    expect(nameMatchScore("Gowtham", "Gowtham Kumar")).toBe(67);
    expect(nameMatchScore("S Kumar", "Gowtham Kumar")).toBeLessThan(80);
  });

  it("different people score low", () => {
    expect(nameMatchScore("Ramesh Kumar", "Suresh Kumar")).toBe(50);
    expect(nameMatchScore("Priya", "Lakshmi")).toBe(0);
    expect(nameMatchScore("SOMEONE ELSE", "TEST NAME")).toBe(0);
  });

  it("is symmetric and order-insensitive", () => {
    const pairs: [string, string][] = [
      ["S Gowtham Kumar", "Sundaram Gowtham Kumar"],
      ["Gowtham Kumar", "Gowtham Kumar S"],
      ["Mohammed Ismail", "Ismail Mohamed"],
    ];
    for (const [a, b] of pairs) expect(nameMatchScore(a, b)).toBe(nameMatchScore(b, a));
    expect(nameMatchScore("Kumar Gowtham", "Gowtham Kumar")).toBe(100);
  });

  it("empty side → 0", () => {
    expect(nameMatchScore("", "Gowtham")).toBe(0);
    expect(nameMatchScore("Gowtham", null)).toBe(0);
  });

  it("wordSimilarity", () => {
    expect(wordSimilarity("MOHAMMED", "MOHAMED")).toBeCloseTo(0.875);
    expect(wordSimilarity("", "")).toBe(1);
  });
});
