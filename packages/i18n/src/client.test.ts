import { describe, expect, it } from "vitest";
import { en } from "./bundles/en";
import { ta } from "./bundles/ta";
import { createTranslator, type Locale, type Messages, formatCurrencyINR, formatDate, formatNumber, interpolate, normalizeLocale } from "./client";
import { buildDictionary, overrideRank } from "./dictionary";

describe("interpolate", () => {
  it("replaces named placeholders", () => {
    expect(interpolate("{code} is your {app} code", { code: "123456", app: "EC" })).toBe("123456 is your EC code");
  });
  it("leaves unknown placeholders and stray braces intact", () => {
    expect(interpolate("Hi {name}, {missing}", { name: "Ravi" })).toBe("Hi Ravi, {missing}");
    expect(interpolate("open { brace", {})).toBe("open { brace");
  });
  it("renders numbers including zero", () => {
    expect(interpolate("{n} left", { n: 0 })).toBe("0 left");
  });
});

describe("plurals", () => {
  const tpl = "{count, plural, one {# item} other {# items}}";
  it("chooses one/other", () => {
    expect(interpolate(tpl, { count: 1 })).toBe("1 item");
    expect(interpolate(tpl, { count: 5 })).toBe("5 items");
    expect(interpolate(tpl, { count: 0 })).toBe("0 items");
  });
  it("prefers exact =N matches", () => {
    expect(interpolate(en["common.itemCount"], { count: 0 })).toBe("No items");
    expect(interpolate(en["common.itemCount"], { count: 1 })).toBe("1 item");
  });
  it("works with surrounding text and nested placeholders", () => {
    expect(interpolate("{name} has {count, plural, one {# cart for {name}} other {# carts}}.", { name: "Anu", count: 1 })).toBe(
      "Anu has 1 cart for Anu.",
    );
  });
  it("works with Tamil text", () => {
    expect(interpolate(ta["common.itemCount"], { count: 3 }, "ta")).toBe("3 உருப்படிகள்");
    expect(interpolate(ta["common.itemCount"], { count: 1 }, "ta")).toBe("1 உருப்படி");
  });
  it("leaves the template if count is missing", () => {
    expect(interpolate(tpl, {})).toBe(tpl);
  });
});

describe("normalizeLocale", () => {
  it.each([
    ["ta", "ta"],
    ["ta-IN", "ta"],
    ["TA_lk", "ta"],
    ["en-US", "en"],
    ["hi-IN", "en"],
    ["", "en"],
    [undefined, "en"],
    [null, "en"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeLocale(input)).toBe(expected);
  });
});

describe("createTranslator", () => {
  const t = createTranslator({ hello: "வணக்கம் {name}" }, { hello: "Hello {name}", bye: "Bye" });
  it("uses messages, then fallback, then the key", () => {
    expect(t("hello", { name: "Kumar" })).toBe("வணக்கம் Kumar");
    expect(t("bye")).toBe("Bye");
    expect(t("missing.key")).toBe("missing.key");
    expect(t.has("bye")).toBe(true);
    expect(t.has("missing.key")).toBe(false);
  });
  it("does not resolve prototype keys", () => {
    expect(t("toString")).toBe("toString");
  });
});

describe("formatting", () => {
  it("uses Indian digit grouping", () => {
    expect(formatNumber("en", 1234567)).toBe("12,34,567");
    expect(formatCurrencyINR("en", 123456.5)).toBe("₹1,23,456.50");
  });
  it("formats dates for both locales", () => {
    const d = new Date("2026-01-15T10:00:00Z");
    expect(formatDate("en", d)).toMatch(/2026/);
    expect(formatDate("ta", d)).toMatch(/2026/);
  });
});

const placeholders = (s: string) =>
  [...s.matchAll(/\{\s*([\w.]+)\s*(?:,|\})/g)].map((m) => m[1]).sort();

describe("bundles", () => {
  it("every English key exists in Tamil", () => {
    const missing = Object.keys(en).filter((k) => !(k in ta));
    expect(missing).toEqual([]);
  });
  it("Tamil has no keys that English lacks", () => {
    expect(Object.keys(ta).filter((k) => !(k in en))).toEqual([]);
  });
  it("Tamil translations keep the same placeholders", () => {
    for (const [k, v] of Object.entries(en)) {
      expect(placeholders((ta as Record<string, string>)[k] ?? ""), k).toEqual(placeholders(v));
    }
  });
  it("Tamil values are in Tamil script", () => {
    const tamil = /[஀-௿]/;
    for (const [k, v] of Object.entries(ta)) expect(tamil.test(v), k).toBe(true);
  });
  it("renders the OTP SMS", () => {
    const t = createTranslator(en);
    expect(t("notify.otpSms", { code: "4821", app: "ShopEasy", minutes: 10 })).toBe(
      "4821 is your ShopEasy verification code. It expires in 10 minutes.",
    );
  });
});

describe("buildDictionary", () => {
  const base: Array<Partial<Record<Locale, Messages>>> = [{ en: { a: "A", b: "B", c: "C" }, ta: { a: "அ" } }, { en: { b: "B2" } }, { ta: { c: "இ" } }];
  it("applies base layers in order and falls back to English", () => {
    expect(buildDictionary("en", { base, overrides: [] })).toEqual({ a: "A", b: "B2", c: "C" });
    expect(buildDictionary("ta", { base, overrides: [] })).toEqual({ a: "அ", b: "B2", c: "இ" });
  });
  it("applies db overrides by rank: app-wide < app < tenant < tenant+app", () => {
    const overrides = [
      { tenantId: "t1", appId: "EC", locale: "en", key: "a", value: "tenant+app" },
      { tenantId: null, appId: null, locale: "en", key: "a", value: "global" },
      { tenantId: "t1", appId: null, locale: "en", key: "a", value: "tenant" },
      { tenantId: null, appId: "EC", locale: "en", key: "a", value: "app" },
      { tenantId: null, appId: "EC", locale: "en", key: "b", value: "app-b" },
      { tenantId: null, appId: null, locale: "en", key: "b", value: "global-b" },
    ];
    expect(buildDictionary("en", { base, overrides })).toMatchObject({ a: "tenant+app", b: "app-b" });
    expect(overrideRank({ tenantId: null, appId: null })).toBeLessThan(overrideRank({ tenantId: null, appId: "x" }));
  });
  it("a Tamil override beats an English override for the Tamil dictionary", () => {
    const overrides = [
      { tenantId: "t1", appId: null, locale: "en", key: "a", value: "EN-tenant" },
      { tenantId: "t1", appId: null, locale: "en", key: "b", value: "EN-b" },
    ];
    const dict = buildDictionary("ta", { base, overrides });
    expect(dict.a).toBe("அ");
    expect(dict.b).toBe("EN-b");
  });
});
