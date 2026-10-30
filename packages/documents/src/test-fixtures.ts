import { amountInWordsINR, computeInvoice } from "@rbms/gst";
import type { InvoiceDocData, OrderDocData, PurchaseDocData, PurchaseOrderDocData, QuotationDocData, StatementDocData } from "./types";

const seller = {
  legalName: "Raja Textiles <Pvt>",
  gstin: "33AAACR5055K1ZE",
  address: "12, Gandhi Road\nT. Nagar",
  city: "Chennai",
  pincode: "600017",
  stateCode: "33",
  phone: "+919876543210",
  email: "raja@example.com",
  terms: "Goods once sold will not be taken back.",
  bankName: "Indian Bank",
  accountNumber: "1234567890",
  ifsc: "IDIB000T001",
  upiId: "raja@okicici",
};

export function sampleInvoice(over: Partial<InvoiceDocData> = {}): InvoiceDocData {
  const { lines, ...totals } = computeInvoice(
    [
      { description: "பட்டு சேலை (Silk saree)", hsn: "5007", qty: 2, unit: "pcs", rate: 250000, gstRate: 5, discount: 10000 },
      { description: 'Cotton dhoti "premium" <b>', hsn: "5208", qty: 1.5, unit: "m", rate: 45050, gstRate: 5 },
      { description: "Stitching", hsn: "9988", qty: 1, unit: "job", rate: 30000, gstRate: 18 },
    ],
    { sellerState: "33", placeOfSupply: "33" },
  );
  return {
    id: "6f1c2a9e-0000-4000-8000-000000000001",
    number: "INV/26-27/0042",
    status: "partially_paid",
    date: "2026-10-15",
    dueDate: "2026-10-30",
    customer: { name: "முருகன் ஸ்டோர்ஸ்", phone: "+919800000001", email: null, gstin: "33AAACR5055K1ZE", address: "5, Car Street\nMadurai", stateCode: "33" },
    seller,
    placeOfSupply: "33",
    interState: false,
    lines,
    totals,
    amountInWords: amountInWordsINR(totals.total),
    notes: "Deliver before Deepavali",
    paid: 100000,
    balance: totals.total - 100000,
    cancelReason: null,
    updatedAt: new Date("2026-10-15T10:00:00Z"),
    ...over,
  };
}

export const sampleStatement = (): StatementDocData => ({
  customer: { name: "Kumar & Sons", phone: "+919800000002", stateCode: "33" },
  seller,
  from: "2026-09-01",
  to: "2026-10-15",
  ledger: {
    openingBalance: 50000,
    closingBalance: 125000,
    entries: [
      { date: "2026-09-01", type: "opening", number: null, description: "Opening balance", debit: 0, credit: 0, balance: 50000 },
      { date: "2026-09-10", type: "invoice", number: "INV/26-27/0010", description: "Bill", debit: 100000, credit: 0, balance: 150000 },
      { date: "2026-09-20", type: "receipt", number: null, description: "Cash <receipt>", debit: 0, credit: 25000, balance: 125000 },
    ],
  },
});

export const sampleOrder = (over: Partial<OrderDocData> = {}): OrderDocData => ({
  number: "ORD/26-27/0007",
  placedAt: "2026-10-14",
  customer: { name: "Lakshmi", phone: "+919800000003" },
  shippingAddress: { name: "லட்சுமி", line1: "7, Temple St", city: "Coimbatore", state: "Tamil Nadu", pincode: "641001", phone: "+919800000003" },
  lines: [
    { name: "Kanchipuram saree – Red", sku: "KS-RED", qty: 1, unit: "pcs", price: 450000, total: 450000 },
    { name: "Blouse <custom>", sku: null, qty: 2, unit: "pcs" },
  ],
  total: 480000,
  paymentStatus: "cod",
  paymentMethod: "cod",
  fulfillment: { carrier: "India Post", trackingNumber: "EE123456789IN" },
  customerNote: "Call before delivery",
  seller,
  ...over,
});

export const samplePurchaseOrder = (over: Partial<PurchaseOrderDocData> = {}): PurchaseOrderDocData => {
  const { lines, ...totals } = computeInvoice([{ description: "Silk yarn", hsn: "5004", qty: 10, unit: "kg", rate: 120000, gstRate: 5 }], {
    sellerState: "29",
    placeOfSupply: "33",
  });
  return {
    number: "PO/26-27/0007",
    status: "sent",
    date: "2026-10-01",
    expectedDate: "2026-10-08",
    supplier: { name: "Mysore Silks", gstin: "29AAACR5055K1ZF", stateCode: "29", phone: "+919876500001" },
    placeOfSupply: "33",
    interState: true,
    lines,
    totals,
    total: totals.total,
    notes: "Deliver before Diwali",
    shop: seller,
    ...over,
  };
};

export const samplePurchase = (): PurchaseDocData => {
  const { lines, ...totals } = computeInvoice([{ description: "Silk yarn", hsn: "5004", qty: 10, unit: "kg", rate: 120000, gstRate: 5 }], {
    sellerState: "29",
    placeOfSupply: "33",
  });
  return {
    billNumber: "KA/889",
    date: "2026-10-01",
    supplier: { name: "Mysore Silks", gstin: "29AAACR5055K1ZF", stateCode: "29" },
    placeOfSupply: "33",
    interState: true,
    lines,
    totals,
    total: totals.total,
    paid: false,
    status: "recorded",
    notes: null,
    shop: seller,
  };
};

export function sampleQuotation(over: Partial<QuotationDocData> = {}): QuotationDocData {
  const { lines, ...totals } = computeInvoice(
    [
      { description: "Cement 50 kg (OPC)", hsn: "2523", qty: 40, unit: "bag", rate: 36000, gstRate: 28 },
      { description: "TMT bar 12 mm", hsn: "7214", qty: 2, unit: "ton", rate: 5800000, gstRate: 18, discount: 50000 },
    ],
    { sellerState: "33", placeOfSupply: "33" },
  );
  return {
    id: "6f1c2a9e-0000-4000-8000-000000000009",
    number: "QT/26-27/0007",
    rev: 1,
    status: "sent",
    date: "2026-10-14",
    validUntil: "2026-10-29",
    customer: { name: "Kumar Constructions", phone: "+919800000002", email: null, gstin: null, address: "9, Anna Salai\nMadurai", stateCode: "33" },
    seller,
    placeOfSupply: "33",
    interState: false,
    lines,
    totals,
    amountInWords: amountInWordsINR(totals.total),
    notes: "Site: Anna Nagar, 2nd floor slab",
    terms: "Prices valid for 15 days. Unloading charges extra.",
    deliveryText: "2 weeks after advance",
    advancePercent: 50,
    advanceAmount: Math.round(totals.total / 2),
    acceptedBy: null,
    acceptedAt: null,
    updatedAt: "2026-10-14T06:00:00Z",
    ...over,
  };
}
