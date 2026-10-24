import { describe, expect, it } from "vitest";
import {
  PAIRING_ALPHABET,
  assertPinAllowed,
  cursorFor,
  decodeCursor,
  decodePageToken,
  encodeCursor,
  encodePageToken,
  endOfIstDay,
  formatPairingCode,
  isWeakPin,
  newPairingCode,
  newTicketCode,
  normalizePairingCode,
  pairingQr,
  pinLookup,
  priceLine,
  settingsOf,
  startOfIstDay,
  TICKET_CODE_RE,
  type PriceableItem,
} from "./logic";

describe("pairing codes", () => {
  it("are 8 characters of the alphabet, shown with a dash, read back case- and dash-insensitively", () => {
    for (let i = 0; i < 50; i++) {
      const c = newPairingCode();
      expect(c).toHaveLength(8);
      for (const ch of c) expect(PAIRING_ALPHABET).toContain(ch);
      expect(normalizePairingCode(formatPairingCode(c).toLowerCase())).toBe(c);
    }
    expect(normalizePairingCode("abcd 2345")).toBe("ABCD2345");
    expect(normalizePairingCode("ABCD-234")).toBeNull();
    expect(normalizePairingCode("ABCD-23O5")).toBeNull(); // O is not in the alphabet
    expect(pairingQr("https://api.x.in/", "ABCD2345")).toBe("srikit-pair:1:https://api.x.in:ABCD-2345");
  });
});

describe("PINs", () => {
  it("refuses repeated digits and runs, accepts the rest", () => {
    for (const p of ["0000", "1111", "999999", "1234", "123456", "4321", "987654", "7890", "0123"]) expect(isWeakPin(p)).toBe(true);
    for (const p of ["1357", "2468", "8023", "120934", "1122"]) expect(isWeakPin(p)).toBe(false);
    expect(() => assertPinAllowed("123")).toThrow(expect.objectContaining({ code: "pin_weak" }));
    expect(() => assertPinAllowed("12a4")).toThrow(expect.objectContaining({ code: "pin_weak" }));
    expect(() => assertPinAllowed("1234")).toThrow(expect.objectContaining({ code: "pin_weak" }));
    expect(assertPinAllowed(" 8023 ")).toBe("8023");
  });
  it("looks up by HMAC of tenant and PIN", () => {
    const a = pinLookup("k", "t1", "8023");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(pinLookup("k", "t2", "8023")).not.toBe(a);
    expect(pinLookup("k2", "t1", "8023")).not.toBe(a);
  });
});

describe("weigh tickets", () => {
  const rice: PriceableItem = { itemId: "i1", name: "Rice", unit: "kg", soldBy: "weight", price: 6000, taxInclusive: true, gstRate: 5, hsn: "1006", tareKg: 0.01 };
  const soap: PriceableItem = { itemId: "i2", name: "Soap", unit: "pcs", soldBy: "unit", price: 3500, taxInclusive: true, gstRate: 18, hsn: null };
  it("prices weighed lines per kg of net weight, rounded to the paisa", () => {
    expect(priceLine(rice, { itemId: "i1", weightKg: 1.234, tareKg: 0.05 }, 0)).toMatchObject({ qty: 1.184, amount: 7104, unitPrice: 6000, tareKg: 0.05 });
    // The PLU's tare when the line gives none.
    expect(priceLine(rice, { itemId: "i1", weightKg: 0.51 }, 0)).toMatchObject({ qty: 0.5, amount: 3000, tareKg: 0.01 });
    expect(priceLine({ ...rice, unit: "g", price: 12 }, { itemId: "i1", weightKg: 0.25, tareKg: 0 }, 0)).toMatchObject({ qty: 250, amount: 3000 });
  });
  it("refuses bad lines", () => {
    expect(() => priceLine(undefined, { itemId: "x" }, 2)).toThrow(expect.objectContaining({ code: "invalid_line", details: { index: 2, reason: "item_not_found" } }));
    expect(() => priceLine(rice, { itemId: "i1" }, 0)).toThrow(expect.objectContaining({ details: { index: 0, reason: "weight_required" } }));
    expect(() => priceLine(rice, { itemId: "i1", weightKg: 0.2, tareKg: 0.2 }, 0)).toThrow(expect.objectContaining({ details: { index: 0, reason: "invalid_weight" } }));
    expect(() => priceLine(rice, { itemId: "i1", weightKg: 1000.5, tareKg: 0 }, 0)).toThrow(expect.objectContaining({ details: { index: 0, reason: "invalid_weight" } }));
    expect(() => priceLine(soap, { itemId: "i2", qty: 1.2345 }, 0)).toThrow(expect.objectContaining({ details: { index: 0, reason: "invalid_qty" } }));
  });
  it("prices count lines at price × qty", () => {
    expect(priceLine(soap, { itemId: "i2", qty: 3 }, 0)).toMatchObject({ qty: 3, amount: 10500 });
    expect(priceLine(soap, { itemId: "i2" }, 0)).toMatchObject({ qty: 1, amount: 3500 });
  });
  it("codes are W + 11 digits; tickets expire at the end of the IST day", () => {
    for (let i = 0; i < 20; i++) expect(newTicketCode()).toMatch(TICKET_CODE_RE);
    const now = new Date("2026-10-22T20:00:00Z"); // 01:30 IST on the 23rd
    expect(endOfIstDay(now).toISOString()).toBe("2026-10-23T18:30:00.000Z");
    expect(startOfIstDay(now).toISOString()).toBe("2026-10-22T18:30:00.000Z");
    expect(endOfIstDay(new Date("2026-10-22T10:00:00Z")).toISOString()).toBe("2026-10-22T18:30:00.000Z");
  });
});

describe("catalogue cursors", () => {
  it("round-trip; junk cursors start over, junk page tokens are refused", () => {
    const now = new Date("2026-10-22T10:00:45Z");
    expect(new Date(cursorFor(now)).toISOString()).toBe("2026-10-22T10:00:00.000Z");
    expect(decodeCursor(encodeCursor(123))).toBe(123);
    expect(decodeCursor("nonsense")).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    const t = { c: 5, s: null, a: "11111111-1111-4111-8111-111111111111" };
    expect(decodePageToken(encodePageToken(t))).toEqual(t);
    expect(() => decodePageToken("junk")).toThrow(expect.objectContaining({ status: 400 }));
  });
  it("settings get defaults", () => {
    expect(settingsOf({})).toEqual({ printerWidth: 80, autoPrint: false, lockAfterMinutes: 5 });
    expect(settingsOf({ printerWidth: 58, autoPrint: true, lockAfterMinutes: 10 })).toEqual({ printerWidth: 58, autoPrint: true, lockAfterMinutes: 10 });
  });
});
