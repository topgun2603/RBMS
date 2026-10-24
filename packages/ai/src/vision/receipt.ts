import { z } from "zod";
import type { AiSchema } from "../types";
import { VISION_SAFETY_RULES, jConf, jNum, jStr, zConf, zNum, zStr } from "./shared";

export const RECEIPT_FEATURE = "receipt-scan";
export const RECEIPT_CREDITS_HINT = 15;

export const RECEIPT_PAYMENT_MODES = ["cash", "upi", "card", "bank", "cheque", "other"] as const;

export const RECEIPT_SYSTEM = `You read a photo or PDF of a shop expense receipt or bill (electricity, rent, fuel, repairs, stationery, transport, telephone, restaurant...) in India so the owner can record it as an expense after checking.

Fields:
- vendor: the business that issued the receipt ("" if not printed). vendorGstin: its GSTIN if printed (15 characters), else "".
- date: the receipt date as YYYY-MM-DD ("" if unreadable).
- amount: the final amount paid / grand total in rupees, including GST. gstAmount: total GST printed (CGST+SGST+IGST) in rupees, or null if not printed. gstRate: the combined GST percent if clear (5, 12, 18, 28), else null.
- category: choose exactly ONE name from the list of the shop's expense categories given in the user message, the closest fit; "" if none fits. Never invent a category.
- paymentMode: one of cash, upi, card, bank, cheque, other, if the receipt shows how it was paid (e.g. "PAID BY UPI", card slip); null when not shown.
- note: a short plain description of what the payment was for (max 120 characters), from the receipt text.
- confidence: high / medium / low for vendor, date, amount, category and paymentMode.
- readable: false when this is not a receipt or cannot be read; explain in "unreadableReason".
${VISION_SAFETY_RULES}`;

export const RECEIPT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["readable", "unreadableReason", "vendor", "vendorGstin", "date", "amount", "gstAmount", "gstRate", "category", "paymentMode", "note", "confidence"],
  properties: {
    readable: { type: "boolean" },
    unreadableReason: jStr,
    vendor: jStr,
    vendorGstin: jStr,
    date: jStr,
    amount: jNum,
    gstAmount: jNum,
    gstRate: jNum,
    category: jStr,
    paymentMode: { anyOf: [{ type: "string", enum: [...RECEIPT_PAYMENT_MODES] }, { type: "null" }] },
    note: jStr,
    confidence: {
      type: "object",
      additionalProperties: false,
      required: ["vendor", "date", "amount", "category", "paymentMode"],
      properties: { vendor: jConf, date: jConf, amount: jConf, category: jConf, paymentMode: jConf },
    },
  },
} as const;

export const ReceiptRawSchema = z.object({
  readable: z.boolean().catch(false),
  unreadableReason: zStr,
  vendor: zStr,
  vendorGstin: zStr,
  date: zStr,
  amount: zNum,
  gstAmount: zNum,
  gstRate: zNum,
  category: zStr,
  paymentMode: zStr,
  note: zStr,
  confidence: z.object({ vendor: zConf, date: zConf, amount: zConf, category: zConf, paymentMode: zConf }),
});
export type ReceiptRaw = z.infer<typeof ReceiptRawSchema>;

export const RECEIPT_SCHEMA: AiSchema<ReceiptRaw> = {
  name: "expense_receipt",
  jsonSchema: RECEIPT_JSON_SCHEMA as unknown as Record<string, unknown>,
  zod: ReceiptRawSchema as unknown as z.ZodType<ReceiptRaw>,
};
