import { describe, expect, it } from "vitest";
import { validateAttachments } from "./service";
import { base64Size } from "./types";

describe("validateAttachments", () => {
  const a = { filename: "r.csv", contentType: "text/csv", content: Buffer.from("hello").toString("base64") };

  it("passes email attachments through and ignores empty lists", () => {
    expect(validateAttachments("email", [a])).toEqual([a]);
    expect(validateAttachments("sms", [])).toBeUndefined();
    expect(validateAttachments("sms", undefined)).toBeUndefined();
  });

  it("rejects attachments on other channels and malformed ones", () => {
    expect(() => validateAttachments("whatsapp", [a])).toThrow(/only supported on the email channel/);
    expect(() => validateAttachments("email", [{ ...a, filename: "" }])).toThrow(/filename/);
    expect(() => validateAttachments("email", [{ ...a, contentType: "" }])).toThrow(/contentType/);
    expect(() => validateAttachments("email", [{ ...a, content: "not base64!" }])).toThrow(/base64/);
  });

  it("computes decoded sizes", () => {
    for (const s of ["", "a", "ab", "abc", "hello world"]) expect(base64Size(Buffer.from(s).toString("base64"))).toBe(s.length);
  });
});
