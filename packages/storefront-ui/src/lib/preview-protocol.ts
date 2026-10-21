import { z } from "zod";

/*
 * Live-preview wire protocol between the shop owner's editor (parent window, site-ui `LivePreview`) and the real store
 * rendered in its iframe (client/preview-bridge.tsx). Pure (no React, no Node): used by the bridge, the
 * store server and tests (constants + origin rules: preview-routing.ts). site-ui keeps a structural copy (components/live-preview-protocol.ts); bump
 * PREVIEW_PROTOCOL_VERSION in both on breaking changes — the editor shows an error when the versions differ.
 *
 * Every message is `{ source: "sr-preview", v: 1, type, ...payload }`; anything else on the channel is ignored.
 */

export * from "./preview-routing";
import { isAllowedOrigin, PREVIEW_PROTOCOL_VERSION, PREVIEW_SOURCE } from "./preview-routing";

// ------------------------------------------------------------------ messages

const envelope = { source: z.literal(PREVIEW_SOURCE), v: z.literal(PREVIEW_PROTOCOL_VERSION) };
const sectionId = z.string().trim().min(1).max(40);

/** Editor → store. */
export const editorMessageSchema = z.discriminatedUnion("type", [
  /** Sent on iframe load; the store answers `ready`. */
  z.object({ ...envelope, type: z.literal("hello") }),
  /** Unsaved brand tokens (the branding package's BrandTokensInput: colours, fonts, radius, mode, theme variants). */
  z.object({ ...envelope, type: z.literal("theme"), tokens: z.record(z.unknown()) }),
  /** Back to the saved look. */
  z.object({ ...envelope, type: z.literal("theme-reset") }),
  /** Unsaved home sections (cms HomeSectionInput[], each with an `id` so clicks map back to the editor). */
  z.object({ ...envelope, type: z.literal("sections"), sections: z.array(z.record(z.unknown())).max(40), seo: z.record(z.unknown()).optional() }),
  /** Back to the saved home draft. */
  z.object({ ...envelope, type: z.literal("sections-reset") }),
  /** Outline + scroll to a section (null clears). */
  z.object({ ...envelope, type: z.literal("select"), id: sectionId.nullable() }),
  /** Open a store page in the frame. */
  z.object({ ...envelope, type: z.literal("navigate"), path: z.string().max(2048) }),
  /** edit: hover outlines, click selects, links inside sections don't navigate · browse: the plain store. */
  z.object({ ...envelope, type: z.literal("mode"), mode: z.enum(["edit", "browse"]) }),
]);
export type EditorMessage = z.output<typeof editorMessageSchema>;

/** Store → editor. */
export const storeMessageSchema = z.discriminatedUnion("type", [
  z.object({ ...envelope, type: z.literal("ready"), path: z.string(), protocol: z.number().int() }),
  z.object({ ...envelope, type: z.literal("select"), sectionId: sectionId }),
  z.object({ ...envelope, type: z.literal("navigate"), path: z.string() }),
  /** A soft refresh finished: what changed and how long it took (ms, message → new UI committed). */
  z.object({ ...envelope, type: z.literal("rendered"), kind: z.enum(["theme", "sections", "navigate"]), ms: z.number() }),
  z.object({ ...envelope, type: z.literal("error"), code: z.enum(["expired", "draft_failed", "bad_message"]), message: z.string().optional() }),
]);
export type StoreMessage = z.output<typeof storeMessageSchema>;

type Payload<M, T> = Omit<Extract<M, { type: T }>, "source" | "v">;

/** Builds an editor → store message. */
export const editorMessage = <T extends EditorMessage["type"]>(m: Payload<EditorMessage, T> & { type: T }) => ({ source: PREVIEW_SOURCE, v: PREVIEW_PROTOCOL_VERSION, ...m }) as Extract<EditorMessage, { type: T }>;
/** Builds a store → editor message. */
export const storeMessage = <T extends StoreMessage["type"]>(m: Payload<StoreMessage, T> & { type: T }) => ({ source: PREVIEW_SOURCE, v: PREVIEW_PROTOCOL_VERSION, ...m }) as Extract<StoreMessage, { type: T }>;

/** A validated editor message, or null (wrong origin, not ours, malformed). */
export function readEditorMessage(e: { origin: string; data: unknown }, patterns: readonly string[]): EditorMessage | null {
  if (!isAllowedOrigin(e.origin, patterns)) return null;
  const r = editorMessageSchema.safeParse(e.data);
  return r.success ? r.data : null;
}
