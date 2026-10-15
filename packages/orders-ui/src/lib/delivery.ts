// Pure delivery helpers for the settings screens: rate summaries and weight-slab editing. Unit-tested.
import { formatGrams, money, rupeesToPaise } from "./format";
import type { Rate, WeightSlab } from "./types";

export const PINCODE_RE = /^[1-9]\d{5}$/;
export const PREFIX_RE = /^[1-9]\d{0,4}$/;

/** "₹60 flat" / "₹40 up to 500 g, ₹80 up to 2 kg" / "₹50 · free above ₹999" (language-neutral pieces for the UI). */
export function rateSummary(r: Pick<Rate, "type" | "amount" | "freeAbove" | "weightSlabs">): { amount: string; slabs: { upTo: string; amount: string }[]; freeAbove: string | null } {
  return {
    amount: money(r.amount),
    slabs: r.type === "weight" ? [...r.weightSlabs].sort((a, b) => a.upToGrams - b.upToGrams).map((s) => ({ upTo: formatGrams(s.upToGrams), amount: money(s.amount) })) : [],
    freeAbove: r.freeAbove !== null && r.freeAbove !== undefined ? money(r.freeAbove) : null,
  };
}

/** Editable slab rows (strings) → API slabs. Invalid rows → null with the row index. */
export function parseSlabs(rows: { upToGrams: string; amount: string }[]): { ok: true; slabs: WeightSlab[] } | { ok: false; row: number } {
  const out: WeightSlab[] = [];
  for (let i = 0; i < rows.length; i++) {
    const g = Number(rows[i]!.upToGrams);
    const a = rupeesToPaise(rows[i]!.amount);
    if (!Number.isInteger(g) || g < 1 || a === null) return { ok: false, row: i };
    out.push({ upToGrams: g, amount: a });
  }
  const sorted = out.sort((a, b) => a.upToGrams - b.upToGrams);
  for (let i = 1; i < sorted.length; i++) if (sorted[i]!.upToGrams === sorted[i - 1]!.upToGrams) return { ok: false, row: i };
  return { ok: true, slabs: sorted };
}

/**
 * The charge a weight-slab rate gives for `grams`: the first slab that covers it. Heavier than the last slab → null
 * (the rate isn't offered, same as the server).
 */
export function slabAmount(slabs: readonly WeightSlab[], grams: number): number | null {
  const w = Math.max(0, Math.ceil(grams || 0));
  const slab = [...slabs].sort((a, b) => a.upToGrams - b.upToGrams).find((s) => w <= s.upToGrams);
  return slab ? slab.amount : null;
}
