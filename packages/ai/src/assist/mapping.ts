import { badRequest } from "@rbms/core";
import { z } from "zod";
import { maskText } from "../masking";
import type { AiRunner } from "./hsn";
import { DATA_RULES, dataBlock } from "./safety";

export const MAPPING_FEATURE = "import-mapping";

export const MAPPING_SYSTEM = [
  "You match the columns of a spreadsheet a shop owner wants to import (exported from Vyapar, Tally, Busy, Marg, Excel or any other software; headers may be in English, Tamil or Tanglish) to the target fields of an importer.",
  "You see the header row and a few sample rows (phone numbers, e-mails and GSTINs are masked), then the list of target fields with a short help text each.",
  "Return exactly one entry in mappings for EVERY target field listed, in the same order; never return an empty list. For every target field give the 0-based index of the column that holds it, or null when no column fits. One column can feed only one field. Prefer null to a wild guess. confidence is high only when header and sample values both agree.",
  "Use the sample values to tell similar columns apart (selling price vs purchase price, HSN vs barcode, opening stock vs reorder level). reason is one short English sentence.",
  DATA_RULES,
].join("\n");

export interface MappingField {
  key: string;
  label: string;
  help?: string;
  required?: boolean;
}

export interface MappingRequest {
  tenantId: string;
  userId?: string | null;
  /** Importer key, e.g. "catalog.products" (only a hint for the model). */
  importer?: string;
  headers: string[];
  /** Raw sample rows; only the first 5 are used. */
  rows: string[][];
  fields: MappingField[];
}

const MAX_HEADERS = 60;
const MAX_ROWS = 5;
const MAX_CELL = 40;

export const MappingSchema = z.object({
  mappings: z.array(z.object({ field: z.string(), column: z.number().int().nullable(), confidence: z.enum(["low", "medium", "high"]), reason: z.string() })),
});
type Raw = z.infer<typeof MappingSchema>;

const JSON_SCHEMA = {
  type: "object",
  properties: {
    mappings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: { type: "string" },
          column: { type: ["integer", "null"] },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          reason: { type: "string" },
        },
        required: ["field", "column", "confidence", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["mappings"],
  additionalProperties: false,
} as const;

export interface MappingSuggestion {
  field: string;
  column: number | null;
  confidence: "low" | "medium" | "high";
  reason: string;
}

/** Masks one cell: phones, e-mails and GSTINs, then clips. The cells are the only file content that is ever sent. */
export const maskCell = (v: string) => maskText(v, { phones: true, emails: true, gstin: true }).slice(0, MAX_CELL);

/** What goes to the model: the header row and up to 5 masked sample rows, as a tab-separated block. Exported for tests. */
export function sampleBlock(headers: string[], rows: string[][]): string {
  const head = headers.slice(0, MAX_HEADERS).map((h, i) => `${i}: ${h.slice(0, 60)}`);
  const body = rows.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_HEADERS).map(maskCell).join(" | "));
  return `Header (index: name)\n${head.join("\n")}\n\nSample rows (cells in column order, separated by " | ")\n${body.join("\n")}`;
}

/** Keeps only valid, unique picks: known field, column inside the file, one field per column (higher confidence wins). */
export function checkMapping(raw: Raw, fields: MappingField[], columns: number): MappingSuggestion[] {
  const keys = new Set(fields.map((f) => f.key));
  const order = { high: 2, medium: 1, low: 0 } as const;
  const byField = new Map<string, MappingSuggestion>();
  for (const m of raw.mappings) {
    if (!keys.has(m.field) || byField.has(m.field)) continue;
    const column = m.column !== null && m.column >= 0 && m.column < columns ? m.column : null;
    byField.set(m.field, { field: m.field, column, confidence: column === null ? "low" : m.confidence, reason: m.reason.slice(0, 200) });
  }
  const best = new Map<number, MappingSuggestion>();
  for (const s of byField.values()) {
    if (s.column === null) continue;
    const cur = best.get(s.column);
    if (!cur || order[s.confidence] > order[cur.confidence]) {
      if (cur) cur.column = null;
      best.set(s.column, s);
    } else s.column = null;
  }
  return fields.map((f) => byField.get(f.key) ?? { field: f.key, column: null, confidence: "low" as const, reason: "" });
}

/** "Suggest mapping with AI": header row + 5 masked sample rows + the target fields (light tier). The owner confirms in the wizard. */
export async function suggestMapping(ai: AiRunner, req: MappingRequest) {
  const headers = req.headers.slice(0, MAX_HEADERS);
  if (headers.length === 0 || req.fields.length === 0) throw badRequest("Upload a file first");
  const fieldText = req.fields.map((f) => `${f.key}: ${f.label}${f.required ? " (required)" : ""}${f.help ? ` - ${f.help}` : ""}`).join("\n");
  const text = [req.importer ? `Importer: ${req.importer}` : "", dataBlock("spreadsheet", sampleBlock(headers, req.rows)), "Target fields (key: label - help)\n" + fieldText]
    .filter(Boolean)
    .join("\n\n");
  const ask = (extra: string) =>
    ai.run<Raw>({
      tenantId: req.tenantId,
      userId: req.userId ?? null,
      feature: MAPPING_FEATURE,
      tier: "light",
      system: MAPPING_SYSTEM,
      input: { text: text + extra },
      mask: { phones: true, emails: true, gstin: true },
      schema: { name: "column_mapping", jsonSchema: JSON_SCHEMA as unknown as Record<string, unknown>, zod: MappingSchema },
      maxTokens: 2500,
    });
  let r = await ask("");
  let credits = r.credits;
  // A model that answers with an empty list has not looked: ask once more, naming the number of entries wanted.
  const answered = (x: Raw) => x.mappings.filter((m) => m.column !== null).length;
  if (answered(r.output) === 0) {
    const again = await ask(`

Return exactly ${req.fields.length} entries, one per target field. Match every column you can.`);
    credits += again.credits;
    if (answered(again.output) > 0) r = again;
  }
  return { mappings: checkMapping(r.output, req.fields, headers.length), runId: r.runId, credits };
}
