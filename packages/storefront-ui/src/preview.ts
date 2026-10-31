/**
 * Edge-safe live-preview entry (`@rbms/storefront-ui/preview`): constants, origin rules and the store
 * middleware helper. No React, no zod, no request-scoped server imports, so it loads in Next middleware.
 */
export * from "./lib/preview-routing";
import { editorOrigins, frameAncestors, PREVIEW_ENTER_PATH, PREVIEW_QUERY } from "./lib/preview-routing";

/** What the store middleware should do with a request (pure; apps/store/src/middleware.ts applies it). */
export type PreviewRouting =
  | { action: "pass" }
  | { action: "enter"; location: string }
  | { action: "preview"; headers: Record<string, string> };

/**
 * - `?__preview=<token>` on any page → redirect to the enter route (which verifies the token and sets the cookie),
 *   coming back to the same page without the parameter;
 * - a request with the preview cookie → mark the response private / uncacheable / noindex and only frameable by the
 *   editor origins (the cookie itself is verified by the server for every render);
 * - anything else → untouched.
 */
export function previewRouting(url: URL, hasCookie: boolean, origins: readonly string[] = editorOrigins()): PreviewRouting {
  const token = url.searchParams.get(PREVIEW_QUERY);
  if (token !== null && !url.pathname.startsWith("/api/")) {
    const back = new URL(url.toString());
    back.searchParams.delete(PREVIEW_QUERY);
    const enter = new URLSearchParams({ token, path: `${back.pathname}${back.search}` });
    return { action: "enter", location: `${PREVIEW_ENTER_PATH}?${enter.toString()}` };
  }
  if (!hasCookie) return { action: "pass" };
  return {
    action: "preview",
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "x-robots-tag": "noindex, nofollow",
      "content-security-policy": `frame-ancestors ${frameAncestors(origins)}`,
      vary: "Cookie",
    },
  };
}

