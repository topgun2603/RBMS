import { describe, expect, it } from "vitest";
import { last4, maskAadhaar, maskAccountNumber, maskPan, maskPhone, maskVpa, scrubPii, scrubText } from "./mask";

describe("masking", () => {
  it("PAN keeps the last 4", () => expect(maskPan("abcde1234f")).toBe("XXXXXX234F"));
  it("account number keeps length and last 4", () => {
    expect(maskAccountNumber("1234 5678 9012")).toBe("XXXXXXXX9012");
    expect(maskAccountNumber("123")).toBe("XXX");
  });
  it("Aadhaar shows only the last 4", () => {
    expect(maskAadhaar("234123412346")).toBe("XXXX XXXX 2346");
    expect(maskAadhaar("xxxx-xxxx-0123")).toBe("XXXX XXXX 0123");
    expect(maskAadhaar("")).toBe("XXXX XXXX XXXX");
  });
  it("VPA hides most of the local part", () => {
    expect(maskVpa("Gowtham.Kumar@okhdfc")).toBe("go***********@okhdfc");
    expect(maskVpa("9876543210@ybl")).toBe("XXXXXXXX10@ybl");
    expect(maskVpa("ab@upi")).toBe("ab*@upi");
  });
  it("phone keeps the country code and last 4", () => {
    expect(maskPhone("+91 98765 43210")).toBe("+91XXXXXX3210");
    expect(maskPhone("9876543210")).toBe("XXXXXX3210");
  });
  it("last4", () => {
    expect(last4("XXXX-XXXX-0123")).toBe("0123");
    expect(last4("12")).toBeNull();
  });
});

describe("scrubPii", () => {
  it("masks Aadhaar-like and account-like digit runs in text", () => {
    expect(scrubText("uid 2341 2341 2346 ok")).toBe("uid XXXX XXXX 2346 ok");
    expect(scrubText("acc 001234567890123")).toBe("acc XXXXXXXXXXX0123");
    expect(scrubText("pin 600001, phone 98765")).toBe("pin 600001, phone 98765");
  });
  it("drops raw-identifier and image keys, deep", () => {
    const out = scrubPii({
      full_name: "GOWTHAM KUMAR",
      aadhaar_number: "234123412346",
      account_number: "123456789012",
      nested: { profile_image: "base64...", note: "a/c 123456789012", list: [{ id_number: "x", ok: 1 }] },
      count: 3,
    });
    expect(out).toEqual({ full_name: "GOWTHAM KUMAR", nested: { note: "a/c XXXXXXXX9012", list: [{ ok: 1 }] }, count: 3 });
  });
  it("caps depth and string length", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    expect(JSON.stringify(scrubPii(deep))).not.toContain("g");
    expect((scrubPii("x".repeat(900)) as string).length).toBe(500);
  });
});
