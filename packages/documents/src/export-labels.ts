import type { DocLocale } from "./types";

/** Printed text of export / SEZ / foreign-currency bills (docs/recurring-export-gstin.md), English and Tamil. */
export interface ExportLabels {
  exportWopay: string;
  exportWpay: string;
  sezWopay: string;
  sezWpay: string;
  /** "{no}", "{date}". */
  lut: string;
  shippingBill: string;
  shippingBillDate: string;
  portCode: string;
  currency: string;
  exchangeRate: string;
  /** "{cur}". */
  amountIn: string;
  totalIn: string;
  taxIn: string;
  country: string;
  inrNote: string;
}

const en: ExportLabels = {
  exportWopay: "Supply meant for export under LUT without payment of IGST",
  exportWpay: "Supply meant for export with payment of IGST",
  sezWopay: "Supply meant for SEZ unit or developer under LUT without payment of IGST",
  sezWpay: "Supply meant for SEZ unit or developer with payment of IGST",
  lut: "LUT No. {no} dated {date}",
  shippingBill: "Shipping bill",
  shippingBillDate: "Shipping bill date",
  portCode: "Port code",
  currency: "Currency",
  exchangeRate: "Exchange rate",
  amountIn: "Amount ({cur})",
  totalIn: "Total ({cur})",
  taxIn: "IGST ({cur})",
  country: "Country",
  inrNote: "GST and accounts are in Indian rupees; the {cur} figures are at the exchange rate above.",
};

const ta: ExportLabels = {
  exportWopay: "ஏற்றுமதிக்கான விநியோகம் – LUT-இன் கீழ் IGST செலுத்தாமல்",
  exportWpay: "ஏற்றுமதிக்கான விநியோகம் – IGST செலுத்தி",
  sezWopay: "SEZ அலகு / மேம்பாட்டாளருக்கான விநியோகம் – LUT-இன் கீழ் IGST செலுத்தாமல்",
  sezWpay: "SEZ அலகு / மேம்பாட்டாளருக்கான விநியோகம் – IGST செலுத்தி",
  lut: "LUT எண் {no}, தேதி {date}",
  shippingBill: "ஷிப்பிங் பில்",
  shippingBillDate: "ஷிப்பிங் பில் தேதி",
  portCode: "துறைமுகக் குறியீடு",
  currency: "நாணயம்",
  exchangeRate: "மாற்று விகிதம்",
  amountIn: "தொகை ({cur})",
  totalIn: "மொத்தம் ({cur})",
  taxIn: "IGST ({cur})",
  country: "நாடு",
  inrNote: "GST மற்றும் கணக்குகள் இந்திய ரூபாயில்; {cur} தொகைகள் மேலே உள்ள மாற்று விகிதத்தில்.",
};

export const exportLabels = (locale: DocLocale): ExportLabels => (locale === "ta" ? ta : en);

/** The declaration an export / SEZ bill must carry (Rule 46 CGST), or null for a domestic bill. */
export function supplyDeclaration(supplyType: string | null | undefined, t: ExportLabels): string | null {
  switch (supplyType) {
    case "export_wopay":
      return t.exportWopay;
    case "export_wpay":
      return t.exportWpay;
    case "sez_wopay":
      return t.sezWopay;
    case "sez_wpay":
      return t.sezWpay;
    default:
      return null;
  }
}
