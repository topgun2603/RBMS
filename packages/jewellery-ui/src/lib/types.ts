import type { MakingType, Metal, Purity, ResolvedRate } from "./pricing";

export type { MakingType, Metal, Purity, ResolvedRate };

export const PIECE_STATUSES = ["in_stock", "reserved", "sold"] as const;
export type PieceStatus = (typeof PIECE_STATUSES)[number];

export const EXCHANGE_STATUSES = ["open", "applied", "cancelled"] as const;
export type ExchangeStatus = (typeof EXCHANGE_STATUSES)[number];

export interface RateEntry {
  metal: Metal;
  purity: Purity;
  ratePerGram: number;
}

export interface EffectiveRate extends ResolvedRate {
  date: string | null;
}

export interface RatesView {
  date: string;
  setToday: boolean;
  today: ResolvedRate[];
  entered: RateEntry[];
  effective: EffectiveRate[];
  history: { date: string; rates: ResolvedRate[] }[];
}

export interface RepriceResult {
  repriced: number;
  unchanged: number;
  noRate: number;
  failed: number;
}

export interface Piece {
  id: string;
  itemId: string;
  name: string;
  metal: Metal;
  purity: Purity;
  grossWeight: number;
  stoneWeight: number;
  netWeight: number;
  wastagePct: number;
  makingType: MakingType;
  makingValue: number;
  stoneCharges: number;
  huid: string | null;
  tagNo: string | null;
  status: PieceStatus;
  lastPrice: number | null;
  priceUpdatedAt: string | null;
  updatedAt: string;
}

export interface Breakdown {
  netWeight: number;
  ratePerGram: number;
  metalValue: number;
  wastage: number;
  making: number;
  stones: number;
  subtotal: number;
  rounding: number;
  total: number;
  gstRate: number;
  gst: number;
  totalWithGst: number;
}

export interface PiecePrice {
  piece: Piece;
  rate: { date: string | null; ratePerGram: number; source: ResolvedRate["source"] } | null;
  breakdown: Breakdown | null;
}

export interface ExchangeLine {
  description: string;
  metal: Metal;
  purity: Purity;
  grossWeight: number;
  deductionPct: number;
  netWeight: number;
  ratePerGram: number;
  value: number;
}

export interface ExchangeSummary {
  id: string;
  code: string;
  number: number;
  date: string;
  customerName: string;
  customerPhone: string | null;
  total: number;
  invoiceId: string | null;
  appliedAt: string | null;
  status: ExchangeStatus;
  note: string | null;
  lineCount: number;
  createdAt: string;
}

export interface Exchange extends Omit<ExchangeSummary, "lineCount"> {
  lines: ExchangeLine[];
}

export interface JewellerySettings {
  gstRate: number;
  buybackPct: number;
  roundTo: number;
}

export interface ShopItem {
  id: string;
  name: string;
  hsn: string | null;
  unit: string;
  rate: number;
  gstRate: number;
}

export interface BillSummary {
  id: string;
  number: string | null;
  date: string;
  customer?: { name: string } | null;
  customerName?: string | null;
  total: number;
  balance?: number;
}
