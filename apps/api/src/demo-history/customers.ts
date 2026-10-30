import { gstinCheckChar } from "@rbms/gst";
import { addressFor, testPhone, uniqueNames } from "./names";
import type { Profile } from "./profiles";
import { createRng, hashSeed } from "./rng";

/**
 * The shop's regular named customers, planned (not yet created). The same slug always gives the same people, phones and
 * credit limits, so a re-run recognises them by phone.
 */
export interface PlannedCustomer {
  name: string;
  phone: string;
  address: string;
  /** A business customer's GSTIN (valid format and check character), else null. */
  gstin: string | null;
  /** Paise; null = pays at once (no credit). */
  creditLimit: number | null;
  /** How a credit customer settles: regularly, late (weeks), or hardly ever. */
  payer: "regular" | "late" | "slow";
  /** How often this customer comes, relative to others. */
  visits: number;
}

const BUSINESS_A = ["Sri Vinayaga", "Annai", "Murugan", "Lakshmi", "Kaveri", "Pandian", "Thendral", "Sri Balaji", "Meenakshi", "Arasan"];
const BUSINESS_B = ["Mess", "Tiffin Centre", "Caterers", "Hotel", "Bakery", "Traders", "Stores", "Enterprises"];
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/** A GSTIN for Tamil Nadu (state 33) that passes the format and check-character test. */
export function fakeGstin(rng: ReturnType<typeof createRng>): string {
  const pan = Array.from({ length: 3 }, () => rng.pick([...LETTERS])).join("") + rng.pick(["C", "F", "P", "H"]) + rng.pick([...LETTERS]);
  const first14 = `33${pan}${String(rng.int(1000, 9999))}${rng.pick([...LETTERS])}${rng.int(1, 9)}Z`;
  return first14 + gstinCheckChar(first14);
}

export function planCustomers(profile: Profile, slug: string, city?: string): PlannedCustomer[] {
  const rng = createRng(`${slug}:customers`);
  const c = profile.customers;
  const names = uniqueNames(rng, c.count);
  // Phone numbers are unique within a shop; the offset keeps shops from sharing a block.
  const offset = hashSeed(slug) % 5000;
  const order = rng.shuffle(Array.from({ length: c.count }, (_, i) => i));
  const creditIdx = new Set(order.slice(0, Math.round(c.count * c.creditShare)));
  const b2bIdx = new Set(order.slice(-Math.round(c.count * c.b2bShare)));
  return names.map((n, i) => {
    const b2b = b2bIdx.has(i) && c.b2bShare > 0;
    const credit = (creditIdx.has(i) || b2b) && c.creditLimit[1] > 0;
    const r = rng.next();
    return {
      name: b2b ? `${rng.pick(c.businessNames?.a ?? BUSINESS_A)} ${rng.pick(c.businessNames?.b ?? BUSINESS_B)}` : n.name,
      phone: testPhone((offset + i * 7) % 10_000),
      address: addressFor(rng, city),
      gstin: b2b ? fakeGstin(rng) : null,
      creditLimit: credit ? Math.round(rng.float(c.creditLimit[0], c.creditLimit[1]) / 50_00) * 50_00 : null,
      payer: b2b ? "late" : r < 0.55 ? "regular" : r < 0.82 ? "late" : "slow",
      visits: (0.4 + rng.next() * 1.6) * (b2b ? 1.8 : 1),
    };
  });
}

/** How much of a bill a customer can put on the book without passing the limit (the rest is paid at the counter). */
export function creditBalanceAfter(c: { balance: number; limit: number | null }, total: number): { onCredit: number; balance: number } {
  if (c.limit === null) return { onCredit: 0, balance: c.balance };
  const room = Math.max(c.limit - c.balance, 0);
  const onCredit = Math.min(total, room);
  return { onCredit, balance: c.balance + onCredit };
}

/** Chance a customer with dues settles on a given day, by habit. */
export function repayChance(base: number, payer: PlannedCustomer["payer"]): number {
  return payer === "regular" ? base * 1.4 : payer === "late" ? base * 0.55 : base * 0.02;
}
