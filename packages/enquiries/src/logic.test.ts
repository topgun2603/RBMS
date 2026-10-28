import { describe, expect, it } from "vitest";
import { formatEnquiryNumber, RateLimiter, toIndianE164 } from "./logic";
import { enquiryListQuery, enquiryPatch, publicEnquiryInput } from "./service";

describe("toIndianE164", () => {
  it("accepts the usual ways of writing a mobile", () => {
    for (const v of ["9876543210", "98765 43210", "098765-43210", "+91 98765 43210", "919876543210"]) expect(toIndianE164(v)).toBe("+919876543210");
  });
  it("rejects landlines, short numbers and other countries", () => {
    for (const v of ["", "12345", "0442345678", "+1 415 555 0100", "5876543210", "abc"]) expect(toIndianE164(v)).toBeNull();
  });
});

describe("formatEnquiryNumber", () => {
  it("pads to four digits and then grows", () => {
    expect(formatEnquiryNumber(7)).toBe("ENQ-0007");
    expect(formatEnquiryNumber(12345)).toBe("ENQ-12345");
  });
});

describe("RateLimiter", () => {
  it("stops after the limit and lets through once the window passes", () => {
    let t = 0;
    const l = new RateLimiter(2, 1000, () => t);
    expect(l.hit("a")).toBe(true);
    expect(l.hit("a")).toBe(true);
    expect(l.hit("a")).toBe(false);
    expect(l.hit("b")).toBe(true);
    t = 1001;
    expect(l.hit("a")).toBe(true);
  });
});

describe("publicEnquiryInput", () => {
  it("normalises the phone and trims, dropping empty optional fields", () => {
    const b = publicEnquiryInput.parse({ name: "  Meena   Kumari ", phone: "98765 43210", email: "", topic: " Admission 2027-28 ", option: "", message: "  " });
    expect(b).toMatchObject({ name: "Meena Kumari", phone: "+919876543210", topic: "Admission 2027-28" });
    expect(b.email).toBeUndefined();
    expect(b.option).toBeUndefined();
    expect(b.message).toBeUndefined();
  });
  it("needs a name and an Indian mobile", () => {
    expect(publicEnquiryInput.safeParse({ name: "M", phone: "9876543210" }).success).toBe(false);
    expect(publicEnquiryInput.safeParse({ name: "Meena", phone: "12345" }).success).toBe(false);
    expect(publicEnquiryInput.safeParse({ name: "Meena", phone: "9876543210", email: "nope" }).success).toBe(false);
  });
  it("caps long fields", () => {
    expect(publicEnquiryInput.safeParse({ name: "Meena", phone: "9876543210", message: "x".repeat(1001) }).success).toBe(false);
    expect(publicEnquiryInput.safeParse({ name: "Meena", phone: "9876543210", topic: "x".repeat(61) }).success).toBe(false);
  });
});

describe("staff inputs", () => {
  it("patch needs a status or a note; an empty note clears it", () => {
    expect(enquiryPatch.safeParse({}).success).toBe(false);
    expect(enquiryPatch.safeParse({ status: "lost" }).success).toBe(false);
    expect(enquiryPatch.parse({ note: "  " })).toEqual({ note: null });
    expect(enquiryPatch.parse({ status: "contacted" })).toEqual({ status: "contacted" });
  });
  it("list query takes status lists and rejects a reversed range", () => {
    expect(enquiryListQuery.parse({ status: "new,contacted" }).status).toEqual(["new", "contacted"]);
    expect(enquiryListQuery.safeParse({ from: "2026-10-10", to: "2026-10-01" }).success).toBe(false);
  });
});
