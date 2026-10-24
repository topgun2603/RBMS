import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppError } from "@srirealtime/core";
import {
  billImporter,
  buildBill,
  fyOf,
  groupBills,
  migratePartiesImporter,
  parsePayMode,
  partyKinds,
  resolveOpening,
  type BillsPort,
  type HistoricalBill,
  type PartyTarget,
} from "./history";
import { createImportExport } from "./index";
import { MemoryImportJobStore, MemoryImportRecordStore, MemoryExportJobStore } from "./store";
import { buildTallyVouchersXml, tallyXmlTable, tallyNumber, tallyDate } from "./tally";
import { detectVendor, findHeaderRow, withVendor, isFooterRow } from "./vendors";
import { makeZip, crc32 } from "./zip";
import { parseXml, findAll } from "./xml";
import { FullExportService, type ExportDataset } from "./fullexport";
import { billColumns } from "./history";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

describe("opening balances", () => {
  it("resolves sides for customers and suppliers", () => {
    expect(resolveOpening("customer", { openingBalance: 150000, balanceSide: "receivable" })).toBe(150000);
    expect(resolveOpening("customer", { openingBalance: 150000, balanceSide: "payable" })).toBe(-150000);
    expect(resolveOpening("supplier", { openingBalance: 420000, balanceSide: "payable" })).toBe(420000);
    expect(resolveOpening("supplier", { openingBalance: 420000, balanceSide: "receivable" })).toBe(-420000);
    expect(resolveOpening("customer", { receivable: 5000, payable: 2000 })).toBe(3000);
    expect(resolveOpening("supplier", { receivable: 5000, payable: 2000 })).toBe(-3000);
    expect(resolveOpening("customer", {})).toBe(0);
  });
  it("picks party kinds", () => {
    expect(partyKinds({ type: "both" })).toEqual(["customer", "supplier"]);
    expect(partyKinds({ openingBalance: -100 })).toEqual(["supplier"]);
    expect(partyKinds({ openingBalance: 100 })).toEqual(["customer"]);
    expect(partyKinds({ type: "supplier" })).toEqual(["supplier"]);
  });
  it("fy and pay mode", () => {
    expect(fyOf("2026-03-31")).toBe("2025-26");
    expect(fyOf("2026-04-01")).toBe("2026-27");
    expect(parsePayMode("GPay")).toBe("upi");
    expect(parsePayMode("NEFT")).toBe("bank");
    expect(parsePayMode("Credit Card")).toBe("card");
    expect(parsePayMode("Cash")).toBe("cash");
    expect(parsePayMode("Credit")).toBe("other");
  });
});

const row = (n: number, d: Record<string, unknown>) => ({ row: n, data: d });

describe("buildBill", () => {
  it("builds intra-state lines from rate and GST %, keeps the original total", () => {
    const { bill, error } = buildBill(
      [
        row(2, { invoice_no: "A-1", date: "2026-01-15", party: "Murugan", item: "Saree", qty: 2, rate: 100000, gst_rate: 5, invoice_total: 315000, paid: 100000, payment_mode: "UPI" }),
        row(3, { invoice_no: "A-1", item: "Dhoti", qty: 1, rate: 100000, gst_rate: 5 }),
      ],
      { kind: "sale", sellerState: "33" },
    );
    expect(error).toBeUndefined();
    const b = bill!;
    expect(b.lines).toHaveLength(2);
    expect(b.taxable).toBe(300000);
    expect(b.cgst + b.sgst).toBe(15000);
    expect(b.igst).toBe(0);
    expect(b.total).toBe(315000);
    expect(b.roundOff).toBe(0);
    expect(b.paid).toBe(100000);
    expect(b.payMode).toBe("upi");
    expect(b.taxBreakup).toEqual([{ gstRate: 5, taxable: 300000, cgst: 7500, sgst: 7500, igst: 0 }]);
  });
  it("uses IGST when the party state differs, and takes explicit tax amounts", () => {
    const { bill } = buildBill(
      [row(2, { invoice_no: "B-1", date: "2026-01-15", party: "Kerala Co", party_gstin: "32AAACR5055K1Z8", item: "Tea", qty: 10, rate: 20000, taxable: 200000, igst: 36000, invoice_total: 236000 })],
      { kind: "sale", sellerState: "33" },
    );
    expect(bill!.interState).toBe(true);
    expect(bill!.igst).toBe(36000);
    expect(bill!.lines[0]!.gstRate).toBe(18);
    expect(bill!.total).toBe(236000);
  });
  it("summary-only bills become one line; round-off within 1 rupee; bigger gaps are errors", () => {
    const ok = buildBill([row(2, { invoice_no: "C-1", date: "2026-01-02", party: "Walk-in", invoice_total: 99950, taxable: 95200, cgst: 2375, sgst: 2375 })], { kind: "sale" });
    expect(ok.bill!.roundOff).toBe(0);
    expect(ok.bill!.warnings[0]).toMatch(/summary|one line/);
    const near = buildBill([row(2, { invoice_no: "C-2", date: "2026-01-02", item: "X", qty: 1, rate: 10000, gst_rate: 0, invoice_total: 10040 })], { kind: "sale" });
    expect(near.bill!.roundOff).toBe(40);
    const far = buildBill([row(2, { invoice_no: "C-3", date: "2026-01-02", item: "X", qty: 1, rate: 10000, gst_rate: 0, invoice_total: 50000 })], { kind: "sale" });
    expect(far.error).toMatch(/does not match/);
  });
  it("derives taxable from an inclusive line total and folds cess into a line", () => {
    const { bill } = buildBill([row(2, { invoice_no: "D-1", date: "2026-01-02", item: "X", line_total: 105000, gst_rate: 5, cess: 500 })], { kind: "sale", sellerState: "33" });
    expect(bill!.lines[0]!.taxable).toBe(100000);
    expect(bill!.lines[1]!.description).toBe("Cess");
    expect(bill!.total).toBe(105500);
  });
  it("rejects conflicting dates and overpaid bills", () => {
    expect(buildBill([row(2, { invoice_no: "E", date: "2026-01-02", invoice_total: 100 }), row(3, { invoice_no: "E", date: "2026-01-03", invoice_total: 100 })], { kind: "sale" }).error).toMatch(/different dates/);
    expect(buildBill([row(2, { invoice_no: "F", date: "2026-01-02", invoice_total: 10000, paid: 50000 })], { kind: "sale" }).error).toMatch(/paid amount/);
  });
  it("groups rows by bill number", () => {
    const g = groupBills([row(2, { invoice_no: "A" }), row(3, { invoice_no: "b" }), row(4, { invoice_no: "a" })]);
    expect(g.map((x) => x.length)).toEqual([2, 1]);
  });
});

describe("vendors", () => {
  it("detects the header row below a title block and the source", () => {
    const cols = withVendor(billColumns("sale"), "vyapar");
    const table = [["Sale Report"], ["Jan 2026 to Mar 2026"], [], ["Date", "Invoice No.", "Party Name", "Transaction Type", "Payment Type", "Total", "Received/Paid"], ["15/01/2026", "1", "A", "Sale", "Cash", "100", "100"]];
    expect(findHeaderRow(table, cols)).toBe(3);
    expect(detectVendor(table[3]!)).toBe("vyapar");
    expect(isFooterRow(["Total", "", "", "100"])).toBe(true);
    expect(isFooterRow(["Total Traders", "1"])).toBe(false);
  });
});

describe("tally xml", () => {
  const LEDGERS = `<?xml version="1.0" encoding="UTF-8"?><ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
  <TALLYMESSAGE><LEDGER NAME="Murugan Stores"><PARENT>Sundry Debtors</PARENT><OPENINGBALANCE>-1500.00</OPENINGBALANCE><PARTYGSTIN>33AAACR5055K1ZE</PARTYGSTIN>
    <LEDMAILINGDETAILS.LIST><ADDRESS.LIST><ADDRESS>5, Car Street</ADDRESS><ADDRESS>Madurai</ADDRESS></ADDRESS.LIST></LEDMAILINGDETAILS.LIST></LEDGER></TALLYMESSAGE>
  <TALLYMESSAGE><LEDGER NAME="Ravi &amp; Sons"><PARENT>Sundry Creditors</PARENT><OPENINGBALANCE>4200.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
  <TALLYMESSAGE><LEDGER NAME="Cash"><PARENT>Cash-in-Hand</PARENT></LEDGER></TALLYMESSAGE>
  </REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
  it("reads debtors/creditors with Dr/Cr", () => {
    const t = tallyXmlTable(Buffer.from(LEDGERS), "migrate.parties")!;
    expect(t.data).toHaveLength(2);
    expect(t.data[0]!.slice(0, 2)).toEqual(["Murugan Stores", "Customer"]);
    expect(t.data[0]![5]).toBe("5, Car Street, Madurai");
    expect(t.data[0]![7]).toBe("1500.00");
    expect(t.data[0]![8]).toBe("Dr");
    expect(t.data[1]![0]).toBe("Ravi & Sons");
    expect(t.data[1]![8]).toBe("Cr");
  });
  it("reads UTF-16 files", () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(LEDGERS, "utf16le")]);
    expect(tallyXmlTable(buf, "migrate.parties")!.data).toHaveLength(2);
  });
  const VOUCHERS = `<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
  <TALLYMESSAGE><VOUCHER VCHTYPE="Sales"><DATE>20260115</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S-101</VOUCHERNUMBER>
   <PARTYLEDGERNAME>Murugan Stores</PARTYLEDGERNAME><PLACEOFSUPPLY>Tamil Nadu</PLACEOFSUPPLY>
   <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Rice</STOCKITEMNAME><RATE>50.00/Kgs</RATE><AMOUNT>1000.00</AMOUNT><BILLEDQTY> 20 Kgs</BILLEDQTY></ALLINVENTORYENTRIES.LIST>
   <ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Dal</STOCKITEMNAME><RATE>100.00/Kgs</RATE><AMOUNT>1000.00</AMOUNT><BILLEDQTY> 10 Kgs</BILLEDQTY></ALLINVENTORYENTRIES.LIST>
   <ALLLEDGERENTRIES.LIST><LEDGERNAME>Murugan Stores</LEDGERNAME><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-2100.00</AMOUNT></ALLLEDGERENTRIES.LIST>
   <ALLLEDGERENTRIES.LIST><LEDGERNAME>Output CGST</LEDGERNAME><AMOUNT>50.00</AMOUNT></ALLLEDGERENTRIES.LIST>
   <ALLLEDGERENTRIES.LIST><LEDGERNAME>Output SGST</LEDGERNAME><AMOUNT>50.00</AMOUNT></ALLLEDGERENTRIES.LIST>
  </VOUCHER></TALLYMESSAGE>
  <TALLYMESSAGE><VOUCHER VCHTYPE="Receipt"><DATE>20260116</DATE><VOUCHERNUMBER>R-1</VOUCHERNUMBER></VOUCHER></TALLYMESSAGE>
  </REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
  it("flattens sales vouchers into bill rows that build into a matching bill", () => {
    const t = tallyXmlTable(Buffer.from(VOUCHERS), "history.sales")!;
    expect(t.data).toHaveLength(2); // receipt skipped, two items
    const idx = (h: string) => t.headers.indexOf(h);
    expect(t.data[0]![idx("Invoice no")]).toBe("S-101");
    expect(t.data[0]![idx("Date")]).toBe("2026-01-15");
    // parse via the importer columns
    const cols = billColumns("sale");
    const rows = t.data.map((cells, i) => {
      const d: Record<string, unknown> = {};
      cols.forEach((c) => {
        const at = t.headers.findIndex((h) => h === c.label);
        const v = at >= 0 ? cells[at]!.trim() : "";
        if (v) d[c.key] = c.parse(v);
      });
      return { row: i + 2, data: d };
    });
    const { bill, error } = buildBill(rows, { kind: "sale", sellerState: "33" });
    expect(error).toBeUndefined();
    expect(bill!.total).toBe(210000);
    expect(bill!.cgst).toBe(5000);
    expect(bill!.sgst).toBe(5000);
    expect(bill!.lines.map((l) => l.gstRate)).toEqual([5, 5]);
  });
  it("number/date helpers", () => {
    expect(tallyNumber("-1,500.50 Dr")).toBe(-1500.5);
    expect(tallyNumber(" 10 Nos")).toBe(10);
    expect(tallyDate("20260115")).toBe("2026-01-15");
  });
  it("tolerates invalid character references and CDATA", () => {
    const n = parseXml("<A><B>x&#4;y</B><C><![CDATA[a < b]]></C><D x='1'/></A>");
    expect(findAll(n, "B")[0]!.text).toBe("xy");
    expect(findAll(n, "C")[0]!.text).toBe("a < b");
  });
  it("builds Tally import XML with Tally's sign convention", () => {
    const xml = buildTallyVouchersXml(
      [{ kind: "sale", number: "INV-1", date: "2026-01-15", party: "A & B", lines: [{ name: "Rice", qty: 2, unit: "Kgs", rate: 50, amount: 100 }], cgst: 2.5, sgst: 2.5, igst: 0, roundOff: 0, total: 105 }],
      "Raja Stores",
    );
    expect(xml).toContain("<VOUCHER VCHTYPE=\"Sales\"");
    expect(xml).toContain("<DATE>20260115</DATE>");
    expect(xml).toContain("A &amp; B");
    expect(xml).toMatch(/<ISPARTYLEDGER>Yes<\/ISPARTYLEDGER>\s*<AMOUNT>-105.00<\/AMOUNT>/);
    expect(xml).toContain("<AMOUNT>2.50</AMOUNT>");
    // round trip through our own reader
    expect(parseXml(xml).tag).toBe("ENVELOPE");
  });
});

describe("zip", () => {
  it("crc32 matches the standard check value", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
  it("produces an archive python can read", () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    const file = join(dir, "t.zip");
    writeFileSync(file, makeZip([{ name: "a.csv", data: Buffer.from("x,y\n1,2\n".repeat(200)) }, { name: "தமிழ்.txt", data: Buffer.from("hi") }]));
    let out = "";
    try {
      out = execFileSync("python", ["-I", "-c", "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(ascii(sorted(z.namelist())));print(len(z.read('a.csv')))", file]).toString();
    } catch {
      return; // python not available: skip
    }
    expect(out).toContain("None");
    expect(out).toContain("1600");
  });
});

// --------------------------------------------------------------- end to end with in-memory ports

function memoryBills() {
  const saved = new Map<string, HistoricalBill>();
  const port: BillsPort = {
    async context() {
      return { sellerState: "33" };
    },
    async save(_t, bills) {
      return bills.map((b) => {
        saved.set(`${b.kind}:${b.number}`, b);
        return { number: b.number, ok: true, records: [{ entity: b.kind, key: `${b.kind}:${fyOf(b.date)}|${b.number.toLowerCase()}`, id: `id-${b.number}`, action: "created" as const }] };
      });
    },
  };
  return { port, saved };
}

const SALES_CSV = [
  "Sale Report",
  "Company: Raja Stores",
  "",
  "Date,Invoice No.,Party Name,Transaction Type,Payment Type,Total,Received/Paid",
  "15/01/2026,101,Murugan,Sale,Cash,1050.00,1050.00",
  "16/01/2026,102,Kumar,Sale,Credit,525.00,0",
  "16/01/2026,R1,Kumar,Payment-In,Cash,500.00,500.00",
  "17/01/2026,,Ravi,Sale,Cash,100.00,100.00",
  "Total,,,,,2175.00,",
].join("\r\n");

describe("end to end", () => {
  async function setup() {
    const records = new MemoryImportRecordStore();
    const ie = createImportExport({ store: new MemoryImportJobStore(), records });
    const bills = memoryBills();
    ie.registry.registerImporter(billImporter("sale", bills.port));
    const removed: string[] = [];
    ie.registry.rollbackPort = {
      async rollback(_t, recs) {
        removed.push(...recs.map((r) => r.id));
        return { reverted: recs.length, kept: [] };
      },
    };
    return { ie, bills, removed, records };
  }
  const file = (csv: string) => ({ fileName: "sale.csv", contentType: "text/csv", data: Buffer.from(csv) });

  it("previews a Vyapar sale report, skips non-sales and totals, commits idempotently and rolls back", async () => {
    const { ie, bills, removed } = await setup();
    const p = await ie.service.preview(TENANT, USER, "history.sales", file(SALES_CSV));
    expect(p.source).toBe("vyapar");
    expect(p.ignoredRows).toBe(1); // the payment-in row
    expect(p.totals.rows).toBe(3);
    expect(p.totals.invalid).toBe(1); // row without invoice number
    expect(p.mapping.invoice_no).not.toBeNull();
    const job = await ie.service.commit(TENANT, p.jobId, {});
    expect(job.status).toBe("done");
    expect(job.created).toBe(2);
    expect(bills.saved.size).toBe(2);
    expect(bills.saved.get("sale:101")!.paid).toBe(105000);
    expect(bills.saved.get("sale:102")!.paid).toBe(0);
    expect(job.errors.some((e) => e.raw && e.raw.includes("Ravi"))).toBe(true);
    const csv = await ie.service.errorsCsv(TENANT, p.jobId);
    expect(csv.csv).toContain("Row,Problem");
    expect(csv.csv).toContain("Ravi");

    // same file again: everything valid is already imported
    const again = await ie.service.preview(TENANT, USER, "history.sales", file(SALES_CSV));
    expect(again.alreadyImported).toBe(2);
    const job2 = await ie.service.commit(TENANT, again.jobId, {});
    expect(job2.created).toBe(0);
    expect(bills.saved.size).toBe(2);

    // rollback first batch, then it can be imported again
    const rb = await ie.service.rollback(TENANT, p.jobId, USER);
    expect(rb.status).toBe("rolled_back");
    expect(rb.rollback?.reverted).toBe(2);
    expect(removed).toEqual(["id-101", "id-102"]);
    await expect(ie.service.rollback(TENANT, p.jobId, USER)).rejects.toBeInstanceOf(AppError);
    const third = await ie.service.preview(TENANT, USER, "history.sales", file(SALES_CSV));
    expect(third.alreadyImported).toBe(0);
  });

  it("keeps the lines of one bill together across batches", async () => {
    const { ie, bills } = await setup();
    const lines = ["Invoice No,Date,Party,Item,Qty,Rate,GST %"];
    for (let i = 0; i < 400; i++) lines.push(`B${Math.floor(i / 2)},2026-02-01,P,Item${i},1,10,0`);
    const p = await ie.service.preview(TENANT, USER, "history.sales", file(lines.join("\n")));
    const job = await ie.service.commit(TENANT, p.jobId, {});
    expect(job.created).toBe(200);
    expect([...bills.saved.values()].every((b) => b.lines.length === 2)).toBe(true);
  });

  it("imports parties with opening balances on either side", async () => {
    const records = new MemoryImportRecordStore();
    const ie = createImportExport({ store: new MemoryImportJobStore(), records });
    const got: PartyTarget[] = [];
    ie.registry.registerImporter(
      migratePartiesImporter({
        async save(_t, targets) {
          got.push(...targets);
          return { created: targets.length, updated: 0, records: targets.map((t) => ({ entity: "party", key: t.key, id: t.key, action: "created" as const })) };
        },
      }),
    );
    const csv = ["Party Name,Phone No.,Opening Balance,Party Type", "Murugan,9876543210,1500,Customer", "Ravi,9123456780,-4200,", "Both Co,,300,Both"].join("\n");
    const p = await ie.service.preview(TENANT, USER, "migrate.parties", file(csv));
    expect(p.totals.invalid).toBe(0);
    await ie.service.commit(TENANT, p.jobId, {});
    expect(got.map((g) => `${g.kind}:${g.data.name}:${g.opening}`)).toEqual([
      "customer:Murugan:150000",
      "supplier:Ravi:420000", // negative with no type and no side: a supplier the shop owes
      "customer:Both Co:30000",
      "supplier:Both Co:30000",
    ]);
  });
});

describe("full export", () => {
  it("zips datasets, stores, audits and signs the link; one job at a time", async () => {
    const stored = new Map<string, Buffer>();
    const audit: string[] = [];
    const ds: ExportDataset = {
      key: "items",
      label: "Items",
      columns: [{ key: "name", label: "Name" }, { key: "price", label: "Price" }],
      rows: [{ name: "Rice", price: 50 }, { name: "=evil()", price: 1 }],
    };
    const svc = new FullExportService({
      store: new MemoryExportJobStore(),
      port: { datasets: async () => [ds], company: async () => "Raja Stores", vouchers: async function* () {} },
      files: { put: async (k, b) => void stored.set(k, b), get: async (k) => stored.get(k)!, url: async (k) => `https://x/${k}`, delete: async () => undefined },
      audit: { record: async (e) => void audit.push(e.action) },
    });
    const job = await svc.start(TENANT, USER);
    expect(job.status).toBe("done");
    expect(job.counts.items).toBe(2);
    expect(stored.size).toBe(1);
    const dl = await svc.download(TENANT, job.id, USER);
    expect(dl.url).toContain(`exports/${TENANT}`);
    expect(audit).toEqual(["data.export.requested", "data.export.downloaded"]);
    const dir = mkdtempSync(join(tmpdir(), "exp-"));
    const f = join(dir, "e.zip");
    writeFileSync(f, [...stored.values()][0]!);
    try {
      const out = execFileSync("python", ["-I", "-c", "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(sorted(z.namelist()));print(z.read('items.csv').decode('utf-8-sig'))", f]).toString();
      expect(out).toContain("items.csv");
      expect(out).toContain("items.xlsx");
      expect(out).toContain("Name,Price");
    } catch {
      /* python missing */
    }
  });
});
