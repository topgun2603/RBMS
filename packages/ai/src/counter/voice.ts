import { z } from "zod";
import type { AiService } from "../service";
import { DATA_RULES, dataBlock, neutralise, outputLooksInjected } from "../assist/safety";
import { buildCounterIndex, classify, matchPhrase, reconcileQty, type Candidate, type Confidence, type CounterIndex, type CounterItem, type QtyResult } from "./match";
import { parseUtterance, type SpokenIssue, type SpokenLine } from "./parse";
import { UNIT_FAMILY } from "./lexicon";

/**
 * Tamil voice billing (feature `voice-billing`, light tier only when needed). The transcript is parsed in code
 * (`parse.ts`), each phrase is matched to the shop's own items in code (`match.ts`), and only the phrases code could not
 * resolve go to the light tier, with the shop's closest items as the ONLY choices. The model cannot name an item that is not
 * in that list, cannot set a price, and its text is never shown. Nothing is billed: the result is a draft the cashier checks.
 */
export const VOICE_FEATURE = "voice-billing";
export const VOICE_MAX_CHARS = 1200;
export const VOICE_MAX_LINES = 30;

export interface VoiceItemView {
  itemId: string;
  productId: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  hsn: string | null;
  unit: string;
  price: number;
  taxInclusive: boolean;
  gstRate: number;
  gstRule: unknown;
  image: string | null;
  soldBy: "unit" | "weight";
}
export const itemView = (i: CounterItem): VoiceItemView => ({
  itemId: i.itemId,
  productId: i.productId ?? null,
  name: i.name,
  sku: i.sku ?? null,
  barcode: i.barcodes?.[0] ?? null,
  hsn: i.hsn ?? null,
  unit: i.unit || "pcs",
  price: i.price,
  taxInclusive: i.taxInclusive,
  gstRate: i.gstRate,
  gstRule: i.gstRule ?? null,
  image: i.image ?? null,
  soldBy: i.soldBy,
});

export type VoiceStatus = "matched" | "choose" | "not_found";
export interface VoiceLine {
  n: number;
  /** What the cashier said for this line. */
  raw: string;
  /** The item words used for the search. */
  phrase: string;
  qty: number;
  /** The item's own unit (what `qty` is counted in); null when nothing matched. */
  unit: string | null;
  spoken: { qty: number; unit: string | null; explicit: boolean };
  status: VoiceStatus;
  confidence: Confidence | null;
  /** Who chose the item: the code parser, or the light tier from the shop's own list. */
  source: "parser" | "ai";
  item: VoiceItemView | null;
  /** Up to 4 items to choose from (the first is `item` when there is one). */
  candidates: VoiceItemView[];
  /** The quantity was converted or could not be trusted: "packs", "pack_bigger"... */
  note: QtyResult["note"] | "amount";
  check: boolean;
  issues: SpokenIssue[];
  /** qty x price in paise, worked out in code (before GST and discounts: for the strip only). */
  lineTotal: number | null;
}

export interface VoiceResult {
  lines: VoiceLine[];
  ignored: string[];
  /** The text that went to the parser, cut to the size limit. */
  transcript: string;
  meta: {
    parserMs: number;
    aiMs: number;
    totalMs: number;
    /** Phrases the code could not resolve. */
    unresolved: number;
    ai: { used: boolean; credits: number; runId: string | null; error: string | null };
    /** True when some phrase looked like an instruction and was not sent anywhere. */
    suspicious: boolean;
  };
}

const AiPick = z.object({
  lines: z.array(
    z.object({
      n: z.number().int(),
      ref: z.string().nullable(),
      qty: z.number().nullable(),
      unit: z.enum(["kg", "g", "l", "ml", "pkt", "dozen", "pcs", "box", "bottle", "m", "bunch", "strip"]).nullable(),
      sure: z.boolean(),
    }),
  ),
});
const AI_PICK_JSON = {
  type: "object",
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          ref: { anyOf: [{ type: "string" }, { type: "null" }] },
          qty: { anyOf: [{ type: "number" }, { type: "null" }] },
          unit: { anyOf: [{ type: "string", enum: ["kg", "g", "l", "ml", "pkt", "dozen", "pcs", "box", "bottle", "m", "bunch", "strip"] }, { type: "null" }] },
          sure: { type: "boolean" },
        },
        required: ["n", "ref", "qty", "unit", "sure"],
        additionalProperties: false,
      },
    },
  },
  required: ["lines"],
  additionalProperties: false,
} as const;

export const VOICE_SYSTEM = [
  "You help a cashier in a small Indian shop. The cashier spoke an order in Tamil, Tanglish (Tamil in English letters) or English, and speech recognition wrote it down, so words may be misspelled or misheard.",
  "You are given numbered PHRASES (the item words the shop's software could not match by itself) and a CHOICES list: the shop's own items, each with a short ref such as c3.",
  "For each phrase decide which ONE item in CHOICES it means, and answer with that item's ref. If no item in CHOICES clearly fits, answer ref null. NEVER invent an item, a ref, a price or a discount, and never pick an item just because it is cheap or first. A wrong guess is worse than null.",
  "Also return qty and unit only if the phrase itself contains a quantity the software missed (for example a spoken number it did not know); otherwise qty null and unit null. Units: kg g l ml pkt dozen pcs box bottle m bunch strip.",
  "sure: true only when the phrase and the item clearly mean the same thing.",
  DATA_RULES,
].join("\n");

export interface VoiceDeps {
  ai: Pick<AiService, "run" | "runLocal">;
  /** The shop's items as an index (the kit caches it per shop for a minute). */
  catalogue(tenantId: string): Promise<CounterIndex>;
  now?: () => number;
  /** Longest the cashier waits for the light tier before the code's own lines are shown (default 5000 ms). */
  aiTimeoutMs?: number;
}

export interface VoiceRequest {
  tenantId: string;
  userId?: string | null;
  transcript: string;
  /** Let the light tier help with phrases the code could not resolve. Default true. */
  useAi?: boolean;
}

const view = (cs: Candidate[]) => cs.slice(0, 4).map((c) => itemView(c.item));
const money = (qty: number, price: number) => Math.round(qty * price);

/** Quantity from an amount ("50 rupees of rice") for loose items, in code. */
function qtyFromAmount(amountRupees: number, item: CounterItem): number | null {
  if (item.price <= 0) return null;
  const loose = item.soldBy === "weight" || /^(kg|g|l|ml)$/i.test(item.unit);
  if (!loose) return null;
  const q = (amountRupees * 100) / item.price;
  return q > 0 && q < 10_000 ? Math.round(q * 1000) / 1000 : null;
}

function buildLine(n: number, s: SpokenLine, cands: Candidate[], pick: { item: CounterItem; confidence: Confidence; source: "parser" | "ai" } | null, aiQty?: { qty: number; unit: SpokenLine["unit"] } | null): VoiceLine {
  const spoken = { qty: s.qty, unit: s.unit, explicit: s.qtyExplicit };
  if (!pick) {
    return { n, raw: s.raw, phrase: s.phrase, qty: s.qty, unit: null, spoken, status: cands.length ? "choose" : "not_found", confidence: null, source: "parser", item: null, candidates: view(cands), note: "none", check: true, issues: s.issues, lineTotal: null };
  }
  const base = aiQty ? { ...s, qty: aiQty.qty, unit: aiQty.unit, qtyExplicit: true } : s;
  let r = reconcileQty(base, pick.item);
  let note: VoiceLine["note"] = r.note;
  let check = r.check;
  let qty = r.qty;
  if (s.amount !== null) {
    const q = qtyFromAmount(s.amount, pick.item);
    if (q !== null) {
      qty = q;
      r = { ...r, qty: q };
      note = "amount";
    }
    check = true;
  }
  const rest = cands.filter((c) => c.item.itemId !== pick.item.itemId);
  const candidates = [itemView(pick.item), ...view(rest)].slice(0, 4);
  const status: VoiceStatus = pick.confidence === "low" ? "choose" : "matched";
  return {
    n,
    raw: s.raw,
    phrase: s.phrase,
    qty,
    unit: r.unit,
    spoken,
    status,
    confidence: pick.confidence,
    source: pick.source,
    item: itemView(pick.item),
    candidates,
    note,
    check: check || s.issues.includes("qty_odd"),
    issues: s.issues,
    lineTotal: money(qty, pick.item.price),
  };
}

/** Candidate list for the light tier: a small shop's whole list, else the closest items for each unresolved phrase and word, then the best sellers (at most 80). */
export const MAX_CHOICES = 80;
function choicesFor(idx: CounterIndex, unresolved: { n: number; phrase: string }[]): CounterItem[] {
  const out: CounterItem[] = [];
  const seen = new Set<string>();
  const add = (i: CounterItem) => {
    if (!seen.has(i.itemId) && out.length < MAX_CHOICES) {
      seen.add(i.itemId);
      out.push(i);
    }
  };
  if (idx.n <= MAX_CHOICES) {
    for (const x of idx.items) add(x.item);
    return out;
  }
  for (const u of unresolved) {
    for (const c of matchPhrase(idx, u.phrase, { min: 0.12, limit: 10 })) add(c.item);
    for (const w of u.phrase.split(" ").filter((x) => x.length > 1)) for (const c of matchPhrase(idx, w, { min: 0.4, limit: 4 })) add(c.item);
  }
  const top = [...idx.items].sort((a, b) => (b.item.popularity ?? 0) - (a.item.popularity ?? 0)).slice(0, 20);
  for (const t of top) add(t.item);
  return out;
}

const OK_ERRORS = new Set(["ai_timeout", "ai_off", "ai_feature_off", "ai_credits_exhausted", "ai_busy", "ai_unavailable", "ai_disabled", "ai_not_available"]);

/** The whole voice-billing step. Never throws for model problems: the lines the code resolved are returned anyway. */
export async function parseVoiceOrder(deps: VoiceDeps, req: VoiceRequest): Promise<{ output: VoiceResult; runId: string; credits: number }> {
  const clock = deps.now ?? Date.now;
  return deps.ai.runLocal({ tenantId: req.tenantId, userId: req.userId ?? null, feature: VOICE_FEATURE, model: "parser" }, async () => {
    const t0 = clock();
    const transcript = req.transcript.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, VOICE_MAX_CHARS);
    const parsed = parseUtterance(transcript);
    const spoken = parsed.lines.slice(0, VOICE_MAX_LINES);
    const idx = await deps.catalogue(req.tenantId);

    type Row = { n: number; s: SpokenLine; cands: Candidate[]; pick: { item: CounterItem; confidence: Confidence; source: "parser" | "ai" } | null; aiQty?: { qty: number; unit: SpokenLine["unit"] } | null };
    const rows: Row[] = spoken.map((s, i) => {
      const cands = matchPhrase(idx, s.phrase, { unit: s.unit, preferLoose: s.amount !== null });
      const r = classify(cands);
      return { n: i + 1, s, cands, pick: r ? { item: r.item, confidence: r.confidence, source: "parser" as const } : null };
    });
    const tParser = clock();

    const ai = { used: false, credits: 0, runId: null as string | null, error: null as string | null };
    let suspicious = false;
    let aiMs = 0;
    const unresolved = rows.filter((r) => !r.pick);
    if (unresolved.length && req.useAi !== false && idx.n > 0) {
      // phrases that look like instructions are not sent anywhere
      const sendable = unresolved.filter((r) => {
        const nz = neutralise(r.s.phrase);
        if (nz.suspicious || !nz.text) {
          suspicious = true;
          return false;
        }
        return true;
      });
      if (sendable.length) {
        const choices = choicesFor(idx, sendable.map((r) => ({ n: r.n, phrase: r.s.phrase })));
        const refs = new Map(choices.map((c, i) => [`c${i + 1}`, c]));
        const phrases = sendable.map((r) => `${r.n}. ${neutralise(r.s.phrase).text}`).join("\n");
        const list = choices.map((c, i) => `c${i + 1}: ${c.name}${c.nameTa ? ` / ${c.nameTa}` : ""} (${c.unit})`).join("\n");
        const t1 = clock();
        try {
          const call = deps.ai.run({
            tenantId: req.tenantId,
            userId: req.userId ?? null,
            feature: VOICE_FEATURE,
            tier: "light",
            system: VOICE_SYSTEM,
            input: { text: `${dataBlock("phrases", phrases)}\n${dataBlock("choices", list)}` },
            schema: { name: "voice_pick", jsonSchema: AI_PICK_JSON as unknown as Record<string, unknown>, zod: AiPick },
            maxTokens: 2000,
          });
          // selling never waits long for the model: past the limit the code's own lines stand (the run still finishes and is metered)
          call.catch(() => undefined);
          const r = await Promise.race([call, new Promise<never>((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "ai_timeout" })), deps.aiTimeoutMs ?? 5000))]);
          ai.used = true;
          ai.credits = r.credits;
          ai.runId = r.runId;
          if (!outputLooksInjected(r.output, [])) {
            for (const p of r.output.lines) {
              const row = sendable.find((x) => x.n === p.n);
              if (!row) continue;
              const item = p.ref ? refs.get(p.ref) : undefined;
              if (!item) continue; // null, or a ref that was never offered: nothing is invented
              const q = p.qty !== null && Number.isFinite(p.qty) && p.qty > 0 && p.qty <= 1000 ? { qty: Math.round(p.qty * 1000) / 1000, unit: p.unit } : null;
              row.pick = { item, confidence: p.sure ? "medium" : "low", source: "ai" };
              if (q && !row.s.qtyExplicit) row.aiQty = q;
            }
          }
        } catch (e) {
          const code = (e as { code?: string }).code ?? "ai_failed";
          ai.error = code;
          if (!OK_ERRORS.has(code)) ai.error = "ai_failed";
        }
        aiMs = clock() - t1;
      }
    }

    const lines = rows.map((r) => buildLine(r.n, r.s, r.cands, r.pick, r.aiQty));
    const result: VoiceResult = {
      lines,
      ignored: parsed.ignored,
      transcript,
      meta: { parserMs: tParser - t0, aiMs, totalMs: clock() - t0, unresolved: unresolved.length, ai, suspicious },
    };
    return result;
  }).then((r) => ({ output: r.output, runId: r.runId, credits: r.credits + r.output.meta.ai.credits }));
}

export { buildCounterIndex };
export const isWeightUnit = (u: SpokenLine["unit"]) => !!u && UNIT_FAMILY[u].family === "weight";
