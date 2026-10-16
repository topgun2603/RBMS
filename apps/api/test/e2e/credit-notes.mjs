// Credit notes (GST returns / value corrections) and POS till sessions, end to end against the running API.
//   node test/e2e/credit-notes.mjs        (test:e2e:all seeds the shops and runs it with the other scripts)
// Shop: e2e-bill (BL, pro), owner e2e-owner@example.com with the dev test OTP. Every run uses fresh "E2E <run>" names
// and new +91 99990 0xxxxx test phones, so it is safe to re-run.
import { BILL, RUN, call, eq, expect, fails, ok, results, rs, signIn, OWNER, step, testPhone, today, waitForApi } from "./b3/lib.mjs";

const KA_GSTIN = "29AAFCB9012M1ZD"; // registered buyer in Karnataka (inter-state → IGST)
const sum = (xs, k) => xs.reduce((s, x) => s + x[k], 0);
const round = (n) => Math.sign(n) * Math.round(Math.abs(n));
/** Line share like packages/gst credit-note.ts: remaining × qty / remaining qty (half away from zero). */
const share = (v, q, Q) => round((v * Math.round(q * 1000)) / Math.round(Q * 1000));

await waitForApi();
await signIn("owner", OWNER);

let silk, cotton, stockOn = false;
await step("items + stock (silk +10)", async () => {
  const items = ok(await call("GET", "/v1/invoices/items?limit=200"), "items").items;
  silk = items.find((i) => i.name === "Silk saree");
  cotton = items.find((i) => i.name === "Cotton saree");
  expect(silk && cotton, "seeded items missing (run seed:e2e)");
  const adj = await call("POST", `/v1/inventory/stock/${silk.id}/adjust`, { mode: "add", qty: 10, note: `E2E CN ${RUN}` });
  stockOn = adj.status < 300;
  return stockOn ? `silk qty ${adj.json.qty}` : `inventory off (${adj.status})`;
});
const stockOf = async (id) => (stockOn ? ok(await call("GET", `/v1/inventory/stock/${id}`), "stock").qty : null);

// ------------------------------------------------------------------ bill A: intra-state, paid in cash
const phoneA = testPhone(7);
let custA, billA, silkStock0;
await step("bill A: 3 silk + 2 cotton (TN, CGST+SGST), paid in cash", async () => {
  custA = ok(await call("POST", "/v1/invoices/customers", { name: `E2E CN Meena ${RUN}`, phone: phoneA, stateCode: "33" }), "customer A");
  billA = ok(
    await call("POST", "/v1/invoices", {
      customerId: custA.id,
      date: today(),
      issue: true,
      lines: [
        { itemId: silk.id, description: silk.name, hsn: silk.hsn, qty: 3, unit: "pcs", rate: silk.rate, gstRate: silk.gstRate, discount: 3_333 },
        { itemId: cotton.id, description: cotton.name, hsn: cotton.hsn, qty: 2, unit: "pcs", rate: cotton.rate, gstRate: cotton.gstRate },
      ],
    }),
    "bill A",
  );
  billA = ok(await call("POST", `/v1/invoices/${billA.id}/payments`, { amount: billA.total, method: "cash", date: today() }), "pay A");
  eq(billA.status, "paid", "bill A status");
  eq(billA.credited, 0, "credited before");
  silkStock0 = await stockOf(silk.id);
  return `${billA.number} ${rs(billA.total)}; silk stock ${silkStock0}`;
});

await step("returnable: every line fully returnable", async () => {
  const r = ok(await call("GET", `/v1/invoices/${billA.id}/returnable`), "returnable");
  eq(r.blocked, null, "blocked");
  eq(r.lines[0].remainingQty, 3, "silk remaining");
  eq(r.lines[1].remainingQty, 2, "cotton remaining");
  eq(r.creditable, billA.total, "creditable");
  return `${r.lines.length} lines, creditable ${rs(r.creditable)}`;
});

let cn1;
await step("partial return: 1 silk, cash refund → GST share of the line, own CN number, stock +1", async () => {
  const silkLine = billA.lines[0];
  const res = ok(
    await call("POST", `/v1/invoices/${billA.id}/credit-notes`, { reason: "return", refundMode: "cash", lines: [{ line: 0, qty: 1 }], note: `E2E ${RUN}` }),
    "credit note 1",
  );
  cn1 = res.creditNote;
  expect(/^CN[A-Z0-9-]*\/\d\d-\d\d\/\d{4}$/.test(cn1.number), `number ${cn1.number}`);
  const l = cn1.lines[0];
  eq(l.taxable, share(silkLine.taxable, 1, 3), "taxable share");
  eq(l.cgst, share(silkLine.cgst, 1, 3), "cgst share");
  eq(l.sgst, share(silkLine.sgst, 1, 3), "sgst share");
  eq(l.igst, 0, "no IGST intra-state");
  eq(l.restock, true, "restock default for returns");
  const exact = l.taxable + l.cgst + l.sgst;
  eq(cn1.total, round(exact / 100) * 100, "total rounded to the rupee");
  eq(cn1.refundAmount, cn1.total, "paid bill: whole note refunded");
  eq(cn1.invoiceNumber, billA.number, "against invoice");
  const inv = res.invoice;
  eq(inv.credited, cn1.total, "invoice credited");
  eq(inv.paid, billA.total - cn1.total, "paid net of refund");
  eq(inv.balance, 0, "balance");
  expect(inv.payments.some((p) => p.source === "refund" && p.amount === -cn1.total && p.method === "cash"), "refund payment row");
  if (stockOn) eq(await stockOf(silk.id), silkStock0 + 1, "silk restocked");
  return `${cn1.number} ${rs(cn1.total)} (taxable ${rs(l.taxable)}, CGST ${rs(l.cgst)} + SGST ${rs(l.sgst)}), refund cash`;
});

await step("over-return refused (only 2 silk left)", async () => {
  fails(await call("POST", `/v1/invoices/${billA.id}/credit-notes`, { reason: "return", refundMode: "cash", lines: [{ line: 0, qty: 3 }] }), 400, "credit_note_qty", "over-return");
  fails(await call("POST", `/v1/invoices/${billA.id}/credit-notes`, { reason: "return", refundMode: "cash", lines: [{ line: 7, qty: 1 }] }), 400, "credit_note_line", "unknown line");
  fails(await call("POST", `/v1/invoices/${billA.id}/credit-notes`, { reason: "return", refundMode: "none", lines: [{ line: 1, qty: 1 }] }), 400, "credit_note_refund", "no refund on a paid bill");
  return "400s";
});

let cn2;
await step("price correction on cotton (₹100 before GST) kept in the credit book → ledger credit", async () => {
  const res = ok(
    await call("POST", `/v1/invoices/${billA.id}/credit-notes`, { reason: "price_correction", refundMode: "credit_book", lines: [{ line: 1, taxable: 10_000 }] }),
    "credit note 2",
  );
  cn2 = res.creditNote;
  const l = cn2.lines[0];
  eq(l.kind, "value", "value line");
  eq(l.qty, 0, "no quantity");
  eq(l.restock, false, "no restock");
  const half = round((10_000 * cotton.gstRate * 100) / 20_000);
  eq(l.cgst, half, "cgst");
  eq(l.sgst, half, "sgst");
  eq(cn2.refundAmount, 0, "no money paid out");
  const c = ok(await call("GET", `/v1/invoices/customers/${custA.id}`), "customer");
  eq(c.outstanding, -cn2.total, "customer in credit by the note");
  const ledger = ok(await call("GET", `/v1/invoices/customers/${custA.id}/ledger`), "ledger");
  const types = ledger.entries.map((e) => e.type);
  expect(types.includes("credit_note") && types.includes("refund"), `ledger types ${types}`);
  eq(ledger.closingBalance, -cn2.total, "ledger closing");
  return `${cn2.number} ${rs(cn2.total)}; ledger ${types.join(",")}; balance ${rs(ledger.closingBalance)}`;
});

let cn3;
await step("return the rest (2 silk + 2 cotton), UPI refund → bill fully credited to the paisa", async () => {
  const res = ok(
    await call("POST", `/v1/invoices/${billA.id}/credit-notes`, {
      reason: "return",
      refundMode: "upi",
      refundReference: `UPI-${RUN}`,
      lines: [
        { line: 0, qty: 2 },
        { line: 1, qty: 2, restock: false },
      ],
    }),
    "credit note 3",
  );
  cn3 = res.creditNote;
  const inv = res.invoice;
  eq(inv.credited, inv.total, "fully credited");
  eq(cn1.total + cn2.total + cn3.total, billA.total, "notes add up to the bill");
  for (const [i, line] of billA.lines.entries()) {
    const all = [cn1, cn2, cn3].flatMap((n) => n.lines.filter((x) => x.line === i));
    eq(sum(all, "taxable"), line.taxable, `line ${i} taxable`);
    eq(sum(all, "cgst"), line.cgst, `line ${i} cgst`);
  }
  eq(inv.balance, 0, "balance");
  const r = ok(await call("GET", `/v1/invoices/${billA.id}/returnable`), "returnable");
  expect(r.blocked, "should be blocked now");
  if (stockOn) eq(await stockOf(silk.id), silkStock0 + 3, "silk back in stock (cotton kept out)");
  return `${cn3.number} ${rs(cn3.total)}; refund ${rs(cn3.refundAmount)} UPI; returnable blocked: ${r.blocked}`;
});

await step("a bill with credit notes can't be cancelled; refunded notes can't be cancelled", async () => {
  fails(await call("POST", `/v1/invoices/${billA.id}/cancel`, { reason: "x" }), 409, "invoice_has_credit_notes", "cancel bill");
  fails(await call("POST", `/v1/invoices/credit-notes/${cn1.id}/cancel`, {}), 409, "credit_note_locked", "cancel refunded note");
  fails(await call("POST", `/v1/invoices/${billA.id}/credit-notes`, { reason: "return", refundMode: "cash", lines: [{ line: 0, qty: 1 }] }), 409, "credit_note_blocked", "nothing left");
  return "409s";
});

// ------------------------------------------------------------------ bill B: inter-state registered buyer, unpaid
let custB, billB, cnB1, cnB2;
await step("bill B to a Karnataka GSTIN (IGST), unpaid; note without refund only reduces the balance", async () => {
  custB = ok(await call("POST", "/v1/invoices/customers", { name: `E2E CN Bengaluru ${RUN}`, gstin: KA_GSTIN, address: "12, MG Road, Bengaluru 560001", stateCode: "29" }), "customer B");
  billB = ok(
    await call("POST", "/v1/invoices", {
      customerId: custB.id,
      date: today(),
      issue: true,
      lines: [{ itemId: silk.id, description: silk.name, hsn: silk.hsn, qty: 4, unit: "pcs", rate: silk.rate, gstRate: silk.gstRate }],
    }),
    "bill B",
  );
  eq(billB.interState, true, "inter-state");
  const res = ok(await call("POST", `/v1/invoices/${billB.id}/credit-notes`, { reason: "return", refundMode: "none", lines: [{ line: 0, qty: 1 }] }), "note B1");
  cnB1 = res.creditNote;
  const l = cnB1.lines[0];
  eq(l.cgst + l.sgst, 0, "no CGST/SGST");
  eq(l.igst, share(billB.lines[0].igst, 1, 4), "IGST share");
  eq(res.invoice.balance, billB.total - cnB1.total, "balance reduced");
  eq(res.invoice.status, "partially_paid", "status");
  return `${cnB1.number} IGST ${rs(l.igst)}; balance ${rs(res.invoice.balance)}`;
});

await step("cancel a same-day note without refund → balance and stock come back", async () => {
  const before = await stockOf(silk.id);
  cnB2 = ok(await call("POST", `/v1/invoices/${billB.id}/credit-notes`, { reason: "return", refundMode: "none", lines: [{ line: 0, qty: 1 }] }), "note B2").creditNote;
  expect(cnB2.canCancel, "note should be cancellable today");
  const after = await stockOf(silk.id);
  if (stockOn) eq(after, before + 1, "restocked");
  const res = ok(await call("POST", `/v1/invoices/credit-notes/${cnB2.id}/cancel`, { reason: `E2E ${RUN}` }), "cancel note");
  eq(res.creditNote.status, "cancelled", "status");
  eq(res.invoice.credited, cnB1.total, "credited back to the first note");
  if (stockOn) eq(await stockOf(silk.id), before, "stock out again");
  fails(await call("POST", `/v1/invoices/credit-notes/${cnB2.id}/cancel`, {}), 409, "credit_note_locked", "cancel twice");
  return `${cnB2.number} cancelled; credited ${rs(res.invoice.credited)}`;
});

await step("e-invoice: IRN for a credit note (document type CRN, preceding invoice)", async () => {
  const acct = await call("GET", "/v1/einvoice/account");
  if (acct.status === 402 || acct.status === 403) return `e-invoice not available (${acct.status})`;
  if (!acct.json?.configured || acct.json?.provider !== "mock") {
    ok(await call("PUT", "/v1/einvoice/account", { provider: "mock", gstin: "33AABFR1234K1ZI", sandbox: true, enabled: true }), "mock account");
  }
  const p = ok(await call("GET", `/v1/einvoice/invoices/${cnB1.id}/preview`), "preview");
  eq(p.payload.DocDtls.Typ, "CRN", "doc type");
  eq(p.payload.DocDtls.No, cnB1.number, "doc no");
  eq(p.payload.RefDtls?.PrecDocDtls?.[0]?.InvNo, billB.number, "preceding invoice");
  expect(p.ok, `issues ${JSON.stringify(p.issues)}`);
  const r = ok(await call("POST", `/v1/einvoice/invoices/${cnB1.id}/irn`), "irn");
  eq(r.record.docType, "CRN", "record doc type");
  expect(/^[0-9a-f]{64}$/.test(r.record.irn), `irn ${r.record.irn}`);
  const period = today().slice(5, 7) + today().slice(0, 4);
  const g = ok(await call("GET", `/v1/einvoice/gstr1?period=${period}`), "gstr1");
  const party = g.json.cdnr.find((x) => x.ctin === KA_GSTIN);
  const nt = party?.nt.find((n) => n.nt_num === cnB1.number);
  expect(nt, `${cnB1.number} not in GSTR-1 cdnr`);
  eq(nt.val, cnB1.total / 100, "note value");
  expect(nt.itms.every((i) => i.itm_det.iamt > 0 && !i.itm_det.camt), "IGST items");
  expect(g.json.doc_issue.doc_det.some((d) => d.doc_typ === "Credit Note"), "doc_issue credit notes");
  return `IRN ${r.record.irn.slice(0, 16)}… for ${cnB1.number}; GSTR-1 cdnr ${g.counts.cdnr} note(s)`;
});

await step("drafts and cancelled bills can't get credit notes", async () => {
  const draft = ok(await call("POST", "/v1/invoices", { customer: { name: `E2E CN draft ${RUN}` }, date: today(), lines: [{ description: "Thing", qty: 1, rate: 10_000, gstRate: 5 }] }), "draft");
  fails(await call("POST", `/v1/invoices/${draft.id}/credit-notes`, { reason: "return", refundMode: "none", lines: [{ line: 0, qty: 1 }] }), 409, "credit_note_blocked", "draft");
  const issued = ok(await call("POST", `/v1/invoices/${draft.id}/issue`, {}), "issue");
  ok(await call("POST", `/v1/invoices/${issued.id}/cancel`, { reason: "E2E" }), "cancel");
  fails(await call("POST", `/v1/invoices/${issued.id}/credit-notes`, { reason: "return", refundMode: "none", lines: [{ line: 0, qty: 1 }] }), 409, "credit_note_blocked", "cancelled");
  return "409 credit_note_blocked";
});

await step("list, get, bill timeline", async () => {
  const list = ok(await call("GET", `/v1/invoices/credit-notes?q=${encodeURIComponent(billA.number)}`), "list");
  eq(list.items.length, 3, "notes of bill A");
  const one = ok(await call("GET", `/v1/invoices/credit-notes/${cn3.id}`), "get");
  eq(one.lines.length, 2, "lines");
  const inv = ok(await call("GET", `/v1/invoices/${billA.id}`), "bill");
  eq(inv.creditNotes.length, 3, "creditNotes on the bill");
  const csv = await call("GET", `/v1/invoices/credit-notes?format=csv&from=${today()}&to=${today()}`, undefined, { raw: true });
  expect(csv.status === 200 && csv.text.includes(cn1.number), `csv ${csv.status}`);
  return `${list.total} found; bill shows ${inv.creditNotes.map((n) => n.number).join(", ")}`;
});

await step("PDFs: A4 and thermal credit note", async () => {
  for (const kind of ["credit-note", "credit-note-thermal"]) {
    const r = await call("GET", `/v1/documents/${kind}/${cn1.id}.pdf`, undefined, { binary: true });
    expect(r.status === 200 && r.headers.get("content-type") === "application/pdf" && r.body.subarray(0, 4).toString() === "%PDF", `${kind}: ${r.status}`);
  }
  return "2 PDFs";
});

await step("sales register: notes are negative rows; GST summary: CDNR row, totals net", async () => {
  const reg = ok(await call("GET", `/v1/invoices/reports/sales-register?from=${today()}&to=${today()}`), "register");
  const mine = reg.items.filter((i) => i.type === "credit_note" && [cn1.id, cn2.id, cn3.id, cnB1.id].includes(i.id));
  eq(mine.length, 4, "credit note rows");
  expect(mine.every((r) => r.total < 0 && r.taxable < 0), "negative amounts");
  expect(!reg.items.some((i) => i.id === cnB2.id), "cancelled note left out");
  const gst = ok(await call("GET", `/v1/invoices/reports/gst-summary?from=${today()}&to=${today()}`), "gst");
  const row = gst.cdnr.find((r) => r.noteNumber === cnB1.number);
  expect(row, `no CDNR row for ${cnB1.number}`);
  eq(row.gstin, KA_GSTIN, "cdnr gstin");
  eq(row.igst, cnB1.totals.igst, "cdnr igst");
  eq(row.invoiceNumber, billB.number, "cdnr invoice");
  expect(gst.creditNoteTotals.count >= 4, "credit note totals");
  const csv = await call("GET", `/v1/invoices/reports/gst-summary?from=${today()}&to=${today()}&format=csv&section=cdnr`, undefined, { raw: true });
  expect(csv.status === 200 && csv.text.includes(cnB1.number), "cdnr csv");
  return `register ${mine.length} notes; cdnr ${gst.cdnr.length} rows; net taxable ${rs(gst.totals.taxable)}`;
});

await step("audit log records the credit notes", async () => {
  const r = await call("GET", "/v1/audit?limit=50");
  if (r.status === 402 || r.status === 403) return `audit not available (${r.status})`;
  const items = ok(r, "audit").items;
  expect(items.some((e) => e.action === "invoices.credit_note.issue" && (e.summary ?? "").includes(cn3.number)), "no audit entry for the note");
  return "invoices.credit_note.issue recorded";
});

// ------------------------------------------------------------------ loyalty: points taken back on the credited value
await step("loyalty: a credit note takes back the share of earned points", async () => {
  const quote = await call("POST", "/v1/loyalty/quote", { phone: testPhone(7), amount: 10_000 });
  if (quote.status >= 300) return `loyalty off (${quote.status})`;
  const phone = testPhone(7);
  let bill = ok(
    await call("POST", "/v1/invoices", { customer: { name: `E2E CN Loyal ${RUN}`, phone }, date: today(), issue: true, lines: [{ description: "E2E CN loyalty saree", qty: 2, rate: 500_000, gstRate: 5 }] }),
    "loyal bill",
  );
  bill = ok(await call("POST", `/v1/invoices/${bill.id}/payments`, { amount: bill.total, method: "cash", date: today() }), "pay");
  const members = ok(await call("GET", `/v1/loyalty/members?q=${encodeURIComponent(phone.slice(3))}`), "members").items;
  const m0 = members.find((m) => m.memberKey === phone);
  if (!m0) return "no member created (earn rule gave 0 points)";
  const cn = ok(await call("POST", `/v1/invoices/${bill.id}/credit-notes`, { reason: "return", refundMode: "cash", lines: [{ line: 0, qty: 1 }] }), "loyal note").creditNote;
  const m1 = ok(await call("GET", `/v1/loyalty/members/${m0.id}?limit=50`), "member").member;
  const expected = Math.round((m0.pointsBalance * cn.total) / bill.total);
  eq(m0.pointsBalance - m1.pointsBalance, expected, "points taken back");
  return `${m0.pointsBalance} → ${m1.pointsBalance} points after ${rs(cn.total)} returned`;
});

// ------------------------------------------------------------------ POS till session
const register = `E2E Counter ${RUN}`;
let till, tillBill, tillNote;
await step("till: open with ₹1,000 counted; second open of the register → 409", async () => {
  till = ok(await call("POST", "/v1/invoices/till/open", { register, openingCount: { 500: 1, 100: 5 }, actorName: "E2E cashier" }), "open");
  eq(till.openingCash, 100_000, "opening");
  eq(till.status, "open", "status");
  const again = fails(await call("POST", "/v1/invoices/till/open", { register, openingCash: 0 }), 409, "till_open", "open twice");
  eq(again.error.details.sessionId, till.id, "existing id");
  const cur = ok(await call("GET", `/v1/invoices/till/current?register=${encodeURIComponent(register.toLowerCase())}`), "current");
  eq(cur.session?.id, till.id, "current (case-insensitive)");
  return `${register} open with ${rs(till.openingCash)}`;
});

await step("till: bill paid in cash at the till, then a partial return refunded from the drawer", async () => {
  tillBill = ok(
    await call("POST", "/v1/invoices", {
      customer: { name: `E2E CN walk-in ${RUN}` },
      date: today(),
      issue: true,
      tillSessionId: till.id,
      lines: [{ itemId: cotton.id, description: cotton.name, hsn: cotton.hsn, qty: 3, unit: "pcs", rate: cotton.rate, gstRate: cotton.gstRate }],
    }),
    "till bill",
  );
  eq(tillBill.tillSessionId, till.id, "bill tagged");
  tillBill = ok(await call("POST", `/v1/invoices/${tillBill.id}/payments`, { amount: tillBill.total, method: "cash", date: today(), tillSessionId: till.id }), "till pay");
  tillNote = ok(
    await call("POST", `/v1/invoices/${tillBill.id}/credit-notes`, { reason: "return", refundMode: "cash", tillSessionId: till.id, lines: [{ line: 0, qty: 1 }] }),
    "till note",
  ).creditNote;
  eq(tillNote.tillSessionId, till.id, "note tagged");
  ok(await call("POST", `/v1/invoices/till/${till.id}/cash`, { amount: -5_000, reason: "Tea", actorName: "E2E cashier" }), "cash out");
  ok(await call("POST", `/v1/invoices/till/${till.id}/cash`, { amount: 20_000, reason: "Change from bank" }), "cash in");
  return `${tillBill.number} ${rs(tillBill.total)} cash; ${tillNote.number} refund ${rs(tillNote.refundAmount)}`;
});

let x;
await step("till: X report = opening + cash sales − cash refunds + in − out", async () => {
  const r = ok(await call("GET", `/v1/invoices/till/${till.id}/x`), "x report");
  x = r.report;
  eq(x.bills.count, 1, "bills");
  eq(x.cash.sales, tillBill.total, "cash sales");
  eq(x.cash.refunds, tillNote.refundAmount, "cash refunds");
  eq(x.cash.cashIn, 20_000, "cash in");
  eq(x.cash.cashOut, 5_000, "cash out");
  eq(x.cash.expected, 100_000 + tillBill.total - tillNote.refundAmount + 20_000 - 5_000, "expected cash");
  eq(x.creditNotes.count, 1, "credit notes");
  return `expected ${rs(x.cash.expected)}; payments ${x.payments.map((p) => `${p.method} ${rs(p.amount)}`).join(", ")}`;
});

await step("till: close with a count → difference stored; Z report PDF; closed till refuses cash", async () => {
  const counted = x.cash.expected - 1_000; // ₹10 short, counted as notes below
  const rupees = Math.floor(counted / 100);
  const count = { 500: Math.floor(rupees / 500), 1: rupees % 500 };
  const res = ok(await call("POST", `/v1/invoices/till/${till.id}/close`, { count, note: `E2E ${RUN}`, actorName: "E2E cashier" }), "close");
  eq(res.session.status, "closed", "status");
  eq(res.session.expectedCash, x.cash.expected, "expected");
  eq(res.session.countedCash, rupees * 100, "counted");
  eq(res.session.difference, rupees * 100 - x.cash.expected, "difference");
  const pdf = await call("GET", `/v1/documents/till-z/${till.id}.pdf`, undefined, { binary: true });
  expect(pdf.status === 200 && pdf.body.subarray(0, 4).toString() === "%PDF", `Z pdf ${pdf.status}`);
  fails(await call("POST", `/v1/invoices/till/${till.id}/cash`, { amount: 100, reason: "late" }), 409, "till_closed", "cash on closed");
  fails(
    await call("POST", `/v1/invoices/${tillBill.id}/payments`, { amount: 100, method: "cash", date: today(), tillSessionId: till.id }),
    400,
    null,
    "paid bill payment",
  );
  const cur = ok(await call("GET", `/v1/invoices/till/current?register=${encodeURIComponent(register)}`), "current");
  eq(cur.session, null, "no open session");
  const list = ok(await call("GET", `/v1/invoices/till/sessions?register=${encodeURIComponent(register)}`), "sessions");
  eq(list.items[0]?.id, till.id, "listed");
  return `difference ${rs(res.session.difference)}; Z report ${pdf.body.length} bytes`;
});

for (const [s, n, o] of results) console.log(`${s}  ${n}${o ? "  →  " + o : ""}`);
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} passed`);
process.exitCode = passed === results.length ? 0 : 1;
