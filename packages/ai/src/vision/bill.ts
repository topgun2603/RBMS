import { z } from "zod";
import type { AiSchema } from "../types";
import { VISION_SAFETY_RULES, jConf, jNum, jStr, zConf, zNum, zStr } from "./shared";

export const PURCHASE_BILL_FEATURE = "bill-scan";
/** What one scan costs, for "about N credits" before scanning (measured on the synthetic bills; opus-5-5, low effort). */
export const PURCHASE_BILL_CREDITS_HINT = 40;

export const PURCHASE_BILL_SYSTEM = `You read photos and PDFs of Indian supplier tax invoices (purchase bills) for a shop owner who will check the result before saving. Extract exactly what is printed.

Fields:
- supplier: the SELLER who issued the bill (not the buyer/"Bill to"/"Ship to" party): name, GSTIN (15 characters, uppercase; "" if absent), address, state name.
- invoice: the bill number, the bill date, and the place of supply (state name or 2-digit code) if printed.
- lines: one entry per item row, in order. description as printed (include strength/size/pack text). code = the supplier's item code or barcode if printed, else "". hsn = HSN/SAC digits only. qty = billed quantity (a number). unit = the printed unit (pcs, kg, strip, box, ...). rate = price per unit BEFORE GST, in rupees (if the bill prints only a GST-inclusive price, back out the tax and say so in notes; if the line shows a unit rate AND an amount, rate x qty minus discount should equal the taxable amount). discount = the line discount amount in rupees (0 when none; if shown as %, convert to rupees). gstRate = the combined GST percent for the line (CGST+SGST or IGST), e.g. 5, 12, 18. mrp = printed MRP per unit or null. batch = batch number or "". expiry = expiry as YYYY-MM (month and year) or "". packSize = pack description such as "10x10" or "1 L" or "".
- totals: the printed taxable value, CGST, SGST, IGST, cess, round off (signed) and grand total in rupees; null when not printed.
- confidence: for each header field and for each line field, "high" when printed clearly, "medium" when partly unclear, "low" when you are guessing or it is smudged.
- notes: short text for anything the owner should know (illegible parts, tax inclusive prices, credit note, handwritten). Empty string when nothing.
- readable: false when this is not a purchase bill or cannot be read.
Skip rows that are not items (sub-totals, "carried forward"); freight is an item only if charged with tax. Do not merge or split rows.
${VISION_SAFETY_RULES}`;

const lineJson = {
  type: "object",
  additionalProperties: false,
  required: ["description", "code", "hsn", "qty", "unit", "rate", "discount", "gstRate", "mrp", "batch", "expiry", "packSize", "confidence"],
  properties: {
    description: { type: "string" },
    code: jStr,
    hsn: jStr,
    qty: jNum,
    unit: jStr,
    rate: jNum,
    discount: jNum,
    gstRate: jNum,
    mrp: jNum,
    batch: jStr,
    expiry: jStr,
    packSize: jStr,
    confidence: {
      type: "object",
      additionalProperties: false,
      required: ["description", "qty", "rate", "gstRate", "hsn"],
      properties: { description: jConf, qty: jConf, rate: jConf, gstRate: jConf, hsn: jConf },
    },
  },
} as const;

export const PURCHASE_BILL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["readable", "supplier", "invoice", "lines", "totals", "confidence", "notes"],
  properties: {
    readable: { type: "boolean" },
    supplier: { type: "object", additionalProperties: false, required: ["name", "gstin", "address", "state"], properties: { name: jStr, gstin: jStr, address: jStr, state: jStr } },
    invoice: { type: "object", additionalProperties: false, required: ["number", "date", "placeOfSupply"], properties: { number: jStr, date: jStr, placeOfSupply: jStr } },
    lines: { type: "array", items: lineJson },
    totals: {
      type: "object",
      additionalProperties: false,
      required: ["taxable", "cgst", "sgst", "igst", "cess", "roundOff", "total"],
      properties: { taxable: jNum, cgst: jNum, sgst: jNum, igst: jNum, cess: jNum, roundOff: jNum, total: jNum },
    },
    confidence: {
      type: "object",
      additionalProperties: false,
      required: ["supplierName", "supplierGstin", "invoiceNumber", "invoiceDate", "totals"],
      properties: { supplierName: jConf, supplierGstin: jConf, invoiceNumber: jConf, invoiceDate: jConf, totals: jConf },
    },
    notes: { type: "string" },
  },
} as const;

const lineConf = z
  .object({ description: zConf, qty: zConf, rate: zConf, gstRate: zConf, hsn: zConf })
  .catch({ description: "low", qty: "low", rate: "low", gstRate: "low", hsn: "low" });

export const PurchaseBillRawSchema = z.object({
  readable: z.boolean().catch(false),
  supplier: z.object({ name: zStr, gstin: zStr, address: zStr, state: zStr }),
  invoice: z.object({ number: zStr, date: zStr, placeOfSupply: zStr }),
  lines: z
    .array(
      z.object({
        description: z.string().catch(""),
        code: zStr,
        hsn: zStr,
        qty: zNum,
        unit: zStr,
        rate: zNum,
        discount: zNum,
        gstRate: zNum,
        mrp: zNum,
        batch: zStr,
        expiry: zStr,
        packSize: zStr,
        confidence: lineConf,
      }),
    )
    .max(200),
  totals: z.object({ taxable: zNum, cgst: zNum, sgst: zNum, igst: zNum, cess: zNum, roundOff: zNum, total: zNum }),
  confidence: z.object({ supplierName: zConf, supplierGstin: zConf, invoiceNumber: zConf, invoiceDate: zConf, totals: zConf }),
  notes: z.string().catch(""),
});
export type PurchaseBillRaw = z.infer<typeof PurchaseBillRawSchema>;

export const PURCHASE_BILL_SCHEMA: AiSchema<PurchaseBillRaw> = {
  name: "purchase_bill",
  jsonSchema: PURCHASE_BILL_JSON_SCHEMA as unknown as Record<string, unknown>,
  zod: PurchaseBillRawSchema as unknown as z.ZodType<PurchaseBillRaw>,
};
