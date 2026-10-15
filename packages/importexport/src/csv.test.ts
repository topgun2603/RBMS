import { describe, expect, it } from "vitest";
import { CsvError, csvCell, detectDelimiter, parseCsv, toCsv } from "./csv";

describe("parseCsv", () => {
  it("parses simple CRLF and LF files, skipping blank lines", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\n1,2\n\n3,4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
    expect(parseCsv("a,b\r1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("strips a UTF-8 BOM and keeps Tamil and ₹", () => {
    expect(parseCsv("﻿பெயர்,விலை\nசேலை,₹1,250")).toEqual([["பெயர்", "விலை"], ["சேலை", "₹1", "250"]]);
    expect(parseCsv('﻿"Name"\n"x"')).toEqual([["Name"], ["x"]]);
  });

  it("handles quoted fields with commas, escaped quotes and newlines", () => {
    const text = 'name,address,note\r\n"Raja, Sons","12, Gandhi Rd\r\nChennai","He said ""hi"""\r\n';
    expect(parseCsv(text)).toEqual([
      ["name", "address", "note"],
      ["Raja, Sons", "12, Gandhi Rd\r\nChennai", 'He said "hi"'],
    ]);
  });

  it("keeps empty fields and trailing empties", () => {
    expect(parseCsv("a,b,c\n1,,\n,,3")).toEqual([["a", "b", "c"], ["1", "", ""], ["", "", "3"]]);
  });

  it("handles a file without a trailing newline and a quoted empty last field", () => {
    expect(parseCsv('a,b\n1,""')).toEqual([["a", "b"], ["1", ""]]);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(parseCsv("a;b\n1,5;2")).toEqual([["a", "b"], ["1,5", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(detectDelimiter('"x;y",b\n')).toBe(",");
  });

  it("rejects an unclosed quote with its line", () => {
    expect(() => parseCsv('a,b\n1,"oops\n2,3')).toThrow(CsvError);
    expect(() => parseCsv('a,b\n1,"oops\n2,3')).toThrow(/line 2/);
  });

  it("enforces the row limit", () => {
    const text = ["h", ...Array.from({ length: 10 }, (_, i) => String(i))].join("\n");
    expect(() => parseCsv(text, { maxRows: 5 })).toThrow(/Too many rows/);
    expect(parseCsv(text, { maxRows: 11 })).toHaveLength(11);
  });
});

describe("writing", () => {
  it("guards against formula injection and quotes when needed", () => {
    expect(csvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(csvCell("+91 98765")).toBe("'+91 98765");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe("");
  });

  it("writes a BOM + CRLF file that parses back", () => {
    const csv = toCsv(["Name", "Note"], [["முருகன்", 'x, "y"'], ["B", null]]);
    expect(csv.startsWith("﻿Name,Note\r\n")).toBe(true);
    expect(parseCsv(csv)).toEqual([["Name", "Note"], ["முருகன்", 'x, "y"'], ["B", ""]]);
  });
});
