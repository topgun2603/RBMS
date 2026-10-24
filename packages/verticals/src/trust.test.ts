import { describe, expect, it } from "vitest";
import { BUSINESS_TYPES, PACKS } from "./packs";
import { PACK_TRUST, packTrust, TRUST_PAYMENT, TRUST_RETURNS } from "./trust";

describe("pack trust defaults", () => {
  it("only names real trades and valid modes, with Tamil for every promise", () => {
    for (const [type, t] of Object.entries(PACK_TRUST)) {
      expect(BUSINESS_TYPES as readonly string[]).toContain(type);
      if (t.returns) expect(TRUST_RETURNS).toContain(t.returns);
      if (t.payment) expect(TRUST_PAYMENT).toContain(t.payment);
      if (t.promise) for (const k of ["title", "text"] as const) for (const l of ["en", "ta"] as const) expect(t.promise[k][l].trim(), `${type} ${k} ${l}`).not.toBe("");
      if (t.promise) expect(t.promise.title.ta).toMatch(/[஀-௿]/);
    }
  });

  it("no-returns trades never claim easy returns; appointment trades pay at the visit", () => {
    expect(packTrust("crackers")).toMatchObject({ returns: "replace", payment: "confirm" });
    expect(packTrust("florist_pooja").returns).toBe("replace");
    expect(packTrust("florist_pooja").promise?.title.en).toBe("Fresh every morning");
    expect(packTrust("cosmetics").returns).toBe("exchange");
    for (const id of ["salon", "spa", "gym"]) expect(packTrust(id)).toMatchObject({ returns: "none", payment: "visit" });
    // Booking trades start on /book.
    expect(PACKS.salon.ctaHref).toBe("/book");
  });

  it("unknown or plain trades get no overrides", () => {
    expect(packTrust("hardware")).toEqual({});
    expect(packTrust("nope")).toEqual({});
    expect(packTrust(null)).toEqual({});
  });
});
