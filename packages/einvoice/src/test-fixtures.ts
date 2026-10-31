// Shared test data (not exported from the package).
import { gstinCheckChar } from "./gst";
import type { EInvoiceSource, SourceLine } from "./ports";

/** Appends the GSTIN check character to 14 characters. */
export const gstin = (first14: string) => `${first14}${gstinCheckChar(first14)}`;

export const SELLER_GSTIN = gstin("33AABCS1234K1Z"); // Tamil Nadu
export const BUYER_TN_GSTIN = gstin("33AACCK5678L1Z"); // Tamil Nadu
export const BUYER_KA_GSTIN = gstin("29AAFCB9012M1Z"); // Karnataka

const round = (n: number) => Math.sign(n) * Math.round(Math.abs(n));

/** Same arithmetic as @rbms/gst computeLine (exclusive prices). */
export function line(
  description: string,
  hsn: string,
  qty: number,
  unit: string,
  rate: number,
  gstRate: number,
  inter: boolean,
  discount = 0,
): SourceLine {
  const amount = round((Math.round(qty * 1000) * rate) / 1000);
  const taxable = amount - discount;
  const bp = Math.round(gstRate * 100);
  const igst = inter ? round((taxable * bp) / 10_000) : 0;
  const half = inter ? 0 : round((taxable * bp) / 20_000);
  return { description, hsn, qty, unit, rate, discount, gstRate, amount, taxable, cgst: half, sgst: half, igst, total: taxable + half * 2 + igst };
}

export function invoice(over: Partial<EInvoiceSource> & { inter?: boolean } = {}): EInvoiceSource {
  const inter = over.inter ?? false;
  const lines = over.lines ?? [
    line("Cotton saree", "5208", 2, "pcs", 125_000, 5, inter, 10_000),
    line("Silk blouse material", "50072010", 1.5, "m", 45_033, 12, inter),
  ];
  const sum = (k: "taxable" | "cgst" | "sgst" | "igst") => lines.reduce((s, l) => s + l[k], 0);
  const exact = sum("taxable") + sum("cgst") + sum("sgst") + sum("igst");
  const total = round(exact / 100) * 100;
  const { inter: _i, ...rest } = over;
  return {
    id: "22222222-2222-4222-8222-222222222222",
    number: "INV/26-27/0042",
    status: "issued",
    date: "2026-10-14",
    docType: "INV",
    seller: {
      name: "Sri Lakshmi Textiles Private Limited",
      tradeName: "Lakshmi Silks",
      gstin: SELLER_GSTIN,
      address: "12, North Car Street\nNear Big Temple",
      city: "Thanjavur",
      pincode: "613001",
      stateCode: "33",
      phone: "+91 98765 43210",
      email: "accounts@lakshmisilks.in",
    },
    buyer: inter
      ? {
          name: "Bengaluru Fabrics LLP",
          gstin: BUYER_KA_GSTIN,
          address: "45, 2nd Cross, Chickpet, Bengaluru 560053",
          stateCode: "29",
          phone: "080-22345678",
          email: null,
        }
      : {
          name: "Kumar Garments",
          gstin: BUYER_TN_GSTIN,
          address: "7, Gandhi Road, Kumbakonam - 612001",
          city: "Kumbakonam",
          stateCode: "33",
          phone: "9443012345",
          email: "kumar.garments@example.com",
        },
    placeOfSupply: inter ? "29" : "33",
    interState: inter,
    lines,
    totals: { taxable: sum("taxable"), cgst: sum("cgst"), sgst: sum("sgst"), igst: sum("igst"), roundOff: total - exact, total },
    ...rest,
  };
}
