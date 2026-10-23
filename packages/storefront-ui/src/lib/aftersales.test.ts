import { describe, expect, it } from "vitest";
import { isProxyAllowed } from "../server/proxy";
import { aftersalesMessages, aftersalesText, fill } from "./messages-aftersales";

describe("after-sales pages", () => {
  it("has every message in English and Tamil", () => {
    expect(Object.keys(aftersalesMessages.ta).sort()).toEqual(Object.keys(aftersalesMessages.en).sort());
    for (const [k, v] of Object.entries(aftersalesMessages.ta)) expect(v.trim(), k).not.toBe("");
    expect(aftersalesText("ta")["warranty.title"]).toBe(aftersalesMessages.ta["warranty.title"]);
    expect(aftersalesText("xx")["warranty.title"]).toBe("Check your warranty");
  });

  it("keeps the same placeholders in both languages", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [k, v] of Object.entries(aftersalesMessages.en)) expect(vars(aftersalesMessages.ta[k as keyof typeof aftersalesMessages.en]), k).toEqual(vars(v));
  });

  it("fills placeholders", () => {
    expect(fill("Approve {total}", { total: "₹1,800" })).toBe("Approve ₹1,800");
    expect(fill("{a} and {b}", { a: 1 })).toBe("1 and {b}");
  });

  it("lets the browser reach only the public lookups through the store proxy", () => {
    expect(isProxyAllowed("/v1/serials/public/warranty", "GET")).toBe(true);
    expect(isProxyAllowed("/v1/jobcards/public/find", "POST")).toBe(true);
    expect(isProxyAllowed("/v1/jobcards/public/track/abcdefghijklmnop/approval", "POST")).toBe(true);
    expect(isProxyAllowed("/v1/serials/units", "GET")).toBe(false);
    expect(isProxyAllowed("/v1/serials/warranty", "GET")).toBe(false);
    expect(isProxyAllowed("/v1/jobcards", "GET")).toBe(false);
  });
});
