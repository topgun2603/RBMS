import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  duplicateKey,
  MAX_IMPORT_ROWS,
  parseCsv,
  parseReviewDate,
  parseSource,
  planImport,
  REVIEW_CSV_TEMPLATE,
  staffReviewInputSchema,
  verifyLinkedOrder,
} from "./staff";

const P1 = "44444444-4444-4444-8444-444444444444";
const P2 = "55555555-5555-4555-8555-555555555555";
// 21 Oct 2026, 15:00 IST.
const NOW = new Date("2026-10-21T09:30:00Z");
const products = new Map([
  ["saree-001", P1],
  ["kurti-blue", P2],
]);
const plan = (csv: string, existing = new Set<string>()) => planImport(parseCsv(csv), { products, existing, now: NOW });
const HEAD = "sku,rating,title,text,name,city,date,source,source_url,photos\n";

describe("review dates", () => {
  it("reads ISO and Indian day-first dates as noon IST, and refuses the future", () => {
    expect(parseReviewDate("2026-03-14", NOW)).toEqual({ ok: true, date: new Date("2026-03-14T06:30:00Z") });
    expect(parseReviewDate("14/03/2026", NOW)).toEqual({ ok: true, date: new Date("2026-03-14T06:30:00Z") });
    expect(parseReviewDate("14-03-2026", NOW)).toMatchObject({ ok: true });
    expect(parseReviewDate("2026-10-22", NOW)).toEqual({ ok: false, error: "future" });
    expect(parseReviewDate("2026-02-30", NOW)).toEqual({ ok: false, error: "invalid" });
    expect(parseReviewDate("yesterday", NOW)).toEqual({ ok: false, error: "invalid" });
    expect(parseReviewDate("1999-12-31", NOW)).toEqual({ ok: false, error: "tooOld" });
  });

  it("keeps today's date-only reviews at or before now", () => {
    const early = new Date("2026-10-21T01:00:00Z"); // 06:30 IST, before noon
    const r = parseReviewDate("2026-10-21", early);
    expect(r).toEqual({ ok: true, date: early });
  });
});

describe("staff review input", () => {
  const base = { productId: P1, rating: 5, authorName: "Priya Sharma", source: "in_store" };

  it("needs a source, and a platform only for imported reviews", () => {
    expect(staffReviewInputSchema.parse(base)).toMatchObject({ source: "in_store", status: "approved", photos: [] });
    expect(() => staffReviewInputSchema.parse({ ...base, source: undefined })).toThrow(ZodError);
    expect(() => staffReviewInputSchema.parse({ ...base, source: "customer" })).toThrow(ZodError);
    expect(() => staffReviewInputSchema.parse({ ...base, source: "imported" })).toThrow(/platform/);
    expect(staffReviewInputSchema.parse({ ...base, source: "imported", platform: "google", sourceUrl: "https://g.page/x" })).toMatchObject({ platform: "google" });
    expect(() => staffReviewInputSchema.parse({ ...base, platform: "google" })).toThrow(ZodError);
    expect(() => staffReviewInputSchema.parse({ ...base, sourceUrl: "https://g.page/x" })).toThrow(ZodError);
  });

  it("validates rating, name and photos", () => {
    expect(() => staffReviewInputSchema.parse({ ...base, rating: 6 })).toThrow(ZodError);
    expect(() => staffReviewInputSchema.parse({ ...base, authorName: "  " })).toThrow(ZodError);
    expect(() => staffReviewInputSchema.parse({ ...base, photos: ["javascript:alert(1)"] })).toThrow(ZodError);
    expect(staffReviewInputSchema.parse({ ...base, photos: ["https://a/x.jpg", "https://a/x.jpg"] }).photos).toEqual(["https://a/x.jpg"]);
  });
});

describe("verified purchase (staff-entered)", () => {
  const order = { orderId: "o1", delivered: true, hasProduct: true };
  it("is verified only with a delivered order that contains the product", () => {
    expect(verifyLinkedOrder(null, null)).toEqual({ verified: false, orderId: null });
    expect(verifyLinkedOrder("ORD/26-27/0001", order)).toEqual({ verified: true, orderId: "o1" });
    expect(verifyLinkedOrder("ORD/26-27/0001", null)).toMatchObject({ verified: false, error: expect.stringMatching(/No order/) });
    expect(verifyLinkedOrder("ORD/26-27/0001", { ...order, hasProduct: false })).toMatchObject({ verified: false, error: expect.stringMatching(/doesn't include/) });
    expect(verifyLinkedOrder("ORD/26-27/0001", { ...order, delivered: false })).toMatchObject({ verified: false, error: expect.stringMatching(/isn't delivered/) });
  });
});

describe("CSV", () => {
  it("parses quotes, commas, new lines, BOM and semicolons", () => {
    expect(parseCsv('﻿a,b\n"x, y","he said ""hi""\nbye"\r\n\n1,2')).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"\nbye'],
      ["1", "2"],
    ]);
    expect(parseCsv("a;b\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(() => parseCsv('a\n"open')).toThrow();
  });

  it("maps sources and platforms", () => {
    expect(parseSource("in_store", null)).toEqual({ source: "in_store", platform: null });
    expect(parseSource("In store", null)).toEqual({ source: "in_store", platform: null });
    expect(parseSource("Google", null)).toEqual({ source: "imported", platform: "google" });
    expect(parseSource("imported", "https://www.amazon.in/review/1")).toEqual({ source: "imported", platform: "amazon" });
    expect(parseSource("imported", null)).toEqual({ source: "imported", platform: "other" });
    expect(parseSource("invited", null)).toEqual({ source: "invited", platform: null });
    expect(parseSource("", null)).toBeNull();
    expect(parseSource("whatever", null)).toBeNull();
  });

  it("the template file checks clean against matching products", () => {
    const p = planImport(parseCsv(REVIEW_CSV_TEMPLATE), { products: new Map([["saree-001", P1], ["saree-002", P2]]), existing: new Set(), now: NOW });
    expect(p).toMatchObject({ valid: 2, invalid: 0 });
    expect(p.rows[1]!.values).toMatchObject({ authorName: "Murugan K.", source: "imported", platform: "google", authorCity: "Salem" });
  });

  it("reports row errors: unknown product, bad rating, missing name, future date, bad source", () => {
    const p = plan(
      HEAD +
        "nope,5,,Nice,Priya,,,in_store,,\n" +
        "saree-001,4.5,,Nice,Priya,,,in_store,,\n" +
        "saree-001,5,,Nice,,,,in_store,,\n" +
        "saree-001,5,,Nice,Priya,,2027-01-01,in_store,,\n" +
        "saree-001,5,,Nice,Priya,,,facebook,,\n" +
        "SAREE-001,4/5,,Nice,Priya,,,in_store,,\n",
    );
    expect(p.rows.map((r) => r.errors[0] ?? null)).toEqual([
      'Unknown product "nope"',
      'Rating "4.5" must be a whole number from 1 to 5',
      "Reviewer name missing",
      'Date "2027-01-01": The date can\'t be in the future',
      expect.stringMatching(/^Unknown source "facebook"/),
      null,
    ]);
    expect(p.rows.map((r) => r.line)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(p).toMatchObject({ valid: 1, invalid: 5 });
    expect(p.rows[5]!.values).toMatchObject({ productId: P1, rating: 4, source: "in_store", platform: null, sourceUrl: null });
  });

  it("catches duplicates in the file and against saved reviews (same product, name, day and text)", () => {
    const existing = new Set([duplicateKey(P2, "Divya R.", new Date("2026-05-01T06:30:00Z"), "Fits well")]);
    const p = plan(
      HEAD +
        "saree-001,5,,Soft cotton,Priya Sharma,,2026-03-14,in_store,,\n" +
        "saree-001,4,,soft  COTTON,Priya Sharma,,14/03/2026,google,,\n" +
        "saree-001,5,,Soft cotton,Priya Sharma,,2026-03-15,in_store,,\n" +
        "kurti-blue,5,,Fits well,Divya Ramesh,,2026-05-01,in_store,,\n",
      existing,
    );
    expect(p.rows.map((r) => r.errors)).toEqual([[], [expect.stringMatching(/Repeats an earlier row/)], [], [expect.stringMatching(/Already in your reviews/)]]);
  });

  it("checks photo links and source links", () => {
    const p = plan(
      HEAD +
        "saree-001,5,,a,Priya,,,google,https://g.page/r/1,https://x/1.jpg|https://x/2.jpg\n" +
        "saree-001,5,,b,Priya,,,in_store,https://g.page/r/1,\n" +
        "saree-001,5,,c,Priya,,,google,,ftp://x/1.jpg\n",
    );
    expect(p.rows[0]!.values).toMatchObject({ sourceUrl: "https://g.page/r/1", photos: ["https://x/1.jpg", "https://x/2.jpg"] });
    expect(p.rows[1]!.errors).toEqual(["Only imported reviews have a source link"]);
    expect(p.rows[2]!.errors).toEqual(["Photo links must start with http:// or https://"]);
  });

  it("file-level errors: missing columns, no rows, too many rows", () => {
    expect(plan("sku,title\nsaree-001,x").error).toBe("Missing columns: rating, name");
    expect(plan(HEAD).error).toBe("The file has no review rows");
    expect(plan("").error).toBe("The file is empty");
    const big = HEAD + "saree-001,5,,x,Priya,,,in_store,,\n".repeat(MAX_IMPORT_ROWS + 1);
    expect(plan(big).error).toMatch(/At most 2,000 reviews/);
    expect(plan(HEAD.replace("sku", "Product Slug").replace("name", "Reviewer") + "kurti-blue,3,,ok,Anand,,,instore,,").valid).toBe(1);
  });
});
