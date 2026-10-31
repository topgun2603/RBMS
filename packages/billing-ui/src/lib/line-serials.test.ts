import { describe, expect, it } from "vitest";
import { blankLine, linesFromInvoice, parseLine } from "../components/invoice-form";
import { en, ta } from "./messages/line-serials";
import { parseSerialText, serialsError } from "./line-serials";

describe("parseSerialText", () => {
  it("splits on lines, commas and semicolons, upper-cases and drops repeats", () => {
    expect(parseSerialText("abc123\nabc-124, abc125;ABC123 \n\n")).toEqual(["ABC123", "ABC-124", "ABC125"]);
  });
  it("removes spaces inside a value and returns nothing for blank text", () => {
    expect(parseSerialText("35 6938 03 5643 522")).toEqual(["356938035643522"]);
    expect(parseSerialText("  \n ")).toEqual([]);
  });
});

describe("serialsError", () => {
  it("flags more serials than units, rounding fractional quantities up", () => {
    expect(serialsError(["A", "B"], 1)).toBe("billing.form.serials.tooMany");
    expect(serialsError(["A", "B"], 1.5)).toBeNull();
    expect(serialsError(["A"], 3)).toBeNull();
    expect(serialsError(undefined, 1)).toBeNull();
    expect(serialsError(["A"], null)).toBeNull();
  });
});

describe("line serial messages", () => {
  it("have the same keys in English and Tamil", () => {
    expect(Object.keys(ta).sort()).toEqual(Object.keys(en).sort());
  });
});

describe("serials on an invoice line", () => {
  it("go onto the API line, come back from a saved bill, and are checked against the quantity", () => {
    const line = { ...blankLine("18"), description: "Phone", rate: "10000", qty: "2", serials: ["AAA111", "BBB222"] };
    expect(parseLine(line).input).toMatchObject({ qty: 2, serials: ["AAA111", "BBB222"] });
    expect(parseLine({ ...line, serials: ["AAA111", "BBB222", "CCC333"] }).errors.serials).toBe("billing.form.serials.tooMany");
    expect(parseLine({ ...line, serials: undefined }).input).not.toHaveProperty("serials");
    const back = linesFromInvoice({ lines: [{ description: "Phone", qty: 2, rate: 1000000, gstRate: 18, serials: ["AAA111"] }] as never });
    expect(back[0]?.serials).toEqual(["AAA111"]);
  });
});
