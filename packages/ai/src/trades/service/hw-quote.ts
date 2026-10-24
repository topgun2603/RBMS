import { z } from "zod";
import type { AiRunner } from "../../assist/hsn";
import { DATA_RULES, dataBlock, neutralise, outputLooksInjected, sentences } from "../../assist/safety";
import type { AiSchema, AiTool } from "../../types";
import { hasPriceOrPromise } from "./fault";

/**
 * Phase 3 part C, hardware / building materials: "build a quotation from a description" ("2-bedroom house, 900 sq ft, plumbing
 * and electricals"). The standard tier proposes material lines and quantities using ONLY items it found through a catalogue
 * search tool; every line is checked in code against the ids the tool really returned, prices and GST come from the item and
 * never from the model, and what the shop does not stock is listed apart as "not in your catalogue". The result is a draft for
 * the owner to edit and save as a draft quotation; quantities are rough estimates and the text says so. No structural or
 * engineering advice.
 */
export const HW_QUOTE_FEATURE = "hardware-quote";
export const HW_QUOTE_CREDITS_HINT = 60;

export interface CatalogueItem {
  id: string;
  name: string;
  /** Paise before GST. */
  rate: number;
  gstRate: number;
  unit: string;
  hsn?: string | null;
  stockQty?: number | null;
}
export interface QuotePorts {
  /** The shop's own catalogue search. Read-only. */
  search(q: string, limit: number): Promise<CatalogueItem[]>;
}

export const HW_QUOTE_SYSTEM = [
  "You help a hardware and building-materials shop in India prepare a material list for a quotation from a customer's short description of the job (for example a small house, plumbing, electrical wiring, painting, a bathroom, a compound wall). The description may be in Tamil, Tanglish or English.",
  "You may only propose items the shop actually sells. Find them with the search_catalogue tool (search in English words: category, material, size; try 2 to 4 searches covering different materials, never more than 8 in all). For every line you propose, copy the itemId exactly from a search result; never invent an id, name or size. Pick the closest item in the right size and type. If the shop has nothing suitable, put the need in notInCatalogue instead of guessing.",
  "Quantities are rough planning estimates from common rules of thumb for the stated area or scope, expressed in the item's own unit. Never write prices, totals, rupee amounts, brand promises, delivery or warranty. Give no structural or engineering advice (no foundation, beam, column, load, slab thickness or safety statements); if asked for design, say only that an engineer must decide and keep to a plain material list. Keep to materials, not labour.",
  "assumptions = up to 6 short statements of what you assumed (area, number of points, fixtures, brand-free), so the owner can check the quantities; writtenIn follows the requested language (en or ta). Lines: at most 25.",
  DATA_RULES,
].join("\n");

const HwRaw = z.object({
  assumptions: z.array(z.string()).max(10).catch([]),
  lines: z.array(z.object({ itemId: z.string(), qty: z.number().catch(0), why: z.string().catch("") })).max(40).catch([]),
  notInCatalogue: z.array(z.object({ need: z.string(), qty: z.string().catch("") })).max(15).catch([]),
});
export type HwRawOut = z.infer<typeof HwRaw>;
export const HW_QUOTE_SCHEMA: AiSchema<HwRawOut> = {
  name: "hardware_quote",
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["assumptions", "lines", "notInCatalogue"],
    properties: {
      assumptions: { type: "array", items: { type: "string" } },
      lines: {
        type: "array",
        items: { type: "object", additionalProperties: false, required: ["itemId", "qty", "why"], properties: { itemId: { type: "string" }, qty: { type: "number" }, why: { type: "string" } } },
      },
      notInCatalogue: {
        type: "array",
        items: { type: "object", additionalProperties: false, required: ["need", "qty"], properties: { need: { type: "string" }, qty: { type: "string" } } },
      },
    },
  },
  zod: HwRaw as unknown as z.ZodType<HwRawOut>,
};

export interface QuoteLine {
  itemId: string;
  name: string;
  qty: number;
  unit: string;
  /** Paise before GST, from the item. */
  rate: number;
  gstRate: number;
  hsn: string | null;
  /** Paise before GST: qty x rate, computed here. */
  amount: number;
  why: string;
  stockQty: number | null;
}
export interface QuoteDraft {
  lines: QuoteLine[];
  notInCatalogue: { need: string; qty: string }[];
  assumptions: string[];
  /** Paise before GST and with GST, from the lines. */
  subtotal: number;
  total: number;
  /** Model lines dropped because the id was not found in this shop's catalogue search. */
  dropped: number;
  suspicious: boolean;
}

/** Quantity rules: positive, limited, whole numbers for pieces. */
export const MAX_QTY = 100_000;
const WHOLE_UNITS = /^(pcs?|nos?|no|numbers?|pieces?|units?|bags?|sets?|each|ea|rolls?|boxes|box|pkts?|packets?|bundles?|sheets?|tins?|cans?|bottles?|buckets?|ltr|litres?|liters?|l)$/i;

export function normaliseQty(qty: number, unit: string): number | null {
  if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY) return null;
  if (WHOLE_UNITS.test(unit.trim())) return Math.max(1, Math.ceil(qty - 1e-9));
  return Math.round(qty * 100) / 100;
}

const ENGINEERING = /(structur|load[- ]?bearing|\bbeam\b|\bcolumn\b|foundation|\bslab thickness|safe(?:ty)?\b|\bfactor of safety|rebar design|seismic|\bengineer(?:ed)? approved|IS ?\d{3,}|கட்டமைப்பு|பாதுகாப்பான)/i;
export const QUOTE_DISCLAIMER = {
  en: "These are rough material estimates from your description, not a design or an engineer's bill of quantities. Check every quantity before quoting. Prices are your catalogue prices.",
  ta: "இவை உங்கள் விவரத்தின் அடிப்படையிலான தோராயமான பொருள் மதிப்பீடுகள்; வடிவமைப்பு அல்லது பொறியாளரின் அளவு பட்டியல் அல்ல. விலை கொடுப்பதற்கு முன் ஒவ்வொரு அளவையும் சரிபாருங்கள். விலைகள் உங்கள் பட்டியல் விலைகள்.",
} as const;

/** Builds the draft from the model's output and the ids the search tool really returned. Pure. */
export function buildQuote(raw: HwRawOut, seen: Map<string, CatalogueItem>, payloads: string[] = []): QuoteDraft {
  const injected = outputLooksInjected(raw, payloads);
  const byId = new Map<string, QuoteLine>();
  let dropped = 0;
  for (const l of injected ? [] : raw.lines) {
    const item = seen.get(l.itemId.trim());
    const qty = item ? normaliseQty(l.qty, item.unit) : null;
    if (!item || qty === null) {
      dropped++;
      continue;
    }
    const prior = byId.get(item.id);
    const total = (prior?.qty ?? 0) + qty;
    const why = neutralise(l.why).suspicious || hasPriceOrPromise(l.why) || ENGINEERING.test(l.why) ? "" : l.why.replace(/\s+/g, " ").trim().slice(0, 140);
    byId.set(item.id, {
      itemId: item.id,
      name: item.name,
      qty: Math.min(total, MAX_QTY),
      unit: item.unit,
      rate: item.rate,
      gstRate: item.gstRate,
      hsn: item.hsn ?? null,
      amount: Math.round(Math.min(total, MAX_QTY) * item.rate),
      why: why || prior?.why || "",
      stockQty: item.stockQty ?? null,
    });
  }
  const lines = [...byId.values()];
  const clean = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);
  const assumptions = (injected ? [] : raw.assumptions)
    .flatMap((a) => sentences(a))
    .map((s) => clean(s, 200))
    .filter((s) => s && !hasPriceOrPromise(s) && !ENGINEERING.test(s) && !neutralise(s).suspicious)
    .slice(0, 6);
  const notInCatalogue = (injected ? [] : raw.notInCatalogue)
    .map((n) => ({ need: clean(n.need, 80), qty: clean(n.qty, 40) }))
    .filter((n) => n.need && !neutralise(n.need).suspicious && !hasPriceOrPromise(n.need) && !hasPriceOrPromise(n.qty))
    .slice(0, 10);
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const total = lines.reduce((s, l) => s + Math.round(l.amount * (1 + l.gstRate / 100)), 0);
  return { lines, notInCatalogue, assumptions, subtotal, total, dropped, suspicious: injected };
}

/** The read-only search tool the model uses. `seen` collects every item the tool returned (the only ids a line may carry). */
export function catalogueTool(ports: QuotePorts, seen: Map<string, CatalogueItem>): AiTool {
  return {
    name: "search_catalogue",
    description: "Search this shop's own item catalogue by words (material, category, size). Returns up to 12 items with id, name and unit. Use English words.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Search words, 1 to 4 words, e.g. 'cement' or 'CPVC pipe 1/2'" } }, required: ["query"], additionalProperties: false } as AiTool["inputSchema"],
    async run(input) {
      const q = String(input.query ?? "").replace(/[^\p{L}\p{N}\s./"'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
      if (!q) return { items: [], note: "Give some words to search." };
      const items = await ports.search(q, 12);
      for (const i of items) seen.set(i.id, i);
      return { items: items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, inStock: i.stockQty === null || i.stockQty === undefined ? undefined : i.stockQty > 0 })) };
    },
  };
}

export async function draftHardwareQuote(
  ai: AiRunner,
  ports: QuotePorts,
  req: { tenantId: string; userId?: string | null; description: string; language: "en" | "ta" },
): Promise<{ draft: QuoteDraft; runId: string; credits: number; provider: "claude" | "mock" }> {
  const n = neutralise(req.description);
  const seen = new Map<string, CatalogueItem>();
  const r = await ai.run({
    tenantId: req.tenantId,
    userId: req.userId ?? null,
    feature: HW_QUOTE_FEATURE,
    tier: "standard",
    system: HW_QUOTE_SYSTEM,
    input: { text: [dataBlock("job description", n.text || req.description.slice(0, 300)), `writtenIn: ${req.language}`].join("\n") },
    schema: HW_QUOTE_SCHEMA,
    tools: [catalogueTool(ports, seen)],
    maxSteps: 10,
    maxTokens: 8000,
    effort: "low",
  });
  const draft = buildQuote(r.output, seen, n.payloads);
  return { draft: { ...draft, suspicious: draft.suspicious || n.suspicious }, runId: r.runId, credits: r.credits, provider: r.provider };
}
