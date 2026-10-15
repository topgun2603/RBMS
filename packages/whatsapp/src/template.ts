import { z } from "zod";
import type { ResolvedRecipient } from "./logic";

/**
 * Template parameter mapping. A template's placeholders (`{{1}}`, or `{{customer_name}}` for NAMED templates) are
 * addressed by *slots*: `header.1`, `body.1`, `body.customer_name`, `button.0.1` (URL button 0), `button.1.code`
 * (copy-code button 1). A mapping says where each slot's value comes from for a recipient.
 */

/** A component as Meta returns it from `GET /{waba-id}/message_templates`. */
export interface TemplateComponent {
  type: string; // HEADER | BODY | FOOTER | BUTTONS
  format?: string; // HEADER: TEXT | IMAGE | VIDEO | DOCUMENT | LOCATION
  text?: string;
  buttons?: { type: string; text?: string; url?: string; phone_number?: string; example?: unknown }[];
  example?: unknown;
}

export interface TemplateDef {
  name: string;
  language: string;
  components: TemplateComponent[];
  /** `POSITIONAL` ({{1}}) or `NAMED` ({{first_name}}). Default positional. */
  parameterFormat?: string | null;
}

export const paramSourceSchema = z.discriminatedUnion("from", [
  z.object({ from: z.literal("name"), fallback: z.string().max(200).optional() }),
  z.object({ from: z.literal("phone") }),
  z.object({ from: z.literal("var"), key: z.string().trim().min(1).max(60), fallback: z.string().max(200).optional() }),
  z.object({ from: z.literal("text"), value: z.string().max(1000) }),
]);
export type ParamSource = z.infer<typeof paramSourceSchema>;

export const headerMediaSchema = z.object({
  type: z.enum(["image", "document", "video"]),
  link: z.string().url().max(2000),
  filename: z.string().max(200).optional(),
});
export type HeaderMedia = z.infer<typeof headerMediaSchema>;

export const templateMappingSchema = z.object({
  params: z.record(z.string().regex(/^(header|body|button\.\d{1,2})\.[a-z0-9_]+$/i), paramSourceSchema).default({}),
  headerMedia: headerMediaSchema.optional(),
});
export type TemplateMapping = z.infer<typeof templateMappingSchema>;

export interface TemplateSlot {
  slot: string;
  component: "header" | "body" | "button";
  /** Placeholder name: "1", "2" … or the NAMED parameter. "code" for copy-code buttons. */
  key: string;
  buttonIndex?: number;
  buttonType?: string;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Unique placeholder keys in order: numbers ascending for positional templates, first appearance for named ones. */
export function placeholders(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) if (!seen.includes(m[1]!)) seen.push(m[1]!);
  const allNumeric = seen.every((k) => /^\d+$/.test(k));
  return allNumeric ? seen.sort((a, b) => Number(a) - Number(b)) : seen;
}

const find = (t: TemplateDef, type: string) => t.components.find((c) => c.type?.toUpperCase() === type);

/** The header media kind a template needs (`image|document|video`), or null for text / no header. */
export function headerMediaType(t: TemplateDef): HeaderMedia["type"] | null {
  const f = find(t, "HEADER")?.format?.toUpperCase();
  return f === "IMAGE" ? "image" : f === "DOCUMENT" ? "document" : f === "VIDEO" ? "video" : null;
}

/** Every slot the template needs a value for. */
export function templateSlots(t: TemplateDef): TemplateSlot[] {
  const out: TemplateSlot[] = [];
  const header = find(t, "HEADER");
  if (header && (header.format ?? "TEXT").toUpperCase() === "TEXT") {
    for (const key of placeholders(header.text)) out.push({ slot: `header.${key}`, component: "header", key });
  }
  for (const key of placeholders(find(t, "BODY")?.text)) out.push({ slot: `body.${key}`, component: "body", key });
  (find(t, "BUTTONS")?.buttons ?? []).forEach((b, i) => {
    const type = b.type?.toUpperCase();
    if (type === "URL") {
      for (const key of placeholders(b.url)) out.push({ slot: `button.${i}.${key}`, component: "button", key, buttonIndex: i, buttonType: "url" });
    } else if (type === "COPY_CODE") {
      out.push({ slot: `button.${i}.code`, component: "button", key: "code", buttonIndex: i, buttonType: "copy_code" });
    }
  });
  return out;
}

/** Meta rejects parameters with new lines, tabs or more than 4 spaces in a row, and empty ones. */
export function sanitiseParam(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 1024);
}

/** The value of one source for a recipient ("" when it has none). */
export function resolveSource(src: ParamSource, r: Pick<ResolvedRecipient, "phone" | "name" | "variables">): string {
  switch (src.from) {
    case "name":
      return sanitiseParam(r.name ?? "") || sanitiseParam(src.fallback ?? "");
    case "phone":
      return r.phone;
    case "var":
      return sanitiseParam(r.variables[src.key] ?? "") || sanitiseParam(src.fallback ?? "");
    case "text":
      return sanitiseParam(src.value);
  }
}

/** A component of the Cloud API send payload. */
export type SendComponent =
  | { type: "header"; parameters: SendParameter[] }
  | { type: "body"; parameters: SendParameter[] }
  | { type: "button"; sub_type: "url" | "copy_code"; index: string; parameters: SendParameter[] };

export type SendParameter =
  | { type: "text"; text: string; parameter_name?: string }
  | { type: "coupon_code"; coupon_code: string }
  | { type: "image"; image: { link: string } }
  | { type: "video"; video: { link: string } }
  | { type: "document"; document: { link: string; filename?: string } };

export interface BuiltTemplate {
  components: SendComponent[];
  /** Slots without a value (the send would be rejected by Meta). */
  missing: string[];
  /** Values by slot, for previews and the inbox. */
  values: Record<string, string>;
  /** The body (header + body text) with values filled in, stored as the message body. */
  text: string;
}

/** Fills `{{key}}` placeholders with `values[key]` (unknown ones are kept). */
export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (all, key: string) => values[key] ?? all);
}

/**
 * Builds the Cloud API `template.components` for one recipient from a template, a mapping and the recipient's data.
 * Slots with no mapping, or whose value is empty, are reported in `missing`.
 */
export function buildTemplateComponents(
  t: TemplateDef,
  mapping: TemplateMapping,
  recipient: Pick<ResolvedRecipient, "phone" | "name" | "variables">,
): BuiltTemplate {
  const named = (t.parameterFormat ?? "").toUpperCase() === "NAMED";
  const slots = templateSlots(t);
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const s of slots) {
    const src = mapping.params[s.slot];
    const v = src ? resolveSource(src, recipient) : "";
    if (!v) missing.push(s.slot);
    else values[s.slot] = v;
  }
  const textParam = (s: TemplateSlot): SendParameter =>
    named && !/^\d+$/.test(s.key) ? { type: "text", text: values[s.slot] ?? "", parameter_name: s.key } : { type: "text", text: values[s.slot] ?? "" };

  const components: SendComponent[] = [];
  const mediaType = headerMediaType(t);
  if (mediaType) {
    const media = mapping.headerMedia;
    if (!media || media.type !== mediaType) missing.push("header.media");
    else {
      const p: SendParameter =
        media.type === "image"
          ? { type: "image", image: { link: media.link } }
          : media.type === "video"
            ? { type: "video", video: { link: media.link } }
            : { type: "document", document: { link: media.link, ...(media.filename ? { filename: media.filename } : {}) } };
      components.push({ type: "header", parameters: [p] });
    }
  } else {
    const hs = slots.filter((s) => s.component === "header");
    if (hs.length) components.push({ type: "header", parameters: hs.map(textParam) });
  }
  const bs = slots.filter((s) => s.component === "body");
  if (bs.length) components.push({ type: "body", parameters: bs.map(textParam) });
  const byButton = new Map<number, TemplateSlot[]>();
  for (const s of slots) if (s.component === "button") byButton.set(s.buttonIndex!, [...(byButton.get(s.buttonIndex!) ?? []), s]);
  for (const [index, ss] of [...byButton.entries()].sort((a, b) => a[0] - b[0])) {
    const type = ss[0]!.buttonType as "url" | "copy_code";
    components.push({
      type: "button",
      sub_type: type,
      index: String(index),
      parameters: ss.map((s) => (type === "copy_code" ? { type: "coupon_code", coupon_code: values[s.slot] ?? "" } : { type: "text", text: values[s.slot] ?? "" })),
    });
  }

  const local = (prefix: string) => {
    const out: Record<string, string> = {};
    for (const [slot, v] of Object.entries(values)) if (slot.startsWith(`${prefix}.`)) out[slot.slice(prefix.length + 1)] = v;
    return out;
  };
  const headerText = mediaType ? "" : (find(t, "HEADER")?.text ?? "");
  const text = [headerText && fillPlaceholders(headerText, local("header")), fillPlaceholders(find(t, "BODY")?.text ?? "", local("body"))]
    .filter(Boolean)
    .join("\n");
  return { components, missing, values, text };
}

/**
 * A default mapping for a template: first body placeholder → the recipient's name, the rest → variables named after
 * the placeholder (`{{2}}` → var "2", `{{amount}}` → var "amount"). Staff adjust it in the campaign editor.
 */
export function defaultMapping(t: TemplateDef): TemplateMapping {
  const params: Record<string, ParamSource> = {};
  let first = true;
  for (const s of templateSlots(t)) {
    if (s.component === "body" && first) {
      params[s.slot] = { from: "name", fallback: "Customer" };
      first = false;
    } else params[s.slot] = { from: "var", key: s.key };
  }
  return { params };
}
