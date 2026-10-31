import { describe, expect, it } from "vitest";
import { featureDefaultOn } from "@rbms/core";
import { formatEnquiryNumber, MemoryWindowCounter, toIndianE164 } from "./logic";
import { ENQUIRIES_FEATURES } from "./ports";
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

describe("enquiries feature default", () => {
  it("is on by default only for the school app", () => {
    const [f] = ENQUIRIES_FEATURES;
    expect(featureDefaultOn(f!, "SC")).toBe(true);
    for (const app of ["EC", "BL", "PH", "RS", "SV", null]) expect(featureDefaultOn(f!, app)).toBe(false);
  });
});

describe("MemoryWindowCounter", () => {
  it("counts per key and starts again once the window passes", async () => {
    let t = 0;
    const c = new MemoryWindowCounter(() => t);
    expect((await c.hit("a", 1000)).count).toBe(1);
    expect(await c.hit("a", 1000)).toEqual({ count: 2, resetMs: 1000 });
    expect((await c.hit("b", 1000)).count).toBe(1);
    t = 1001;
    expect((await c.hit("a", 1000)).count).toBe(1);
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
