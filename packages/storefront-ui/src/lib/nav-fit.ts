import type { MenuItem } from "../types";

/**
 * How many desktop menu items fit in `available` px after the `lead` (the "Shop" mega-menu button), keeping room for
 * a "More" button when some don't. `gap` is the space between items. All of them fit → items.length.
 */
export function navFitCount(available: number, lead: number, items: readonly number[], more: number, gap = 0): number {
  const width = (n: number) => items.slice(0, n).reduce((s, w) => s + w, 0) + gap * Math.max(0, n + (lead > 0 ? 1 : 0) - 1);
  if (lead + width(items.length) <= available) return items.length;
  let n = items.length;
  while (n > 0 && lead + width(n) + gap + more > available) n--;
  return n;
}

/**
 * True when not even the lead and a "More" button fit (a long Tamil "Shop" + "More" beside the search box at 1024 px):
 * then the lead folds into "More" as well, instead of the row running under the search box. Nothing to fold (all items
 * fit with the lead, or there is no lead) → false.
 */
export function navLeadFolds(available: number, lead: number, items: readonly number[], more: number, gap = 0): boolean {
  if (lead <= 0) return false;
  if (navFitCount(available, lead, items, more, gap) === items.length) return false;
  return lead + gap + more > available;
}

/**
 * The "More" dropdown's links, one per overflowed item so the list stays short: an item with its own page links there
 * (its sub-links live on that page); a group without one lists its children.
 */
export function overflowLinks(items: readonly MenuItem[]): MenuItem[] {
  return items.flatMap((m) => (m.href ? [{ label: m.label, type: m.type, href: m.href }] : (m.children ?? []).filter((c) => !!c.href)));
}
