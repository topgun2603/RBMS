import { describe, expect, it } from "vitest";
import { creditNoteShare } from "./logic";

describe("creditNoteShare", () => {
  it("takes back the same share of the earned points, half up", () => {
    expect(creditNoteShare({ points: 105, amountPaise: 10_500_00 }, 5_250_00, 0)).toBe(53);
    expect(creditNoteShare({ points: 100, amountPaise: 10_000 }, 2_500, 0)).toBe(25);
  });
  it("never more than what is left after earlier notes, never negative", () => {
    expect(creditNoteShare({ points: 100, amountPaise: 10_000 }, 10_000, 80)).toBe(20);
    expect(creditNoteShare({ points: 100, amountPaise: 10_000 }, 20_000, 0)).toBe(100);
    expect(creditNoteShare({ points: 100, amountPaise: 10_000 }, 5_000, 120)).toBe(0);
    expect(creditNoteShare({ points: 0, amountPaise: 10_000 }, 5_000, 0)).toBe(0);
  });
});
