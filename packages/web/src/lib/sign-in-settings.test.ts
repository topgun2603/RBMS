import { describe, expect, it } from "vitest";
import { isLastUsable, makeFirst, sameOptions, toggleMethod, type AudienceOptions } from "./sign-in-settings";

const opts = (): AudienceOptions => ({ methods: ["sms", "whatsapp", "email_code"], default: "sms" });
const platform = { sms: true, whatsapp: true, email_code: true, google: false, password: true };

describe("sign-in settings helpers", () => {
  it("turning a method on appends it; off removes it", () => {
    expect(toggleMethod(opts(), "password", true)).toEqual({ methods: ["sms", "whatsapp", "email_code", "password"], default: "sms" });
    expect(toggleMethod(opts(), "whatsapp", false)).toEqual({ methods: ["sms", "email_code"], default: "sms" });
    const same = opts();
    expect(toggleMethod(same, "sms", true)).toBe(same);
  });
  it("turning the preferred method off moves 'shown first' to the next one", () => {
    expect(toggleMethod(opts(), "sms", false)).toEqual({ methods: ["whatsapp", "email_code"], default: "whatsapp" });
  });
  it("the last method cannot be turned off", () => {
    expect(toggleMethod({ methods: ["email_code"], default: "email_code" }, "email_code", false)).toBeNull();
  });
  it("makeFirst moves an enabled method to the front and ignores one that is off", () => {
    expect(makeFirst(opts(), "email_code")).toEqual({ methods: ["email_code", "sms", "whatsapp"], default: "email_code" });
    const same = opts();
    expect(makeFirst(same, "google")).toBe(same);
  });
  it("sameOptions compares order and preferred method", () => {
    expect(sameOptions(opts(), opts())).toBe(true);
    expect(sameOptions(opts(), makeFirst(opts(), "email_code"))).toBe(false);
  });
  it("a method is the last usable one when the rest are off or missing on the platform", () => {
    expect(isLastUsable(opts(), "sms", platform)).toBe(false);
    expect(isLastUsable({ methods: ["google", "sms"], default: "sms" }, "sms", platform)).toBe(true); // google isn't available here
    expect(isLastUsable({ methods: ["sms"], default: "sms" }, "sms", platform)).toBe(true);
  });
});
