export type ReceiptLocale = "en" | "ta";

export interface ReceiptLabels {
  taxInvoice: string;
  customer: string;
  taxable: string;
  roundOff: string;
  total: string;
  change: string;
  balance: string;
  thanks: string;
  points: string;
  gstin: string;
  scanToPay: string;
  einvoiceQr: string;
  cash: string;
  upi: string;
  card: string;
  other: string;
  noSale: string;
}

/** Same wording as pos.print.* in the counter's messages (English and Tamil). */
export const RECEIPT_LABELS: Record<ReceiptLocale, ReceiptLabels> = {
  en: {
    taxInvoice: "TAX INVOICE",
    customer: "Customer",
    taxable: "Taxable value",
    roundOff: "Round off",
    total: "TOTAL",
    change: "Change",
    balance: "Balance due",
    thanks: "Thank you! Visit again.",
    points: "Points ({count})",
    gstin: "GSTIN",
    scanToPay: "Scan to pay (UPI)",
    einvoiceQr: "E-invoice QR",
    cash: "Cash",
    upi: "UPI",
    card: "Card",
    other: "Other",
    noSale: "NO SALE",
  },
  ta: {
    taxInvoice: "வரி விலைப்பட்டியல்",
    customer: "வாடிக்கையாளர்",
    taxable: "வரிக்குரிய மதிப்பு",
    roundOff: "முழுமையாக்கல்",
    total: "மொத்தம்",
    change: "மீதி",
    balance: "நிலுவை",
    thanks: "நன்றி! மீண்டும் வருக.",
    points: "புள்ளிகள் ({count})",
    gstin: "GSTIN",
    scanToPay: "UPI மூலம் செலுத்த ஸ்கேன் செய்யவும்",
    einvoiceQr: "மின்னணு விலைப்பட்டியல் QR",
    cash: "ரொக்கம்",
    upi: "UPI",
    card: "கார்டு",
    other: "மற்றவை",
    noSale: "விற்பனை இல்லை",
  },
};
