// B2 e-invoice (IRN) + e-way bill + GSTR-1 on e2e-bill (BL pro: gst-einvoice, gst-ewaybill) with the mock provider.
// Each run makes its own bills (fresh numbers → fresh deterministic mock IRNs), so it is safe to re-run.
import { inflateSync } from "node:zlib";
import { call, ok, fails, eq, expect, step, today, RUN, rs } from "./lib.mjs";

const SELLER_GSTIN = "33AABFR1234K1ZI";

// ---------------------------------------------------------------- GSTIN helpers (GSTN mod-36 check character)
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function gstin(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return first14 + CHARS[(36 - (sum % 36)) % 36];
}
/** Karnataka buyer (inter-state from Tamil Nadu). */
const BUYER_GSTIN = gstin("29AAGCK4821M1Z");
const TRANSPORTER_ID = gstin("33AAACT7710P1Z");

// ---------------------------------------------------------------- PDF text extraction (no dependencies)
/** Every `N 0 obj … endobj` with its dictionary and (inflated) stream. */
function pdfObjects(buf) {
  const s = buf.toString("latin1");
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf("endobj", start);
    if (end < 0) break;
    const body = s.slice(start, end);
    const si = body.search(/\bstream\r?\n/);
    let dict = body;
    let stream = null;
    if (si >= 0) {
      dict = body.slice(0, si);
      const dataStart = start + si + body.slice(si).match(/^stream\r?\n/)[0].length;
      const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
      let dataEnd = len ? dataStart + Number(len[1]) : s.lastIndexOf("endstream", end);
      if (!len) while (dataEnd > dataStart && (s[dataEnd - 1] === "\n" || s[dataEnd - 1] === "\r")) dataEnd--;
      let raw = buf.subarray(dataStart, dataEnd);
      if (/\/FlateDecode/.test(dict)) {
        try {
          raw = inflateSync(raw);
        } catch {
          raw = null;
        }
      }
      stream = raw;
    }
    objs.set(Number(m[1]), { dict, stream });
    re.lastIndex = end;
  }
  return objs;
}

const hexBytes = (h) => Buffer.from(h.replace(/\s+/g, "").padEnd(Math.ceil(h.replace(/\s+/g, "").length / 2) * 2, "0"), "hex");
const utf16 = (h) => {
  const b = hexBytes(h);
  let out = "";
  for (let i = 0; i + 1 < b.length; i += 2) out += String.fromCharCode(b.readUInt16BE(i));
  return out;
};
const plusCode = (h, n) => {
  // destination of a bfrange: increment the last UTF-16 code unit
  const s = utf16(h);
  return s.slice(0, -1) + String.fromCharCode(s.charCodeAt(s.length - 1) + n);
};

/** ToUnicode CMap → { bytes (code length), map: Map<code, string> }. */
function parseCMap(text) {
  const map = new Map();
  let bytes = 2;
  const cs = /begincodespacerange\s*<([0-9A-Fa-f]+)>/.exec(text);
  if (cs) bytes = cs[1].length / 2;
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) map.set(parseInt(p[1], 16), utf16(p[2]));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(p[1], 16);
      const hi = parseInt(p[2], 16);
      if (p[3].startsWith("[")) {
        const dsts = [...p[3].matchAll(/<([0-9A-Fa-f]*)>/g)].map((x) => utf16(x[1]));
        for (let c = lo; c <= hi && c - lo < dsts.length; c++) map.set(c, dsts[c - lo]);
      } else {
        const h = p[3].slice(1, -1);
        for (let c = lo; c <= hi; c++) map.set(c, plusCode(h, c - lo));
      }
    }
  }
  return { bytes, map };
}

/** Literal string "(...)" → bytes (escapes handled). */
function literalBytes(src) {
  const out = [];
  for (let i = 0; i < src.length; i++) {
    let ch = src[i];
    if (ch !== "\\") {
      out.push(src.charCodeAt(i) & 0xff);
      continue;
    }
    ch = src[++i];
    const esc = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
    if (ch in esc) out.push(esc[ch]);
    else if (/[0-7]/.test(ch)) {
      let o = ch;
      while (o.length < 3 && /[0-7]/.test(src[i + 1])) o += src[++i];
      out.push(parseInt(o, 8) & 0xff);
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
    } else out.push(src.charCodeAt(i) & 0xff);
  }
  return Buffer.from(out);
}

/**
 * Text of a PDF: inflates the content streams and decodes each shown string through its font's ToUnicode CMap
 * (fonts resolved from the `/Font << /Fx n 0 R >>` resources). Returns the text in drawing order.
 */
export function pdfText(buf) {
  const objs = pdfObjects(buf);
  const deref = (dict) => {
    // inline or indirect /Font dictionary
    const inline = /\/Font\s*<<([\s\S]*?)>>/.exec(dict);
    if (inline) return inline[1];
    const ref = /\/Font\s+(\d+)\s+0\s+R/.exec(dict);
    return ref ? (objs.get(Number(ref[1]))?.dict ?? "") : "";
  };
  const fonts = new Map(); // resource name → cmap
  const cmapOf = new Map();
  for (const { dict } of objs.values()) {
    if (!/\/Font\b/.test(dict)) continue;
    for (const f of deref(dict).matchAll(/\/([A-Za-z0-9_.+-]+)\s+(\d+)\s+0\s+R/g)) {
      const fontObj = objs.get(Number(f[2]));
      const tu = fontObj && /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(fontObj.dict);
      if (!tu) continue;
      if (!cmapOf.has(tu[1])) {
        const cm = objs.get(Number(tu[1]))?.stream;
        cmapOf.set(tu[1], cm ? parseCMap(cm.toString("latin1")) : null);
      }
      if (cmapOf.get(tu[1])) fonts.set(f[1], cmapOf.get(tu[1]));
    }
  }
  const decode = (bytes, cmap) => {
    if (!cmap) return bytes.toString("latin1");
    let out = "";
    for (let i = 0; i + cmap.bytes <= bytes.length; i += cmap.bytes) {
      const code = cmap.bytes === 1 ? bytes[i] : bytes.readUIntBE(i, cmap.bytes);
      out += cmap.map.get(code) ?? "";
    }
    return out;
  };
  let text = "";
  for (const { dict, stream } of objs.values()) {
    if (!stream || /\/Subtype\s*\/(Image|Type1C|CIDFontType0C|OpenType)|\/Length1|\/CMapName|\/Type\s*\/XRef|\/Type\s*\/ObjStm/.test(dict)) continue;
    const c = stream.toString("latin1");
    if (!/\b(Tj|TJ)\b/.test(c)) continue;
    let font = null;
    const tok = /\/([A-Za-z0-9_.+-]+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f\s]*)>\s*Tj|\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\)|[-\d.\s])*)\]\s*TJ|\b(ET|T\*|Td|TD)\b/g;
    let t;
    while ((t = tok.exec(c))) {
      if (t[1]) font = fonts.get(t[1]) ?? null;
      else if (t[2] !== undefined) text += decode(hexBytes(t[2]), font);
      else if (t[3] !== undefined) text += decode(literalBytes(t[3]), font);
      else if (t[4] !== undefined) {
        for (const part of t[4].matchAll(/<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^\\)])*)\)/g))
          text += part[1] !== undefined ? decode(hexBytes(part[1]), font) : decode(literalBytes(part[2]), font);
      } else text += " ";
    }
    text += "\n";
  }
  return text;
}

// ---------------------------------------------------------------- helpers
const period = () => today().slice(5, 7) + today().slice(0, 4);
const b2bCustomer = (tag) => ({
  name: `E2E Karnataka Traders ${RUN} ${tag}`,
  gstin: BUYER_GSTIN,
  address: "12, MG Road, Bengaluru 560001",
  stateCode: "29",
});
async function items() {
  const all = ok(await call("GET", "/v1/invoices/items"), "items").items;
  const cotton = all.find((i) => i.name === "Cotton saree");
  const shirt = all.find((i) => i.name === "Readymade shirt");
  expect(cotton?.hsn && shirt?.hsn, "seed items with HSN missing (run seed:e2e)");
  return { cotton, shirt };
}
const lineOf = (it, qty) => ({ description: it.name, hsn: it.hsn, qty, unit: it.unit, rate: it.rate, gstRate: it.gstRate });
async function bill(customer, lines) {
  return ok(await call("POST", "/v1/invoices", { customer, date: today(), issue: true, lines }), "bill");
}
const decodeQr = (t) => {
  const parts = String(t).split(".");
  const json = JSON.parse(Buffer.from(parts.length === 3 ? parts[1] : t, "base64url").toString("utf8"));
  return typeof json.data === "string" ? JSON.parse(json.data) : (json.data ?? json);
};

export default async function () {
  let it;
  let b1, irn1, b2, b3;

  await step("einvoice: mock account for the shop GSTIN", async () => {
    const before = ok(await call("GET", "/v1/einvoice/account"), "get account");
    const a = ok(await call("PUT", "/v1/einvoice/account", { provider: "mock", gstin: SELLER_GSTIN, sandbox: true, enabled: true }), "put account");
    eq(a.provider, "mock", "provider");
    eq(a.gstin, SELLER_GSTIN, "account gstin");
    expect(a.passwordSet === false && !("passwordEnc" in a), "no secrets in the view");
    return `before configured=${before.configured} usingMock=${before.usingMock}; now ${a.provider} ${a.gstin}`;
  });

  await step("einvoice: B2B bill to a Karnataka GSTIN (IGST, HSN on every line) previews clean", async () => {
    it = await items();
    b1 = await bill(b2bCustomer("A"), [lineOf(it.cotton, 2), lineOf(it.shirt, 1)]);
    expect(b1.interState === true && b1.totals.igst > 0 && b1.totals.cgst === 0, `tax split ${JSON.stringify(b1.totals)}`);
    const p = ok(await call("GET", `/v1/einvoice/invoices/${b1.id}/preview`), "preview");
    expect(p.ok, `issues ${JSON.stringify(p.issues)}`);
    eq(p.payload.BuyerDtls.Gstin, BUYER_GSTIN, "buyer gstin");
    eq(p.payload.SellerDtls.Gstin, SELLER_GSTIN, "seller gstin");
    eq(p.payload.DocDtls.No, b1.number, "doc no");
    expect(p.payload.ItemList.every((l) => /^\d{4,8}$/.test(l.HsnCd)), "HSN on every line");
    return `${b1.number} ${rs(b1.total)} IGST ${rs(b1.totals.igst)}; NIC payload ${p.payload.ItemList.length} items, TotInvVal ${p.payload.ValDtls.TotInvVal}`;
  });

  await step("einvoice: generate IRN → 64-hex IRN, ack no/date, signed QR", async () => {
    const r = ok(await call("POST", `/v1/einvoice/invoices/${b1.id}/irn`), "irn");
    const rec = r.record;
    expect(r.alreadyGenerated === false, "first call should generate");
    expect(/^[0-9a-f]{64}$/.test(rec.irn), `irn ${rec.irn}`);
    expect(/^\d{15}$/.test(rec.ackNo ?? ""), `ackNo ${rec.ackNo}`);
    expect(rec.ackDate && Math.abs(Date.parse(rec.ackDate) - Date.now()) < 10 * 60_000, `ackDate ${rec.ackDate}`);
    eq(rec.status, "generated", "status");
    const qr = decodeQr(rec.signedQrCode);
    eq(qr.Irn, rec.irn, "QR Irn");
    eq(qr.DocNo, b1.number, "QR DocNo");
    eq(qr.BuyerGstin, BUYER_GSTIN, "QR BuyerGstin");
    eq(qr.SellerGstin, SELLER_GSTIN, "QR SellerGstin");
    irn1 = rec.irn;
    return `IRN ${rec.irn.slice(0, 16)}… ack ${rec.ackNo} at ${rec.ackDate}; QR ${qr.DocNo} ₹${qr.TotInvVal} HSN ${qr.MainHsnCode}${rec.mock ? " (mock)" : ""}`;
  });

  await step("einvoice: GET /invoices/:id shows the active IRN", async () => {
    const s = ok(await call("GET", `/v1/einvoice/invoices/${b1.id}`), "status");
    eq(s.einvoice?.irn, irn1, "active irn");
    expect(s.history.length >= 1 && s.einvoice.cancellableUntil, JSON.stringify(s).slice(0, 300));
    return `einvoice ${s.einvoice.status}, cancellable until ${s.einvoice.cancellableUntil}, history ${s.history.length}`;
  });

  await step("einvoice: bill PDF prints the IRN (text extracted from the PDF)", async () => {
    const r = await call("GET", `/v1/documents/invoice/${b1.id}.pdf`, undefined, { binary: true });
    if (r.status !== 200 || r.body.subarray(0, 4).toString() !== "%PDF")
      throw new Error(`PDF rendering unavailable (Chrome/puppeteer on the API?): ${r.status} ${r.body.toString("utf8", 0, 300)}`);
    const text = pdfText(r.body);
    const flat = text.replace(/\s+/g, "");
    expect(flat.length > 50, `could not extract text from the PDF (${r.body.length} bytes, ${flat.length} chars)`);
    expect(flat.includes(b1.number), `bill number ${b1.number} not found in the PDF text: ${flat.slice(0, 300)}`);
    expect(flat.includes(irn1), `IRN not found in the PDF text (${flat.length} chars): …${flat.slice(Math.max(0, flat.indexOf("IRN") - 20), flat.indexOf("IRN") + 120)}`);
    const ack = decodeQr((ok(await call("GET", `/v1/einvoice/invoices/${b1.id}`), "status")).einvoice.signedQrCode);
    return `${r.body.length} bytes; text has ${b1.number} and the IRN${flat.includes("Ack") ? " + Ack" : ""}; QR doc ${ack.DocNo}`;
  });

  await step("einvoice: generating again returns the existing IRN", async () => {
    const r = ok(await call("POST", `/v1/einvoice/invoices/${b1.id}/irn`), "irn again");
    expect(r.alreadyGenerated === true, "alreadyGenerated");
    eq(r.record.irn, irn1, "same irn");
    return `alreadyGenerated, ${r.record.irn.slice(0, 16)}…`;
  });

  await step("einvoice: cancel within 24 h (reason 2) → cancelled; no re-generation for that number", async () => {
    fails(await call("POST", `/v1/einvoice/invoices/${b1.id}/irn/cancel`, { reason: 9 }), 400, null, "bad reason code");
    const c = ok(await call("POST", `/v1/einvoice/invoices/${b1.id}/irn/cancel`, { reason: 2, remark: `E2E ${RUN} data entry mistake` }), "cancel");
    eq(c.status, "cancelled", "status");
    eq(c.cancelReason, "2", "reason");
    const s = ok(await call("GET", `/v1/einvoice/invoices/${b1.id}`), "status");
    expect(s.einvoice === null && s.history[0]?.status === "cancelled", JSON.stringify(s).slice(0, 300));
    const again = await call("POST", `/v1/einvoice/invoices/${b1.id}/irn`);
    eq(again.status, 409, `re-generate after cancel: ${JSON.stringify(again.json).slice(0, 200)}`);
    fails(await call("POST", `/v1/einvoice/invoices/${b1.id}/irn/cancel`, { reason: 2 }), 404, null, "cancel twice");
    return `cancelled at ${c.cancelledAt}; re-generate → 409 ${again.json.error?.code}; cancel again → 404`;
  });

  await step("einvoice: second B2B bill → IRN → e-way bill (transporter, vehicle, distance)", async () => {
    b2 = await bill(b2bCustomer("B"), [lineOf(it.cotton, 3)]);
    ok(await call("POST", `/v1/einvoice/invoices/${b2.id}/irn`), "irn b2");
    fails(await call("POST", `/v1/einvoice/invoices/${b2.id}/ewb`, { distance: 350, vehicleNo: "NOT A VEHICLE", transMode: 1 }), 400, "ewb_invalid", "bad vehicle no");
    const r = ok(
      await call("POST", `/v1/einvoice/invoices/${b2.id}/ewb`, {
        distance: 350,
        transMode: 1,
        transporterId: TRANSPORTER_ID,
        transporterName: "E2E Roadways",
        vehicleNo: "TN38AB1234",
        vehicleType: "R",
      }),
      "ewb",
    );
    const rec = r.record;
    expect(/^\d{12}$/.test(rec.ewbNo ?? ""), `ewbNo ${rec.ewbNo}`);
    expect(rec.ewbValidTill && Date.parse(rec.ewbValidTill) > Date.now() + 24 * 3_600_000, `validTill ${rec.ewbValidTill}`);
    eq(rec.ewbStatus, "active", "ewb status");
    const s = ok(await call("GET", `/v1/einvoice/invoices/${b2.id}`), "status");
    eq(s.ewb?.ewbNo, rec.ewbNo, "status ewb");
    const again = ok(await call("POST", `/v1/einvoice/invoices/${b2.id}/ewb`, { distance: 350, vehicleNo: "TN38AB1234" }), "ewb again");
    expect(again.alreadyGenerated === true && again.record.ewbNo === rec.ewbNo, "idempotent ewb");
    const cancelIrn = await call("POST", `/v1/einvoice/invoices/${b2.id}/irn/cancel`, { reason: 2 });
    eq(cancelIrn.status, 409, "IRN with an active e-way bill cannot be cancelled");
    return `${b2.number}: EWB ${rec.ewbNo} valid till ${rec.ewbValidTill} (350 km); IRN cancel blocked (409)`;
  });

  await step("einvoice: B2C bill (no GSTIN) is refused for IRN with a clear 400", async () => {
    b3 = await bill({ name: `E2E Walk-in ${RUN}` }, [lineOf(it.cotton, 1)]);
    const j = fails(await call("POST", `/v1/einvoice/invoices/${b3.id}/irn`), 400, "einvoice_invalid", "B2C irn");
    expect(/GSTIN|B2B|registered/i.test(j.error.message), `message: ${j.error.message}`);
    const s = ok(await call("GET", `/v1/einvoice/invoices/${b3.id}`), "status");
    eq(s.einvoice, null, "no record");
    return `${b3.number} → 400 ${j.error.code}: ${j.error.message}`;
  });

  await step("einvoice: GSTR-1 JSON for this month has the B2B bills under b2b + doc_issue", async () => {
    const p = period();
    const r = await call("GET", `/v1/einvoice/gstr1.json?period=${p}`);
    const g = ok(r, "gstr1");
    expect(/attachment; filename="GSTR1_33AABFR1234K1ZI_\d{6}\.json"/.test(r.headers.get("content-disposition") ?? ""), `disposition ${r.headers.get("content-disposition")}`);
    eq(g.gstin, SELLER_GSTIN, "gstin");
    eq(g.fp, p, "fp");
    const party = g.b2b.find((x) => x.ctin === BUYER_GSTIN);
    expect(party, `ctin ${BUYER_GSTIN} not in b2b (${g.b2b.length} parties)`);
    for (const b of [b1, b2]) {
      const inv = party.inv.find((i) => i.inum === b.number);
      expect(inv, `${b.number} not in b2b`);
      eq(inv.val, b.total / 100, `${b.number} val`);
      eq(inv.pos, "29", `${b.number} pos`);
      expect(inv.itms.every((x) => x.itm_det.iamt > 0 && !x.itm_det.camt), `${b.number} IGST items`);
    }
    expect(!g.b2b.some((x) => x.inv.some((i) => i.inum === b3.number)), "B2C bill must not be in b2b");
    const docs = g.doc_issue.doc_det.flatMap((d) => d.docs);
    const series = b1.number.replace(/\d+$/, "");
    const mine = docs.find((d) => d.from.startsWith(series) && d.from <= b1.number && d.to >= b3.number);
    expect(mine, `no doc_issue series covering ${b1.number}..${b3.number}: ${JSON.stringify(docs)}`);
    expect(mine.totnum >= 3 && mine.net_issue === mine.totnum - mine.cancel, JSON.stringify(mine));
    return `b2b parties ${g.b2b.length}, ${BUYER_GSTIN}: ${party.inv.length} bills; doc_issue ${mine.from}..${mine.to} total ${mine.totnum} cancelled ${mine.cancel}; warnings ${r.headers.get("x-gstr1-warnings")}`;
  });
}
