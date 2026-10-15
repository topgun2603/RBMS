/**
 * Page/post block form model (same idea as sections.ts): strings in the editor, `fromBlockForm` produces exactly what
 * `blockSchema` accepts. Pure — no React.
 */
import { BLOCK_TYPES, blockSchema, CMS_LIMITS, extractYoutubeId, type Block, type BlockInput, type BlockType } from "./content";
import { formPath, issueCode, type FieldErrors } from "./sections";

export { BLOCK_TYPES, type BlockType };

export interface ImageForm {
  url: string;
  alt: string;
  caption: string;
}

export type BlockForm =
  | { type: "heading"; key: string; id?: string; level: 2 | 3; text: string }
  | { type: "paragraph"; key: string; id?: string; markdown: string }
  | ({ type: "image"; key: string; id?: string } & ImageForm)
  | { type: "gallery"; key: string; id?: string; images: ImageForm[] }
  | { type: "button"; key: string; id?: string; label: string; href: string; style: "primary" | "secondary" }
  | { type: "faq"; key: string; id?: string; items: { q: string; a: string }[] }
  | { type: "video"; key: string; id?: string; video: string; title: string }
  | { type: "divider"; key: string; id?: string };

let seq = 0;
export const newBlockKey = () => `b${Date.now().toString(36).slice(-4)}${(seq++).toString(36)}`;

const s = (v: string | null | undefined) => v ?? "";
const idOf = (id: string | undefined) => (id ? { id } : {});
const img = (i: { url: string; alt?: string; caption?: string }): ImageForm => ({ url: s(i.url), alt: s(i.alt), caption: s(i.caption) });
const imgOut = (i: ImageForm) => ({ url: i.url.trim(), alt: i.alt.trim(), ...(i.caption.trim() ? { caption: i.caption.trim() } : {}) });

export function toBlockForm(b: Block | BlockInput, key: string = newBlockKey()): BlockForm {
  const x = b as Block;
  switch (x.type) {
    case "heading":
      return { type: "heading", key, ...idOf(x.id), level: x.level === 3 ? 3 : 2, text: s(x.text) };
    case "paragraph":
      return { type: "paragraph", key, ...idOf(x.id), markdown: s(x.markdown) };
    case "image":
      return { type: "image", key, ...idOf(x.id), ...img(x) };
    case "gallery":
      return { type: "gallery", key, ...idOf(x.id), images: x.images.map(img) };
    case "button":
      return { type: "button", key, ...idOf(x.id), label: s(x.label), href: s(x.href), style: x.style === "secondary" ? "secondary" : "primary" };
    case "faq":
      return { type: "faq", key, ...idOf(x.id), items: x.items.map((i) => ({ q: s(i.q), a: s(i.a) })) };
    case "video":
      return { type: "video", key, ...idOf(x.id), video: s(x.youtubeId), title: s(x.title) };
    case "divider":
      return { type: "divider", key, ...idOf(x.id) };
  }
}

export function fromBlockForm(f: BlockForm): BlockInput {
  switch (f.type) {
    case "heading":
      return { type: "heading", ...idOf(f.id), level: f.level, text: f.text.trim() };
    case "paragraph":
      return { type: "paragraph", ...idOf(f.id), markdown: f.markdown };
    case "image":
      return { type: "image", ...idOf(f.id), ...imgOut(f) };
    case "gallery":
      return { type: "gallery", ...idOf(f.id), images: f.images.map(imgOut) };
    case "button":
      return { type: "button", ...idOf(f.id), label: f.label.trim(), href: f.href.trim(), style: f.style };
    case "faq":
      return { type: "faq", ...idOf(f.id), items: f.items.map((i) => ({ q: i.q.trim(), a: i.a })) };
    case "video":
      return { type: "video", ...idOf(f.id), youtubeId: extractYoutubeId(f.video) ?? f.video.trim(), ...(f.title.trim() ? { title: f.title.trim() } : {}) };
    case "divider":
      return { type: "divider", ...idOf(f.id) };
  }
}

export function newBlockForm(type: BlockType, key: string = newBlockKey()): BlockForm {
  switch (type) {
    case "heading":
      return { type, key, level: 2, text: "" };
    case "paragraph":
      return { type, key, markdown: "" };
    case "image":
      return { type, key, url: "", alt: "", caption: "" };
    case "gallery":
      return { type, key, images: [] };
    case "button":
      return { type, key, label: "", href: "", style: "primary" };
    case "faq":
      return { type, key, items: [{ q: "", a: "" }] };
    case "video":
      return { type, key, video: "", title: "" };
    case "divider":
      return { type, key };
  }
}

export function duplicateBlockForm(f: BlockForm, key: string = newBlockKey()): BlockForm {
  const { id: _id, ...rest } = JSON.parse(JSON.stringify(f)) as BlockForm & { id?: string };
  return { ...rest, key } as BlockForm;
}

export type BlockCheck = { ok: true; value: Block; errors: FieldErrors } | { ok: false; errors: FieldErrors };

export function checkBlock(f: BlockForm): BlockCheck {
  const r = blockSchema.safeParse(fromBlockForm(f));
  if (r.success) return { ok: true, value: r.data, errors: {} };
  const errors: FieldErrors = {};
  for (const issue of r.error.issues) {
    let key = formPath(issue.path) || "_";
    if (key === "youtubeId") key = "video";
    if (!errors[key]) errors[key] = issueCode(issue);
  }
  return { ok: false, errors };
}

/** Validates every block; `errors` keyed by block key. `blocks` only when all are valid. */
export function checkBlocks(forms: readonly BlockForm[]): { blocks: Block[] | null; errors: Record<string, FieldErrors> } {
  const errors: Record<string, FieldErrors> = {};
  const out: Block[] = [];
  for (const f of forms) {
    const c = checkBlock(f);
    if (c.ok) out.push(c.value);
    else errors[f.key] = c.errors;
  }
  return { blocks: Object.keys(errors).length ? null : out, errors };
}

export const BLOCK_LIMITS = { blocks: CMS_LIMITS.blocks, gallery: CMS_LIMITS.galleryImages, faq: CMS_LIMITS.faqItems } as const;

/** Thumbnail of a YouTube video for the editor. */
export const youtubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
