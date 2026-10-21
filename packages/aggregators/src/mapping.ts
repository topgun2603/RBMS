import type { NormalizedItem } from "./types";

/** An incoming order line with our catalogue item, when we know it. */
export interface MappedLine {
  externalId: string;
  title: string;
  qty: number;
  /** Paise per unit as the platform charged it (options included). */
  unitPrice: number;
  total: number;
  /** Our catalogue variant id; null = not mapped (the kitchen still sees the line by its platform name). */
  itemId: string | null;
  /** How it was matched: an explicit mapping, or the ref we pushed with the menu (our own id). */
  via: "mapping" | "ref" | null;
  /** Options, left-outs and the customer's note, as one KOT note. */
  note: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string | null | undefined): v is string => !!v && UUID.test(v);

/** "+ Extra cheese · − Onion · less spicy" (options with qty > 1 as "2× Extra cheese"). */
export function lineNote(i: Pick<NormalizedItem, "options" | "removed" | "note">): string | null {
  const parts = [
    ...i.options.map((o) => `+ ${o.qty > 1 ? `${o.qty}× ` : ""}${o.title}`),
    ...i.removed.map((r) => `− ${r}`),
    ...(i.note ? [i.note] : []),
  ];
  const s = parts.join(" · ");
  return s ? (s.length > 200 ? `${s.slice(0, 199)}…` : s) : null;
}

/** Catalogue ids an order may refer to directly (pushed menus use our variant ids as refs). */
export function candidateIds(items: NormalizedItem[]): string[] {
  return [...new Set(items.flatMap((i) => [i.merchantRef, i.externalId]).filter(isUuid))];
}

/**
 * Matches each line: an explicit mapping of the platform item id (or its merchant ref) first, then the merchant ref /
 * item id itself when it is one of our catalogue ids (`known`). Anything else stays unmapped and is flagged.
 */
export function resolveLines(items: NormalizedItem[], mappings: ReadonlyMap<string, string>, known: ReadonlySet<string>): MappedLine[] {
  return items.map((i) => {
    const explicit = mappings.get(i.externalId) ?? (i.merchantRef ? mappings.get(i.merchantRef) : undefined);
    const direct = [i.merchantRef, i.externalId].find((v) => isUuid(v) && known.has(v)) ?? null;
    const itemId = explicit ?? direct;
    return {
      externalId: i.externalId,
      title: i.title,
      qty: i.qty,
      unitPrice: i.unitPrice,
      total: i.total,
      itemId,
      via: explicit ? "mapping" : direct ? "ref" : null,
      note: lineNote(i),
    };
  });
}
