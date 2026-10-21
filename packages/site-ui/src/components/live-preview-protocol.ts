import { z } from "zod";

/*
 * Editor side of the live-preview protocol. Structural copy of @srirealtime/storefront-ui `lib/preview-protocol.ts`
 * (site-ui doesn't depend on the storefront package); keep the two in step and bump PREVIEW_PROTOCOL_VERSION in both
 * on breaking changes — the store reports its version in `ready` and the editor refuses a mismatch.
 */

export const PREVIEW_SOURCE = "sr-preview";
export const PREVIEW_PROTOCOL_VERSION = 1;
export const PREVIEW_ENTER_PATH = "/api/preview/enter";

export const PREVIEW_DEVICES = { phone: 390, tablet: 820, desktop: 1440 } as const;
export type PreviewDevice = keyof typeof PREVIEW_DEVICES;

export type EditorMessage =
  | { type: "hello" }
  | { type: "theme"; tokens: Record<string, unknown> }
  | { type: "theme-reset" }
  | { type: "sections"; sections: Record<string, unknown>[]; seo?: Record<string, unknown> }
  | { type: "sections-reset" }
  | { type: "select"; id: string | null }
  | { type: "navigate"; path: string }
  | { type: "mode"; mode: "edit" | "browse" };

/** The envelope every message carries. */
export const editorMessage = (m: EditorMessage) => ({ source: PREVIEW_SOURCE, v: PREVIEW_PROTOCOL_VERSION, ...m });

const envelope = { source: z.literal(PREVIEW_SOURCE), v: z.literal(PREVIEW_PROTOCOL_VERSION) };
export const storeMessageSchema = z.discriminatedUnion("type", [
  z.object({ ...envelope, type: z.literal("ready"), path: z.string().max(2048), protocol: z.number().int() }),
  z.object({ ...envelope, type: z.literal("select"), sectionId: z.string().min(1).max(40) }),
  z.object({ ...envelope, type: z.literal("navigate"), path: z.string().max(2048) }),
  z.object({ ...envelope, type: z.literal("rendered"), kind: z.enum(["theme", "sections", "navigate"]), ms: z.number() }),
  z.object({ ...envelope, type: z.literal("error"), code: z.enum(["expired", "draft_failed", "bad_message"]), message: z.string().max(500).optional() }),
]);
export type StoreMessage = z.output<typeof storeMessageSchema>;

/**
 * A validated message from the preview frame: it must come from that frame's window and from the store's exact origin.
 * Anything else (other frames, extensions, devtools) is ignored.
 */
export function readStoreMessage(e: { origin: string; source: unknown; data: unknown }, frame: unknown, storeOrigin: string): StoreMessage | null {
  if (!frame || e.source !== frame || e.origin !== storeOrigin) return null;
  const r = storeMessageSchema.safeParse(e.data);
  return r.success ? r.data : null;
}

/** "http://anbu.localhost:3003/" → "http://anbu.localhost:3003"; null for anything that isn't http(s). */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** Same-origin store path, or "/" (mirrors the store's own check, which has the final say). */
export function cleanPath(path: string | null | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.startsWith("/api/")) return "/";
  return path.slice(0, 2048);
}

/** The URL that enters preview mode on the store and opens `path`. */
export function enterUrl(storeOrigin: string, token: string, path = "/"): string {
  return `${storeOrigin}${PREVIEW_ENTER_PATH}?${new URLSearchParams({ token, path: cleanPath(path) }).toString()}`;
}

/** How much a device-width frame must shrink to fit `available` pixels (never enlarged). */
export function fitScale(deviceWidth: number, available: number): number {
  if (!(available > 0) || !(deviceWidth > 0)) return 1;
  return Math.min(1, available / deviceWidth);
}
