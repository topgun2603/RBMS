/**
 * Pure valuation rules (docs/valuation-reports.md): FIFO draws from cost layers, the cost of a movement under both
 * methods, landed-charge allocation, method switching and the history replay that builds the layers of an existing
 * shop. Quantities are milli (thousandths), money paise.
 */
import { movingAverageCost, QTY_SCALE } from "./logic";
import { apportion } from "./payables";
import type { ChargeBasis, PurchaseCharge, ValuationMethod, ValuationMethodChange } from "./schema-costing";

/** An open layer as the draw logic sees it. */
export interface OpenLayer {
  id: string;
  /** Epoch ms of `received_at`. */
  at: number;
  seq: number;
  batchId: string | null;
  refKey: string | null;
  milli: number;
  value: number;
}

export interface DrawPart {
  layerId: string;
  milli: number;
  value: number;
}

export interface DrawPlan {
  parts: DrawPart[];
  /** Not covered by any layer (stock going negative, or layers short of the quantity). */
  shortMilli: number;
}

export const refKeyOf = (refType: string | null | undefined, refId: string | null | undefined) => (refType && refId ? `${refType}:${refId}` : null);

/** Value of `milli` taken from a layer: its share of what is left (the last units take the rest, so nothing is lost). */
export function drawValue(layer: Pick<OpenLayer, "milli" | "value">, milli: number): number {
  if (milli >= layer.milli) return layer.value;
  if (layer.milli <= 0) return 0;
  return Math.round((layer.value * milli) / layer.milli);
}

const byAge = (a: OpenLayer, b: OpenLayer) => a.at - b.at || a.seq - b.seq;

/**
 * Takes `milli` from the open layers, oldest first. Order: layers of the same document (`refKeys`: a purchase
 * cancelled or returned takes back its own goods), then the batches the stock left from (`batches`), then unbatched
 * layers, then any. Layers are not changed; apply the plan with `applyPlan`.
 */
export function planDraw(layers: readonly OpenLayer[], milli: number, prefer: { refKeys?: readonly string[]; batches?: readonly { batchId: string; milli: number }[] } = {}): DrawPlan {
  const left = new Map(layers.map((l) => [l.id, { milli: l.milli, value: l.value }]));
  const sorted = [...layers].filter((l) => l.milli > 0).sort(byAge);
  const parts = new Map<string, DrawPart>();
  let need = Math.max(0, milli);
  const take = (l: OpenLayer, max: number) => {
    const cur = left.get(l.id)!;
    const q = Math.min(cur.milli, max, need);
    if (q <= 0) return 0;
    const v = drawValue(cur, q);
    cur.milli -= q;
    cur.value -= v;
    need -= q;
    const p = parts.get(l.id) ?? { layerId: l.id, milli: 0, value: 0 };
    p.milli += q;
    p.value += v;
    parts.set(l.id, p);
    return q;
  };
  const keys = new Set(prefer.refKeys ?? []);
  if (keys.size) for (const l of sorted) if (l.refKey && keys.has(l.refKey)) take(l, Infinity);
  for (const b of prefer.batches ?? []) {
    let want = b.milli;
    for (const l of sorted) {
      if (want <= 0 || need <= 0) break;
      if (l.batchId === b.batchId) want -= take(l, want);
    }
  }
  for (const l of sorted) if (l.batchId === null) take(l, Infinity);
  for (const l of sorted) take(l, Infinity);
  return { parts: [...parts.values()], shortMilli: need };
}

/** The layers after a plan (in place); returns the ids of layers that are now empty. */
export function applyPlan(layers: OpenLayer[], plan: DrawPlan): string[] {
  const emptied: string[] = [];
  for (const p of plan.parts) {
    const l = layers.find((x) => x.id === p.layerId);
    if (!l) continue;
    l.milli -= p.milli;
    l.value -= p.value;
    if (l.milli <= 0) emptied.push(l.id);
  }
  return emptied;
}

/** paise for `milli` at `unit` paise per unit. */
export const valueOf = (milli: number, unit: number | null | undefined) => (unit ? Math.round((milli * unit) / QTY_SCALE) : 0);

/** Unit cost (paise) of `value` over `milli`. */
export const unitOf = (value: number, milli: number) => (milli > 0 ? Math.round((value * QTY_SCALE) / milli) : 0);

/** Where the cost of incoming goods comes from, best first. */
export interface IncomingCostInput {
  deltaMilli: number;
  /** Quantity at the location before the change (may be negative). */
  beforeMilli: number;
  /** Explicit cost of the goods (purchase, opening stock, transfer at the sender's average). */
  unitCost: number | null;
  /** Average cost before the change. */
  avgBefore: number | null;
  /** The same goods going out earlier (sale of a return, transfer out of a receipt, challan out...): qty and both values. */
  counterpart: { milli: number; avg: number; fifo: number } | null;
}

export interface IncomingCost {
  costAvg: number;
  costFifo: number;
  /** Quantity that becomes a layer (incoming stock first covers stock that had gone negative). */
  layerMilli: number;
  layerValue: number;
}

/**
 * The value of stock coming in. Returns and reversals come back at the cost they went out with (so a credit note
 * reverses the cost of goods sold of its bill); purchases and opening stock at their cost; anything else at the
 * average before. The average itself is untouched here (that is the existing moving-average rule in `change()`).
 */
export function incomingCost(p: IncomingCostInput): IncomingCost {
  const cp = p.counterpart && p.counterpart.milli > 0 ? p.counterpart : null;
  const scale = (v: number) => (cp ? Math.round((v * p.deltaMilli) / cp.milli) : 0);
  const fifoUnitValue = cp ? scale(cp.fifo) : valueOf(p.deltaMilli, p.unitCost ?? p.avgBefore);
  const costAvg = p.unitCost !== null ? valueOf(p.deltaMilli, p.unitCost) : cp ? scale(cp.avg) : valueOf(p.deltaMilli, p.avgBefore);
  const layerMilli = p.beforeMilli < 0 ? Math.max(0, p.beforeMilli + p.deltaMilli) : p.deltaMilli;
  const layerValue = layerMilli === p.deltaMilli ? fifoUnitValue : Math.round((fifoUnitValue * layerMilli) / p.deltaMilli);
  return { costAvg, costFifo: fifoUnitValue, layerMilli, layerValue };
}

/** Value of stock going out under both methods: the average before, and the FIFO draws (short part at the average). */
export function outgoingCost(milli: number, avgBefore: number | null, plan: DrawPlan, fallbackUnit: number | null = null): { costAvg: number; costFifo: number; shortValue: number } {
  const unit = avgBefore ?? fallbackUnit;
  const shortValue = valueOf(plan.shortMilli, unit);
  return { costAvg: -valueOf(milli, avgBefore ?? fallbackUnit), costFifo: -(plan.parts.reduce((s, x) => s + x.value, 0) + shortValue), shortValue };
}

// ------------------------------------------------------------------ method

/** First day (1 April) of the Indian financial year that contains `date`. */
export function fyStartOf(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return `${m >= 4 ? y : y - 1}-04-01`;
}

export const isFyStart = (date: string) => /^\d{4}-04-01$/.test(date);

/** The method in force on `date`: the last change whose `from` is on or before it, else weighted average. */
export function methodAt(history: readonly Pick<ValuationMethodChange, "method" | "from">[], date: string): ValuationMethod {
  let m: ValuationMethod = "average";
  for (const h of [...history].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))) if (h.from <= date) m = h.method;
  return m;
}

/**
 * Why a switch to `method` from `from` is not allowed, or null. Rules: only from the start of a financial year
 * (1 April); not into a period the books have locked (the year must start after the lock); not before the last
 * switch; at most the next financial year; and it must change something.
 */
export function switchProblem(p: { method: ValuationMethod; from: string; today: string; lockedThrough: string | null; history: readonly Pick<ValuationMethodChange, "method" | "from">[] }): string | null {
  if (!isFyStart(p.from)) return "A new valuation method can only start on 1 April (the start of a financial year)";
  if (p.lockedThrough && p.from <= p.lockedThrough) return `The books are locked up to ${p.lockedThrough}; pick a financial year that starts after the lock, or unlock first`;
  const next = `${Number(fyStartOf(p.today).slice(0, 4)) + 1}-04-01`;
  if (p.from > next) return `Pick this financial year or the next one (from ${next} at the latest)`;
  const last = [...p.history].sort((a, b) => (a.from < b.from ? -1 : 1)).at(-1);
  if (last && p.from < last.from) return `The method was already changed from ${last.from}; a change can't start before that`;
  if (methodAt(p.history, p.from) === p.method && !(last && last.from === p.from)) return "That is already the method for that year";
  return null;
}

// ------------------------------------------------------------------ landed charges

export interface ChargeLine {
  /** Taxable value of the line (before charges). */
  taxable: number;
  /** Base-unit quantity, milli. */
  milli: number;
  /** Grams per base unit, when the item has a weight. */
  weightGrams: number | null;
}

/** What a charge adds to the cost of the goods: the amount, plus its GST when that can't be claimed. */
export const chargeCost = (c: Pick<PurchaseCharge, "amount" | "gst" | "claimable">) => c.amount + (c.claimable ? 0 : c.gst);

/** Weights of the lines for a basis; `weight` falls back to value when no line has a weight. */
export function basisWeights(lines: readonly ChargeLine[], basis: ChargeBasis): number[] {
  if (basis === "qty") return lines.map((l) => l.milli);
  if (basis === "weight") {
    const w = lines.map((l) => (l.weightGrams && l.weightGrams > 0 ? l.milli * l.weightGrams : 0));
    if (w.some((x) => x > 0)) return w;
  }
  return lines.map((l) => l.taxable);
}

/** Paise of landed cost per line: every charge spread on its own basis, the old freight / other charges by value. */
export function allocateCharges(lines: readonly ChargeLine[], charges: readonly Pick<PurchaseCharge, "amount" | "gst" | "claimable" | "basis">[], legacy = 0): number[] {
  const out = lines.map(() => 0);
  const add = (shares: number[]) => shares.forEach((s, i) => (out[i] = (out[i] ?? 0) + s));
  if (legacy > 0) add(apportion(legacy, basisWeights(lines, "value")));
  for (const c of charges) add(apportion(chargeCost(c), basisWeights(lines, c.basis)));
  return out;
}

/**
 * Splits a later landed cost between goods still in stock and goods already gone, per line: `share` spread by the
 * basis over what the purchase brought in, then `toStock = share x remaining / qty`.
 */
export function splitLanded(total: number, lines: readonly (ChargeLine & { remainingMilli: number })[], basis: ChargeBasis): { share: number; toStock: number; toSold: number }[] {
  const shares = apportion(total, basisWeights(lines, basis));
  return lines.map((l, i) => {
    const share = shares[i] ?? 0;
    const toStock = l.milli > 0 ? Math.round((share * Math.min(l.remainingMilli, l.milli)) / l.milli) : 0;
    return { share, toStock, toSold: share - toStock };
  });
}

// ------------------------------------------------------------------ history replay

export interface ReplayMovement {
  id: string;
  itemId: string;
  locationId: string;
  deltaMilli: number;
  reason: string;
  refType: string | null;
  refId: string | null;
  unitCost: number | null;
  at: number;
}

export interface ReplayBatchMove {
  refType: string | null;
  refId: string | null;
  itemId: string;
  locationId: string;
  batchId: string;
  deltaMilli: number;
  reason: string;
}

export interface ReplayLayer {
  id: string;
  itemId: string;
  locationId: string;
  batchId: string | null;
  movementId: string;
  refType: string | null;
  refId: string | null;
  at: number;
  seq: number;
  milli: number;
  value: number;
  remainingMilli: number;
  remainingValue: number;
}

export interface ReplayDraw {
  layerId: string | null;
  movementId: string;
  itemId: string;
  locationId: string;
  kind: "out" | "short";
  milli: number;
  value: number;
  at: number;
}

export interface ReplayResult {
  layers: ReplayLayer[];
  draws: ReplayDraw[];
  costs: Map<string, { costAvg: number; costFifo: number }>;
}

/** Outgoing reasons whose goods may come back on another movement (the counterpart of a return / reversal). */
const counterpartRef = (m: Pick<ReplayMovement, "reason" | "refType" | "refId">, returnSale: ReadonlyMap<string, string>): string | null => {
  if (m.reason === "sale_return" && m.refId) {
    const inv = returnSale.get(m.refId);
    return inv ? `invoice:${inv}` : null;
  }
  return refKeyOf(m.refType, m.refId);
};

/**
 * Builds the FIFO layers, draws and both costs of every movement of a shop from its stock history, the way `change()`
 * would have recorded them (the weighted average is re-run with the same rule; the shop's stored average is not touched).
 * `returnSale` maps a credit note id to its bill id. `newId` makes layer ids.
 */
export function replayHistory(movements: readonly ReplayMovement[], batchMoves: readonly ReplayBatchMove[], returnSale: ReadonlyMap<string, string>, newId: () => string): ReplayResult {
  const layers: ReplayLayer[] = [];
  const draws: ReplayDraw[] = [];
  const costs = new Map<string, { costAvg: number; costFifo: number }>();
  const open = new Map<string, ReplayLayer[]>();
  const state = new Map<string, { milli: number; avg: number | null }>();
  const outs = new Map<string, { milli: number; avg: number; fifo: number }>();
  const batchIn = new Map<string, { batchId: string; milli: number }[]>();
  const batchOut = new Map<string, { batchId: string; milli: number }[]>();
  for (const b of batchMoves) {
    if (b.reason === "assign") continue;
    const k = `${b.refType}:${b.refId}|${b.itemId}|${b.locationId}`;
    const target = b.deltaMilli > 0 ? batchIn : batchOut;
    const list = target.get(k) ?? [];
    const cur = list.find((x) => x.batchId === b.batchId);
    if (cur) cur.milli += Math.abs(b.deltaMilli);
    else list.push({ batchId: b.batchId, milli: Math.abs(b.deltaMilli) });
    target.set(k, list);
  }
  let seq = 0;
  const sorted = [...movements].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const m of sorted) {
    const key = `${m.itemId}|${m.locationId}`;
    const st = state.get(key) ?? { milli: 0, avg: null };
    const list = open.get(key) ?? [];
    const bkey = `${m.refType}:${m.refId}|${m.itemId}|${m.locationId}`;
    if (m.deltaMilli > 0) {
      const cpKey = counterpartRef(m, returnSale);
      const cp = cpKey ? (outs.get(`${cpKey}|${m.itemId}`) ?? null) : null;
      const inc = incomingCost({ deltaMilli: m.deltaMilli, beforeMilli: st.milli, unitCost: m.unitCost, avgBefore: st.avg, counterpart: cp });
      costs.set(m.id, { costAvg: inc.costAvg, costFifo: inc.costFifo });
      if (inc.layerMilli > 0) {
        // Split into the batches the goods went into, the rest unbatched.
        const parts: { batchId: string | null; milli: number }[] = [];
        let rest = inc.layerMilli;
        for (const b of batchIn.get(bkey) ?? []) {
          const q = Math.min(b.milli, rest);
          if (q <= 0) continue;
          parts.push({ batchId: b.batchId, milli: q });
          b.milli -= q;
          rest -= q;
        }
        if (rest > 0) parts.push({ batchId: null, milli: rest });
        const values = apportion(inc.layerValue, parts.map((x) => x.milli));
        parts.forEach((x, i) => {
          const layer: ReplayLayer = {
            id: newId(),
            itemId: m.itemId,
            locationId: m.locationId,
            batchId: x.batchId,
            movementId: m.id,
            refType: m.refType,
            refId: m.refId,
            at: m.at,
            seq: seq++,
            milli: x.milli,
            value: inc.layerValue > 0 ? (values[i] ?? 0) : 0,
            remainingMilli: x.milli,
            remainingValue: inc.layerValue > 0 ? (values[i] ?? 0) : 0,
          };
          layers.push(layer);
          list.push(layer);
        });
      }
      if (m.unitCost !== null) st.avg = movingAverageCost(st.milli, st.avg, m.deltaMilli, m.unitCost);
    } else if (m.deltaMilli < 0) {
      const milli = -m.deltaMilli;
      const view: OpenLayer[] = list.map((l) => ({ id: l.id, at: l.at, seq: l.seq, batchId: l.batchId, refKey: refKeyOf(l.refType, l.refId), milli: l.remainingMilli, value: l.remainingValue }));
      const plan = planDraw(view, milli, { refKeys: refKeyOf(m.refType, m.refId) ? [refKeyOf(m.refType, m.refId)!] : [], batches: batchOut.get(bkey) ?? [] });
      const out = outgoingCost(milli, st.avg, plan, list.at(-1) ? unitOf(list.at(-1)!.value, list.at(-1)!.milli) : null);
      for (const p of plan.parts) {
        const l = list.find((x) => x.id === p.layerId)!;
        l.remainingMilli -= p.milli;
        l.remainingValue -= p.value;
        draws.push({ layerId: l.id, movementId: m.id, itemId: m.itemId, locationId: m.locationId, kind: "out", milli: p.milli, value: p.value, at: m.at });
      }
      if (plan.shortMilli > 0) draws.push({ layerId: null, movementId: m.id, itemId: m.itemId, locationId: m.locationId, kind: "short", milli: plan.shortMilli, value: out.shortValue, at: m.at });
      costs.set(m.id, { costAvg: out.costAvg, costFifo: out.costFifo });
      const ok = refKeyOf(m.refType, m.refId);
      if (ok) {
        const o = outs.get(`${ok}|${m.itemId}`) ?? { milli: 0, avg: 0, fifo: 0 };
        o.milli += milli;
        o.avg += -out.costAvg;
        o.fifo += -out.costFifo;
        outs.set(`${ok}|${m.itemId}`, o);
      }
      open.set(key, list.filter((l) => l.remainingMilli > 0));
    } else {
      costs.set(m.id, { costAvg: 0, costFifo: 0 });
    }
    st.milli += m.deltaMilli;
    state.set(key, st);
    if (!open.has(key)) open.set(key, list);
  }
  return { layers, draws, costs };
}

/** FIFO value as of a moment from layers and draws: what came in by then less what was drawn by then. */
export function fifoValueAsOf(layers: readonly { at: number; value: number }[], draws: readonly { at: number; value: number; layerId: string | null }[], cutoff: number): number {
  let v = 0;
  for (const l of layers) if (l.at <= cutoff) v += l.value;
  for (const d of draws) if (d.layerId && d.at <= cutoff) v -= d.value;
  return v;
}

export type { ValuationMethod };
