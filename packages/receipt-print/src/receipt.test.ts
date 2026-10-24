import { describe, expect, it } from "vitest";
import { receiptFromInvoice, hasCashPayment } from "./invoice";
import { formatMoney, formatQty } from "./money";
import { drawerKickBytes, formatReceipt, rowsNeedRaster, rowsToBytes, type ReceiptData, type Row } from "./receipt";
import { center, needsRaster, pairLines, wrapText } from "./text";

const sale: ReceiptData = {
  shop: { name: "Sri Stores", address: "12 Main Rd, Madurai", gstin: "33AAAAA0000A1Z5", phone: "98400 00000" },
  number: "INV/26-27/0001",
  date: "2026-10-24 14:05",
  customer: "Walk-in",
  lines: [
    { description: "Basmati Rice 5kg", qty: 1, unitPrice: 54000, total: 54000 },
    { description: "Toor Dal", qty: 0.75, unitPrice: 16000, total: 12000 },
  ],
  totals: { taxable: 62857, cgst: 1571, sgst: 1571, igst: 0, roundOff: 1, total: 66000 },
  payments: [{ label: "Cash", amount: 70000 }],
  change: 4000,
};

const textOf = (bytes: Uint8Array) =>
  new TextDecoder().decode(bytes.filter((b) => b === 0x0a || (b >= 0x20 && b < 0x7f)));

describe("money and text helpers", () => {
  it("formats paise with Indian grouping", () => {
    expect(formatMoney(0)).toBe("0.00");
    expect(formatMoney(5)).toBe("0.05");
    expect(formatMoney(123456)).toBe("1,234.56");
    expect(formatMoney(12345678)).toBe("1,23,456.78");
    expect(formatMoney(-250)).toBe("-2.50");
    expect(formatQty(0.7500)).toBe("0.75");
    expect(formatQty(2)).toBe("2");
  });
  it("wraps words and hard-breaks long ones", () => {
    expect(wrapText("aaa bbb ccc", 7)).toEqual(["aaa bbb", "ccc"]);
    expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapText("", 10)).toEqual([""]);
  });
  it("pairs left and right to the exact width", () => {
    expect(pairLines("Total", "10.00", 16)).toEqual(["Total      10.00"]);
    expect(pairLines("A very long item name here", "99.00", 16)).toEqual(["A very", "long item", "name here  99.00"]); // left wraps, right sits on the last line
    for (const l of pairLines("A very long item name here", "99.00", 16)) expect(l.length).toBeLessThanOrEqual(16);
  });
  it("centres text", () => {
    expect(center("ab", 6)).toBe("  ab");
  });
  it("detects text that needs the image path", () => {
    expect(needsRaster("Rice 5kg ₹100")).toBe(false); // rupee maps to Rs.
    expect(needsRaster("அரிசி")).toBe(true); // Tamil
    expect(needsRaster("Café")).toBe(true);
  });
});

describe("formatReceipt", () => {
  it("lays out shop, lines, GST totals, payments and thanks", () => {
    const rows = formatReceipt(sale);
    const lines = rows.flatMap((r) => (r.t === "text" ? [r.text] : r.t === "pair" ? [`${r.left}|${r.right}`] : []));
    expect(lines).toContain("Sri Stores");
    expect(lines).toContain("GSTIN 33AAAAA0000A1Z5");
    expect(lines).toContain("TAX INVOICE");
    expect(lines).toContain("INV/26-27/0001|2026-10-24 14:05");
    expect(lines).toContain("0.75 x 160.00|120.00");
    expect(lines).toContain("CGST|15.71");
    expect(lines).not.toContain("IGST|0.00");
    expect(lines).toContain("Round off|0.01");
    expect(lines).toContain("TOTAL|660.00");
    expect(lines).toContain("Cash|700.00");
    expect(lines).toContain("Change|40.00");
    expect(lines.at(-1)).toBe("Thank you! Visit again.");
  });
  it("adds UPI QR only with a balance and the e-invoice QR when present", () => {
    const none = formatReceipt({ ...sale, upiLink: "upi://pay?pa=a@b", balance: 0 });
    expect(none.some((r) => r.t === "qr")).toBe(false);
    const rows = formatReceipt({ ...sale, upiLink: "upi://pay?pa=a@b", balance: 5000, einvoiceQr: "eyJ.signed" });
    expect(rows.filter((r) => r.t === "qr")).toHaveLength(2);
    expect(formatReceipt({ ...sale, einvoiceQr: "x" }, { showQr: false }).some((r) => r.t === "qr")).toBe(false);
  });
  it("uses Tamil labels", () => {
    const rows = formatReceipt({ ...sale, locale: "ta" });
    expect(rowsNeedRaster(rows)).toBe(true);
    expect(rows.some((r) => r.t === "text" && r.text === "வரி விலைப்பட்டியல்")).toBe(true);
  });
  it("header and footer lines are included", () => {
    const rows = formatReceipt({ ...sale, headerLines: ["Open 9-9"], footerLines: ["No exchange"] });
    expect(rows.some((r) => r.t === "text" && r.text === "Open 9-9")).toBe(true);
    expect(rows.some((r) => r.t === "text" && r.text === "No exchange")).toBe(true);
  });
});

describe("receipt bytes (golden)", () => {
  it("a tiny receipt on 58 mm matches the golden stream", () => {
    const rows: Row[] = [
      { t: "text", text: "SHOP", align: "center", bold: true },
      { t: "rule" },
      { t: "pair", left: "Total", right: "10.00", bold: true },
      { t: "feed", n: 1 },
    ];
    const { bytes, raster, lossy } = rowsToBytes(rows, { charsPerLine: 16, widthDots: 384, cut: "partial", drawer: "after" });
    const hex = Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join(" ");
    const s = (t: string) => Array.from(t, (c) => c.charCodeAt(0).toString(16)).join(" ");
    expect(hex).toBe(
      [
        "1b 40", // init
        "1b 61 00 1b 45 01 1d 21 00", s("      SHOP"), "0a", // bold centred
        "1b 45 00 1d 21 00", // reset style
        "1b 61 00 1b 45 00 1d 21 00", s("-".repeat(16)), "0a",
        "1b 45 00 1d 21 00",
        "1b 61 00 1b 45 01 1d 21 00", s("Total      10.00"), "0a",
        "1b 45 00 1d 21 00",
        "1b 64 01", // feed row
        "1b 64 03", // feed before cut
        "1d 56 42 03", // partial cut
        "1b 70 00 19 fa", // drawer kick after
      ].join(" "),
    );
    expect(raster).toBe(false);
    expect(lossy).toBe(false);
  });
  it("drawer kick can go before the receipt", () => {
    const { bytes } = rowsToBytes([{ t: "text", text: "x" }], { charsPerLine: 32, widthDots: 384, drawer: "before", cut: "none", feedBeforeCut: 0 });
    expect(Array.from(bytes.subarray(0, 7))).toEqual([0x1b, 0x40, 0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });
  it("cut none omits the cut command", () => {
    const { bytes } = rowsToBytes([{ t: "text", text: "x" }], { charsPerLine: 32, widthDots: 384, cut: "none" });
    expect(Array.from(bytes).join(",")).not.toContain("29,86");
  });
  it("Tamil rows go through the rasterizer as one image per run; QR stays native", () => {
    const calls: Row[][] = [];
    const bitmap = { width: 8, height: 1, data: Uint8Array.from([0xaa]) };
    const rows: Row[] = [
      { t: "text", text: "வரி விலைப்பட்டியல்", align: "center" },
      { t: "pair", left: "Total", right: "1.00" },
      { t: "qr", data: "x" },
      { t: "text", text: "நன்றி" },
    ];
    const { bytes, raster, lossy } = rowsToBytes(rows, { charsPerLine: 32, widthDots: 384, cut: "none", rasterize: (r) => (calls.push(r), bitmap) });
    expect(raster).toBe(true);
    expect(lossy).toBe(false);
    expect(calls.map((c) => c.length)).toEqual([2, 1]);
    const arr = Array.from(bytes);
    expect(arr.join(",")).toContain("29,118,48,0,1,0,1,0,170"); // GS v 0 band with our pixel
    expect(arr.join(",")).toContain("29,40,107"); // QR kept native
  });
  it("without a rasterizer non-ASCII prints as ? and is flagged lossy", () => {
    const { bytes, lossy, raster } = rowsToBytes([{ t: "text", text: "அ" }], { charsPerLine: 32, widthDots: 384, cut: "none" });
    expect(lossy).toBe(true);
    expect(raster).toBe(false);
    expect(textOf(bytes)).toContain("?");
  });
  it("drawer-only bytes", () => {
    expect(Array.from(drawerKickBytes())).toEqual([0x1b, 0x40, 0x1b, 0x70, 0, 0x19, 0xfa]);
  });
});

describe("receiptFromInvoice", () => {
  const inv = {
    number: "INV/1",
    date: "2026-10-24",
    customer: { name: "Meena" },
    lines: [{ description: "Rice", qty: 2, total: 20000 }],
    totals: { taxable: 19048, cgst: 476, sgst: 476, igst: 0, roundOff: 0, total: 20000 },
    payments: [{ method: "cash", amount: 5000 }, { method: "upi", amount: 5000 }],
    balance: 10000,
  };
  it("maps the bill like the PDF: unit price from the line total, payment labels, change", () => {
    const d = receiptFromInvoice(inv, {
      shopName: "Shop",
      seller: { legalName: "Sri Stores Pvt", address: "1 Rd", city: "Madurai", gstin: "G", upiId: "sri@upi" },
      time: "14:05",
      change: 0,
      upiLink: ({ vpa, amountPaise }) => `upi://pay?pa=${vpa}&am=${amountPaise}`,
    });
    expect(d.shop.name).toBe("Sri Stores Pvt");
    expect(d.shop.address).toBe("1 Rd, Madurai");
    expect(d.date).toBe("2026-10-24 14:05");
    expect(d.lines[0]).toMatchObject({ unitPrice: 10000, total: 20000 });
    expect(d.payments.map((p) => p.label)).toEqual(["Cash", "UPI"]);
    expect(d.upiLink).toBe("upi://pay?pa=sri@upi&am=10000");
    expect(hasCashPayment(inv)).toBe(true);
    expect(hasCashPayment({ payments: [{ method: "upi", amount: 1 }] })).toBe(false);
  });
  it("Tamil locale gives Tamil payment labels", () => {
    expect(receiptFromInvoice(inv, { shopName: "S", locale: "ta" }).payments[0]!.label).toBe("ரொக்கம்");
  });
  it("a provisional slip is titled Provisional receipt (English and Tamil), a normal bill keeps the default title", () => {
    expect(receiptFromInvoice(inv, { shopName: "S", provisional: true }).title).toBe("PROVISIONAL RECEIPT");
    expect(receiptFromInvoice(inv, { shopName: "S", provisional: true, locale: "ta" }).title).toBe("தற்காலிக ரசீது");
    expect(receiptFromInvoice(inv, { shopName: "S" }).title).toBeUndefined();
  });
});
