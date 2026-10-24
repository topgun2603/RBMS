import type { OfflineStore } from "./store";
import type { CachedCustomer } from "./types";
import type { Customer } from "../types";

/**
 * Customers remembered for offline lookups: every customer the counter has seen in an online search or picked is kept
 * (latest 500). Offline, the search runs over this list; a customer who isn't in it is billed as a walk-in with the
 * captured mobile number.
 */

let cache: OfflineStore | null = null;

/** Set by the offline provider once the store is open. */
export function setCustomerCache(store: OfflineStore | null) {
  cache = store;
}

export function rememberCustomers(customers: readonly Customer[], now = Date.now()): void {
  if (!cache || !customers.length) return;
  void cache
    .putCustomers(customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email, gstin: c.gstin, stateCode: c.stateCode, creditLimit: c.creditLimit, outstanding: c.outstanding, advance: c.advance, seenAt: now })))
    .catch(() => undefined);
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const digitsOf = (s: string) => s.replace(/\D/g, "");

/** Name or mobile contains the query (digits match anywhere in the number). */
export function matchCustomers(all: readonly CachedCustomer[], q: string, limit = 6): Customer[] {
  const text = norm(q.trim());
  const digits = digitsOf(q);
  if (!text) return [];
  const hits = all.filter((c) => norm(c.name).includes(text) || (digits.length >= 3 && !!c.phone && digitsOf(c.phone).includes(digits)));
  return hits.slice(0, limit).map(({ seenAt: _s, ...c }) => c);
}

export async function searchCachedCustomers(q: string, limit = 6): Promise<Customer[]> {
  if (!cache) return [];
  return matchCustomers(await cache.listCustomers().catch(() => []), q, limit);
}
