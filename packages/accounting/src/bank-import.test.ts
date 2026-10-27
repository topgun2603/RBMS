import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { cleanRef, findHeader, lineHashes, mapHeader, parseBankAmount, parseBankDate, parseStatement, readStatementFile } from "./bank-import";
import { excelSerialToDate, readXlsx } from "./xlsx-lite";

const enc = (s: string) => new TextEncoder().encode(s);
const parseText = (s: string) => parseStatement(readStatementFile(enc(s)));

// ------------------------------------------------------------------ fixtures (shapes of common Indian bank downloads)

/** HDFC netbanking "delimited" download: account details on top, asterisk rows, dd/mm/yy dates. */
const HDFC = `HDFC BANK Ltd.,,,,,,
Statement of account,,,,,,
Account No :,50100123456789,,,,,
,,,,,,
Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
********,********,********,********,********,********,********
01/10/26,UPI-RAVI KUMAR-ravi@okaxis-ICIC0001234-627412345678-PAYMENT,0000627412345678,01/10/26,,"1,180.00","51,180.00"
03/10/26,NEFT DR-KUMAR TRADERS-N276263123456,N276263123456,03/10/26,"59,000.00",,"-7,820.00"
05/10/26,CHQ DEP-000123-MEENA STORES,000123,05/10/26,,"25,000.00","17,180.00"
07/10/26,SMS CHARGES QTR SEP26,,07/10/26,17.70,,"17,162.30"
********,********,********,********,********,********,********
STATEMENT SUMMARY :-,,,,,,
Opening Balance,Dr Count,Cr Count,Debits,Credits,Closing Bal,
"50,000.00",2,2,"59,017.70","26,180.00","17,162.30",
`;

/** ICICI: serial number, value / transaction date, cheque number, remarks, (INR ) amounts. */
const ICICI = `DETAILED STATEMENT,,,,,,,
Transactions List - ICICI BANK,,,,,,,
S No.,Value Date,Transaction Date,Cheque Number,Transaction Remarks,Withdrawal Amount (INR ),Deposit Amount (INR ),Balance (INR )
1,01/10/2026,01/10/2026,-,UPI/627412345678/PAYMENT FROM RAVI/ravi@okaxis,0.00,1180.00,51180.00
2,02/10/2026,02/10/2026,456789,CLG/KUMAR TRADERS/CHQ 456789,"20,000.00",0.00,"31,180.00"
3,04/10/2026,04/10/2026,-,INT.PD:01-07-2026 TO 30-09-2026,0.00,312.00,"31,492.00"
`;

/** SBI: tab separated text, "1 Oct 2026" dates, Ref No./Cheque No., branch code. */
const SBI = [
  "Account Name\t:\tMR GOWTHAM KUMAR",
  "Account Number\t:\t00000012345678901",
  "",
  "Txn Date\tValue Date\tDescription\tRef No./Cheque No.\tBranch Code\tDebit\tCredit\tBalance",
  "1 Oct 2026\t1 Oct 2026\tBY TRANSFER-UPI/CR/627412345678/RAVI KUMAR\tTRANSFER FROM 1234\t1234\t\t1,180.00\t51,180.00",
  "2 Oct 2026\t2 Oct 2026\tTO TRANSFER-NEFT KUMAR TRADERS\tTRANSFER TO 99\t99\t59,000.00\t\t-7,820.00",
  "\t\tcontinued narration line\t\t\t\t\t",
  "**Computer generated statement**",
].join("\n");

/** Axis: Tran Date, CHQNO, PARTICULARS, DR, CR, BAL, SOL; newest first. */
const AXIS = `Statement of Axis Account No :123456789
Tran Date,CHQNO,PARTICULARS,DR,CR,BAL,SOL
05-10-2026,,ECOM PUR/AMAZON/1234,500.00,,"9,500.00",1234
02-10-2026,,BY CASH DEPOSIT,,"10,000.00","10,000.00",1234
`;

/** Kotak: one amount column with Dr/Cr, and a Dr/Cr after the balance. */
const KOTAK = `Kotak Mahindra Bank,,,,,,,,
Sl. No.,Transaction Date,Value Date,Description,Chq / Ref No.,Amount,Dr / Cr,Balance,Dr / Cr
1,01-10-2026,01-10-2026,UPI/RAVI KUMAR/627412345678,UPI-627412345678,"1,180.00",CR,"1,180.00",CR
2,03-10-2026,03-10-2026,NEFT KUMAR TRADERS,N276,"2,000.00",DR,820.00,DR
`;

/** A generic layout: ISO dates, signed amount column. */
const GENERIC = `Date,Description,Reference,Amount,Balance
2026-10-01,Card settlement 30 Sep,CS-0930,"4,876.50","4,876.50"
2026-10-02,Rent October,RENT-10,-25000,"-20,123.50"
`;

/** An HTML table saved as .xls (several banks do this). */
const HTML_XLS = `<html><body><table>
<tr><td>Account statement</td></tr>
<tr><th>Date</th><th>Narration</th><th>Chq/Ref No</th><th>Withdrawal</th><th>Deposit</th><th>Balance</th></tr>
<tr><td>01/10/2026</td><td>UPI&nbsp;CR RAVI &amp; SONS</td><td>627412345678</td><td></td><td>1,180.00</td><td>1,180.00</td></tr>
<tr><td>02/10/2026</td><td>ATM WDL</td><td></td><td>500.00</td><td></td><td>680.00</td></tr>
</table></body></html>`;

describe("reading statement files", () => {
  it("HDFC: skips the account details and the asterisk / summary rows, reads dd/mm/yy dates and signed balances", () => {
    const r = parseText(HDFC);
    expect(r.layout).toBe("hdfc");
    expect(r.lines).toHaveLength(4);
    expect(r.lines[0]).toMatchObject({ date: "2026-10-01", amount: 118_000, balance: 5_118_000, reference: "0000627412345678" });
    expect(r.lines[1]).toMatchObject({ date: "2026-10-03", amount: -5_900_000, balance: -782_000 });
    expect(r.lines[3]).toMatchObject({ amount: -1_770, narration: "SMS CHARGES QTR SEP26" });
    expect(r.errors).toEqual([]);
    expect(r.openingBalance).toBe(5_000_000);
    expect(r.closingBalance).toBe(1_716_230);
    expect(r.warnings).toEqual([]);
  });

  it("ICICI: (INR ) headings, a dash for no cheque number, serial numbers ignored", () => {
    const r = parseText(ICICI);
    expect(r.layout).toBe("icici");
    expect(r.lines.map((l) => l.amount)).toEqual([118_000, -2_000_000, 31_200]);
    expect(r.lines[0]!.reference).toBeNull();
    expect(r.lines[1]!.reference).toBe("456789");
    expect(r.mapping.valueDate).toBe(1);
    expect(r.mapping.date).toBe(2);
  });

  it("SBI: tab separated, '1 Oct 2026' dates, a narration continued on the next row, footer left out", () => {
    const r = parseText(SBI);
    expect(r.layout).toBe("sbi");
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ date: "2026-10-01", amount: 118_000 });
    expect(r.lines[1]!.narration).toBe("TO TRANSFER-NEFT KUMAR TRADERS continued narration line");
    expect(r.errors).toEqual([]);
  });

  it("Axis: DR / CR / BAL columns; newest first is turned oldest first", () => {
    const r = parseText(AXIS);
    expect(r.layout).toBe("axis");
    expect(r.reversed).toBe(true);
    expect(r.lines.map((l) => [l.date, l.amount])).toEqual([
      ["2026-10-02", 1_000_000],
      ["2026-10-05", -50_000],
    ]);
    expect(r.openingBalance).toBe(0);
  });

  it("Kotak: one amount column with Dr/Cr, and the balance's own Dr/Cr", () => {
    const r = parseText(KOTAK);
    expect(r.layout).toBe("kotak");
    expect(r.lines.map((l) => l.amount)).toEqual([118_000, -200_000]);
    expect(r.lines[1]!.balance).toBe(-82_000);
    expect(r.mapping.drcr).toBe(6);
  });

  it("a generic file with a signed amount column and ISO dates", () => {
    const r = parseText(GENERIC);
    expect(r.layout).toBe("generic");
    expect(r.lines.map((l) => l.amount)).toEqual([487_650, -2_500_000]);
    expect(r.closingBalance).toBe(-2_012_350);
  });

  it("an HTML table saved as .xls", () => {
    const r = parseText(HTML_XLS);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]!.narration).toBe("UPI CR RAVI & SONS");
    expect(r.lines[1]!.amount).toBe(-50_000);
  });

  it("refuses binary .xls and PDF with a plain message", () => {
    expect(() => readStatementFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).toThrow(/save it as .xlsx or CSV/);
    expect(() => readStatementFile(enc("%PDF-1.7 ..."))).toThrow(/PDF statements/);
    expect(() => readStatementFile(new Uint8Array())).toThrow(/empty/);
  });

  it("reports rows with dates it does not understand and lets the owner choose the columns", () => {
    const text = `Date,Details,Debit,Credit\n31/02/2026,Bad date,10,\n01/03/2026,Good,,20\n`;
    const r = parseText(text);
    expect(r.errors).toEqual([{ row: 2, message: 'Date "31/02/2026" not understood' }]);
    expect(r.lines).toHaveLength(1);
    const swapped = parseStatement(readStatementFile(enc(text)), { mapping: { debit: 3, credit: 2 } });
    expect(swapped.lines[0]!.amount).toBe(-2_000);
    expect(() => parseText("a,b\n1,2\n")).toThrow(/column headings/);
  });

  it("warns when the balance moves the other way (withdrawal and deposit columns swapped)", () => {
    const text = `Date,Narration,Withdrawal,Deposit,Balance\n01/10/2026,a,100.00,,1100.00\n02/10/2026,b,100.00,,1200.00\n03/10/2026,c,,50.00,1150.00\n04/10/2026,d,10.00,,1160.00\n`;
    expect(parseText(text).warnings[0]).toMatch(/swapped/);
  });
});

describe("values", () => {
  it("amounts to exact paise", () => {
    expect(parseBankAmount("1,23,456.78")).toBe(12_345_678);
    expect(parseBankAmount("₹ 500")).toBe(50_000);
    expect(parseBankAmount("500.00 Cr")).toBe(50_000);
    expect(parseBankAmount("500.00 Dr")).toBe(-50_000);
    expect(parseBankAmount("(250.50)")).toBe(-25_050);
    expect(parseBankAmount("-75")).toBe(-7_500);
    expect(parseBankAmount("75-")).toBe(-7_500);
    expect(parseBankAmount("0.1")).toBe(10);
    expect(parseBankAmount("19.999")).toBe(2_000);
    expect(parseBankAmount("1.5E3")).toBe(150_000);
    expect(parseBankAmount("-")).toBeNull();
    expect(parseBankAmount("")).toBeNull();
    expect(parseBankAmount("abc")).toBeNull();
  });

  it("dates, day first", () => {
    expect(parseBankDate("05/10/26")).toBe("2026-10-05");
    expect(parseBankDate("05-10-2026")).toBe("2026-10-05");
    expect(parseBankDate("05.10.2026")).toBe("2026-10-05");
    expect(parseBankDate("05-Oct-2026")).toBe("2026-10-05");
    expect(parseBankDate("5 Sept 2026")).toBe("2026-09-05");
    expect(parseBankDate("Oct 5, 2026")).toBe("2026-10-05");
    expect(parseBankDate("2026-10-05T10:00:00")).toBe("2026-10-05");
    expect(parseBankDate("10/05/2026", "mdy")).toBe("2026-10-05");
    expect(parseBankDate("46300")).toBe("2026-10-05");
    expect(parseBankDate("31/04/2026")).toBeNull();
    expect(parseBankDate("hello")).toBeNull();
  });

  it("cheque / reference numbers keep their digits, lose placeholders", () => {
    expect(cleanRef("000123")).toBe("000123");
    expect(cleanRef("-")).toBeNull();
    expect(cleanRef("N276263")).toBe("N276263");
  });

  it("maps headers by name, not position, and finds the header row", () => {
    expect(mapHeader(["Balance", "Deposit Amt.", "Withdrawal Amt.", "Narration", "Date"])).toEqual({ balance: 0, credit: 1, debit: 2, narration: 3, date: 4 });
    expect(findHeader([["x"], ["Txn Date", "Description", "Debit", "Credit"]])?.index).toBe(1);
  });
});

describe("de-duplication hashes", () => {
  it("same line gives the same hash; two identical lines in one file differ; re-import is idempotent", () => {
    const a = { date: "2026-10-01", amount: 50_000, reference: null, narration: "UPI RAVI" };
    const h1 = lineHashes([a, a]);
    expect(h1[0]).not.toBe(h1[1]);
    expect(lineHashes([a, a])).toEqual(h1);
    expect(lineHashes([{ ...a, narration: "upi  ravi" }])[0]).toBe(h1[0]);
    expect(lineHashes([{ ...a, amount: 50_001 }])[0]).not.toBe(h1[0]);
    // An overlapping file that starts later still lines up for the lines both share.
    const b = { date: "2026-10-02", amount: -100, reference: "9", narration: "X" };
    expect(lineHashes([a, b])[1]).toBe(lineHashes([b])[0]);
  });
});

// ------------------------------------------------------------------ xlsx

/** A minimal .xlsx (ZIP with deflate) written by hand, the way Excel stores it. */
function makeXlsx(rows: (string | number | { date: number })[][]): Uint8Array {
  const shared: string[] = [];
  const si = (s: string) => {
    let i = shared.indexOf(s);
    if (i < 0) i = shared.push(s) - 1;
    return i;
  };
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheetRows = rows
    .map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => (typeof c === "number" ? `<c r="${col(ci)}${ri + 1}"><v>${c}</v></c>` : typeof c === "object" ? `<c r="${col(ci)}${ri + 1}" s="1"><v>${c.date}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="s"><v>${si(c)}</v></c>`)).join("")}</row>`)
    .join("");
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Statement" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
    "xl/sharedStrings.xml": `<?xml version="1.0"?><sst>${shared.map((s) => `<si><t>${s.replace(/&/g, "&amp;")}</t></si>`).join("")}</sst>`,
    "xl/styles.xml": `<?xml version="1.0"?><styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>`,
  };
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, body] of Object.entries(files)) {
    const raw = enc(body);
    const data = new Uint8Array(deflateRawSync(raw));
    const nameB = enc(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, 8, true);
    local.setUint32(14, crc32(raw), true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameB.length, true);
    parts.push(new Uint8Array(local.buffer), nameB, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(10, 8, true);
    cd.setUint32(16, crc32(raw), true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, nameB.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cdSize = central.reduce((t, p) => t + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((t, p) => t + p.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe("xlsx statements", () => {
  it("reads shared strings, numbers and date-formatted cells", () => {
    const file = makeXlsx([
      ["Statement of account"],
      ["Txn Date", "Narration", "Debit", "Credit", "Balance"],
      [{ date: 46_296 }, "UPI CR RAVI & CO", "", 1180, 1180],
      [{ date: 46_297 }, "ATM", 500, "", 680],
    ]);
    expect(excelSerialToDate(46_296)).toBe("2026-10-01");
    const rows = readXlsx(file);
    expect(rows[2]![0]).toBe("2026-10-01");
    expect(rows[2]![1]).toBe("UPI CR RAVI & CO");
    const r = parseStatement(readStatementFile(file, "statement.xlsx"));
    expect(r.lines.map((l) => [l.date, l.amount, l.balance])).toEqual([
      ["2026-10-01", 118_000, 118_000],
      ["2026-10-02", -50_000, 68_000],
    ]);
  });

  it("a damaged workbook is refused with a message", () => {
    const file = makeXlsx([["Date"]]);
    expect(() => readStatementFile(file.slice(0, 40))).toThrow(/not a valid .xlsx/);
  });
});

describe("hash stability", () => {
  it("a reference with or without leading zeros hashes the same (files imported before keep matching)", () => {
    const a = { date: "2026-10-26", amount: -300_000, reference: "004512", narration: "CHQ PAID" };
    expect(lineHashes([a])[0]).toBe(lineHashes([{ ...a, reference: "4512" }])[0]);
  });
});
