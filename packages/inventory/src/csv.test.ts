import { describe, expect, it } from "vitest";
import { CSV_BOM, csvDisposition, csvField, toCsv } from "./csv";

describe("toCsv", () => {
  it("writes a BOM, header and CRLF-separated rows", () => {
    const csv = toCsv(
      [
        { name: "Cotton saree", qty: 2.5 },
        { name: "Rice, Ponni 25kg", qty: 10 },
      ],
      [
        { header: "Item", value: (r) => r.name },
        { header: "Qty", value: (r) => r.qty },
      ],
    );
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(1)).toBe('Item,Qty\r\nCotton saree,2.5\r\n"Rice, Ponni 25kg",10\r\n');
  });
  it("quotes quotes, newlines and padded text", () => {
    expect(csvField('5" border')).toBe('"5"" border"');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvField(" x")).toBe('" x"');
    expect(csvField("plain")).toBe("plain");
  });
  it("renders empties, numbers, booleans and dates", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
    expect(csvField(-5)).toBe("-5");
    expect(csvField(true)).toBe("true");
    expect(csvField(new Date("2026-10-14T00:00:00Z"))).toBe("2026-10-14T00:00:00.000Z");
  });
  it("neutralises spreadsheet formulas in text", () => {
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvField("-1+2")).toBe("'-1+2");
  });
  it("keeps Tamil text intact", () => {
    expect(toCsv([{ n: "பட்டு புடவை" }], [{ header: "பெயர்", value: (r) => r.n }])).toBe(`${CSV_BOM}பெயர்\r\nபட்டு புடவை\r\n`);
  });
  it("header only when there are no rows", () => {
    expect(toCsv([], [{ header: "A", value: () => 1 }])).toBe(`${CSV_BOM}A\r\n`);
  });
});

describe("csvDisposition", () => {
  it("builds the attachment filename", () => {
    expect(csvDisposition("purchases", "2026-10-01", "2026-10-31")).toBe('attachment; filename="purchases-2026-10-01-2026-10-31.csv"');
    expect(csvDisposition('st"ock', "a b", "c")).toBe('attachment; filename="st_ock-a_b-c.csv"');
  });
});
