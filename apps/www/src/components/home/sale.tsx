"use client";

import * as React from "react";
import { computeInvoice, exclusiveOf, type GstRate, type InvoiceTotals, type LineInput } from "@rbms/gst";

/**
 * The sale behind the home page: the hero's try-it counter fills it, and "one bill, six jobs" below shows what that same
 * bill does. Tax comes from @rbms/gst, the code real bills use. Sample shop and prices; nothing leaves the browser.
 *
 * Rates checked 2026-11-04 against the 9/2025-CT(R) schedules as reported (toothpaste and edible oil 5%, aerated drinks 40%,
 * UHT milk and loose rice nil); chargers 18% as in apps/api/src/demo-stores/kaipesi.ts.
 */
export interface SaleItem {
  id: string;
  en: string;
  ta: string;
  /** Tax-inclusive price, paise. */
  price: number;
  gstRate: GstRate;
  hsn: string;
  stock: number;
}

export const SALE_ITEMS: readonly SaleItem[] = [
  { id: "oil", en: "Sunflower oil 1 L", ta: "சூரியகாந்தி எண்ணெய் 1 லி", price: 16500, gstRate: 5, hsn: "1512", stock: 24 },
  { id: "paste", en: "Toothpaste 150 g", ta: "பற்பசை 150 கி", price: 9900, gstRate: 5, hsn: "3306", stock: 18 },
  { id: "cola", en: "Cola 750 ml", ta: "கோலா 750 மி.லி", price: 4500, gstRate: 40, hsn: "2202", stock: 7 },
  { id: "milk", en: "UHT milk 1 L", ta: "UHT பால் 1 லி", price: 7200, gstRate: 0, hsn: "0401", stock: 30 },
  { id: "rice", en: "Loose rice 1 kg", ta: "உதிரி அரிசி 1 கிலோ", price: 6200, gstRate: 0, hsn: "1006", stock: 120 },
  { id: "charger", en: "Phone charger", ta: "போன் சார்ஜர்", price: 29900, gstRate: 18, hsn: "8504", stock: 6 },
];

/** At or below this, the stock panel shows the low-stock warning. */
export const LOW_STOCK = 5;

export type PayMode = "cash" | "upi" | "credit";

export interface SaleLine {
  id: string;
  qty: number;
}

const START: SaleLine[] = [
  { id: "oil", qty: 1 },
  { id: "paste", qty: 1 },
  { id: "cola", qty: 2 },
];

export const itemOf = (id: string) => SALE_ITEMS.find((i) => i.id === id)!;

/** Tamil Nadu shop, walk-in in Tamil Nadu: CGST + SGST. Prices include tax, so each line's total is exact. */
export function totalsOf(lines: readonly SaleLine[]): InvoiceTotals {
  const input: LineInput[] = lines.map((l) => {
    const item = itemOf(l.id);
    return { description: item.en, hsn: item.hsn, qty: l.qty, rate: exclusiveOf(item.price, item.gstRate, true), gstRate: item.gstRate, inclusiveTotal: item.price * l.qty };
  });
  return computeInvoice(input, { sellerState: "33", placeOfSupply: "33" });
}

interface SaleState {
  lines: SaleLine[];
  totals: InvoiceTotals;
  paid: PayMode | null;
  billNo: number;
  /** Set once the visitor touches the counter: the opening demo stops. */
  touched: boolean;
  add: (id: string, by?: "visitor" | "demo") => void;
  remove: (id: string) => void;
  pay: (mode: PayMode, by?: "visitor" | "demo") => void;
  newBill: () => void;
}

const SaleContext = React.createContext<SaleState | null>(null);

export function useSale() {
  const v = React.useContext(SaleContext);
  if (!v) throw new Error("useSale needs SaleProvider");
  return v;
}

export function SaleProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = React.useState<SaleLine[]>(START);
  const [paid, setPaid] = React.useState<PayMode | null>(null);
  const [billNo, setBillNo] = React.useState(1042);
  const [touched, setTouched] = React.useState(false);

  const value = React.useMemo<SaleState>(() => {
    const bump = (cur: SaleLine[], id: string) => (cur.some((l) => l.id === id) ? cur.map((l) => (l.id === id ? { ...l, qty: l.qty + 1 } : l)) : [...cur, { id, qty: 1 }]);
    return {
      lines,
      paid,
      billNo,
      touched,
      totals: totalsOf(lines),
      add: (id, by = "visitor") => {
        if (by === "visitor") setTouched(true);
        // Tapping an item after payment starts the next bill, as at a real counter.
        if (paid) {
          setPaid(null);
          setBillNo((n) => n + 1);
          setLines([{ id, qty: 1 }]);
        } else setLines((cur) => bump(cur, id));
      },
      remove: (id) => {
        setTouched(true);
        setLines((cur) => cur.flatMap((l) => (l.id !== id ? [l] : l.qty > 1 ? [{ ...l, qty: l.qty - 1 }] : [])));
      },
      pay: (mode, by = "visitor") => {
        if (by === "visitor") setTouched(true);
        setPaid(mode);
      },
      newBill: () => {
        setTouched(true);
        setPaid(null);
        setBillNo((n) => n + 1);
        setLines([]);
      },
    };
  }, [lines, paid, billNo, touched]);

  return <SaleContext.Provider value={value}>{children}</SaleContext.Provider>;
}

/** Always two decimals, the way a bill prints money: 1302 → ₹1,302.00. */
export const billMoney = (paise: number) => `${paise < 0 ? "-" : ""}₹${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(paise) / 100)}`;
