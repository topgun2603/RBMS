import type { ParamSource, TemplateMapping, TemplateSlot, WaTemplate, WaTemplateComponent } from "./types";

/*
 * Client copies of @srirealtime/whatsapp template.ts (UI modules never import server packages): placeholders,
 * slots, previews and the campaign variable mapping. Slots are `header.1`, `body.1`, `body.customer_name`,
 * `button.0.1` (URL button 0), `button.1.code` (copy-code button 1).
 */

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Unique placeholder keys in order: numbers ascending for positional templates, first appearance for named ones. */
export function placeholders(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) if (!seen.includes(m[1]!)) seen.push(m[1]!);
  return seen.every((k) => /^\d+$/.test(k)) ? seen.sort((a, b) => Number(a) - Number(b)) : seen;
}

const find = (components: readonly WaTemplateComponent[], type: string) => components.find((c) => c.type?.toUpperCase() === type);

export function headerMediaType(components: readonly WaTemplateComponent[]): "image" | "document" | "video" | null {
  const f = find(components, "HEADER")?.format?.toUpperCase();
  return f === "IMAGE" ? "image" : f === "DOCUMENT" ? "document" : f === "VIDEO" ? "video" : null;
}

/** Every slot the template needs a value for (same order as the server). */
export function templateSlots(components: readonly WaTemplateComponent[]): TemplateSlot[] {
  const out: TemplateSlot[] = [];
  const header = find(components, "HEADER");
  if (header && (header.format ?? "TEXT").toUpperCase() === "TEXT") {
    for (const key of placeholders(header.text)) out.push({ slot: `header.${key}`, component: "header", key });
  }
  for (const key of placeholders(find(components, "BODY")?.text)) out.push({ slot: `body.${key}`, component: "body", key });
  (find(components, "BUTTONS")?.buttons ?? []).forEach((b, i) => {
    const type = b.type?.toUpperCase();
    if (type === "URL") for (const key of placeholders(b.url)) out.push({ slot: `button.${i}.${key}`, component: "button", key, buttonIndex: i, buttonType: "url" });
    else if (type === "COPY_CODE") out.push({ slot: `button.${i}.code`, component: "button", key: "code", buttonIndex: i, buttonType: "copy_code" });
  });
  return out;
}

/** Fills `{{key}}` with `values[key]`; unknown ones are kept so the preview shows what's missing. */
export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (all, key: string) => (values[key] !== undefined && values[key] !== "" ? values[key]! : all));
}

/** Meta rejects parameters with new lines, tabs or runs of spaces. */
export function sanitiseParam(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 1024);
}

export interface TemplatePreview {
  header: string | null;
  body: string;
  footer: string | null;
  buttons: { text: string; type: string }[];
  /** Slots with no value. */
  missing: string[];
}

/** Values by slot → what the customer will see (header, body, footer, buttons). */
export function previewTemplate(t: Pick<WaTemplate, "components">, values: Record<string, string>, opts: { headerMedia?: boolean } = {}): TemplatePreview {
  const slots = templateSlots(t.components);
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    const s = sanitiseParam(v ?? "");
    if (s) clean[k] = s;
  }
  const missing = slots.filter((s) => !clean[s.slot]).map((s) => s.slot);
  if (headerMediaType(t.components) && !opts.headerMedia) missing.push("header.media");
  const local = (prefix: string) => {
    const out: Record<string, string> = {};
    for (const [slot, v] of Object.entries(clean)) if (slot.startsWith(`${prefix}.`)) out[slot.slice(prefix.length + 1)] = v;
    return out;
  };
  const header = find(t.components, "HEADER");
  return {
    header: header && (header.format ?? "TEXT").toUpperCase() === "TEXT" && header.text ? fillPlaceholders(header.text, local("header")) : null,
    body: fillPlaceholders(find(t.components, "BODY")?.text ?? "", local("body")),
    footer: find(t.components, "FOOTER")?.text ?? null,
    buttons: (find(t.components, "BUTTONS")?.buttons ?? []).map((b) => ({ text: b.text ?? b.type, type: b.type })),
    missing,
  };
}

/** A sample recipient for live previews in the campaign editor. */
export interface SampleRecipient {
  phone: string;
  name: string | null;
  variables: Record<string, string>;
}

/** The value of one mapping source for a recipient ("" when it has none). */
export function resolveSource(src: ParamSource, r: SampleRecipient): string {
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

/** Values by slot for a recipient under a mapping (campaign preview). */
export function mappedValues(slots: readonly TemplateSlot[], mapping: TemplateMapping, r: SampleRecipient): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of slots) {
    const src = mapping.params[s.slot];
    const v = src ? resolveSource(src, r) : "";
    if (v) out[s.slot] = v;
  }
  return out;
}

/** Slots a mapping leaves unmapped or mapped to nothing usable (a "text" with no value, a "var" with no key). */
export function unmappedSlots(slots: readonly TemplateSlot[], mapping: TemplateMapping): string[] {
  return slots
    .filter((s) => {
      const src = mapping.params[s.slot];
      if (!src) return true;
      if (src.from === "text") return !sanitiseParam(src.value);
      if (src.from === "var") return !src.key.trim();
      return false;
    })
    .map((s) => s.slot);
}

/**
 * The server's default mapping: first body placeholder → the customer's name, the rest → variables named after the
 * placeholder. Used when a template has no saved mapping.
 */
export function defaultMapping(slots: readonly TemplateSlot[]): TemplateMapping {
  const params: Record<string, ParamSource> = {};
  let first = true;
  for (const s of slots) {
    if (s.component === "body" && first) {
      params[s.slot] = { from: "name", fallback: "Customer" };
      first = false;
    } else params[s.slot] = { from: "var", key: s.key };
  }
  return { params };
}

/** Changes the source kind of one slot, keeping what still makes sense. */
export function setSourceKind(mapping: TemplateMapping, slot: TemplateSlot, kind: ParamSource["from"]): TemplateMapping {
  const prev = mapping.params[slot.slot];
  const fallback = prev && (prev.from === "name" || prev.from === "var") ? prev.fallback : undefined;
  const next: ParamSource =
    kind === "name"
      ? { from: "name", ...(fallback ? { fallback } : {}) }
      : kind === "phone"
        ? { from: "phone" }
        : kind === "var"
          ? { from: "var", key: prev?.from === "var" ? prev.key : slot.key, ...(fallback ? { fallback } : {}) }
          : { from: "text", value: prev?.from === "text" ? prev.value : "" };
  return { ...mapping, params: { ...mapping.params, [slot.slot]: next } };
}

/** Readable slot name: "body.1" → { part: "body", key: "1" }. */
export function slotLabel(slot: TemplateSlot): { part: "header" | "body" | "button"; key: string; button?: number } {
  return { part: slot.component, key: slot.key, ...(slot.buttonIndex !== undefined ? { button: slot.buttonIndex + 1 } : {}) };
}
