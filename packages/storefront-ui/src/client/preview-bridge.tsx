"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  isAllowedOrigin,
  readEditorMessage,
  safePreviewPath,
  storeMessage,
  type EditorMessage,
  type StoreMessage,
} from "../lib/preview-protocol";
import { previewThemeFrom, type PreviewTheme } from "../lib/preview-theme";
import { previewMessages } from "../lib/messages-preview";
import { parkPreviewDraft } from "../server/preview-actions";
import { applyPreviewTheme, findSection, placeOutline, resetPreviewTheme, sectionBox, sectionIdOf } from "./preview-dom";

/*
 * Mounted by <PreviewMount> (pages/preview.tsx) only for requests in preview mode (valid preview cookie). Talks to the
 * editor in the parent window over postMessage (lib/preview-protocol.ts):
 * - theme      → restyles the page in the browser at once (no network), then parks the tokens server-side the same
 *                way so variants rendered as markup (footer, hero, announcement…) follow too;
 * - sections   → parks the unsaved home sections (debounced 150 ms) through a Server Action whose response carries
 *                the re-rendered page (server components re-render with the draft; scroll and client state stay);
 * - select     → scrolls to and outlines a section; clicks on a section report `select` back; hover outlines;
 * - navigate   → opens another store page in the frame; every route change is reported back.
 * Messages are accepted only from window.parent, from an allowed editor origin (locked to the first one that talks).
 */

const SECTIONS_DEBOUNCE_MS = 150;
const THEME_SYNC_DEBOUNCE_MS = 400;
const HOVER_ID = "sr-preview-hover";
const SELECT_ID = "sr-preview-select";

type Kind = "theme" | "sections" | "navigate";

export interface PreviewBridgeProps {
  /** Editor origin patterns (lib/preview-protocol.ts `editorOrigins`), passed from the server. */
  allowedOrigins: string[];
  locale: string;
  /** When the preview token runs out (ISO). */
  expiresAt: string;
  exitHref: string;
}

export function PreviewBridge({ allowedOrigins, locale, expiresAt, exitHref }: PreviewBridgeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const parentOrigin = React.useRef<string | null>(null);
  const mode = React.useRef<"edit" | "browse">("edit");
  const theme = React.useRef<PreviewTheme | null>(null);
  const selected = React.useRef<string | null>(null);
  const hovered = React.useRef<string | null>(null);
  const timers = React.useRef<Partial<Record<"sections" | "theme", ReturnType<typeof setTimeout>>>>({});
  const pending = React.useRef<{ kind: Kind; at: number } | null>(null);
  const [isPending, startTransition] = React.useTransition();
  const [topLevel, setTopLevel] = React.useState(false);
  // The server sends a new array on every refresh; keep one subscription for the bridge's lifetime.
  const origins = React.useRef(allowedOrigins);
  origins.current = allowedOrigins;

  const post = React.useCallback((m: StoreMessage) => {
    if (parentOrigin.current && window.parent !== window) window.parent.postMessage(m, parentOrigin.current);
  }, []);

  /**
   * Parks the unsaved part server-side and re-renders: one Server Action call whose response carries the new page
   * (server components re-render with the draft; scroll position and client state stay).
   */
  const sync = React.useCallback(
    (body: { home?: unknown; tokens?: unknown }, kind: Kind, at: number) => {
      startTransition(async () => {
        let r: { ok: boolean; status: number };
        try {
          r = await parkPreviewDraft(body);
        } catch (err) {
          return post(storeMessage({ type: "error", code: "draft_failed", message: err instanceof Error ? err.message : "network" }));
        }
        if (r.status === 401 || r.status === 403) return post(storeMessage({ type: "error", code: "expired" }));
        if (!r.ok) return post(storeMessage({ type: "error", code: "draft_failed", message: `HTTP ${r.status}` }));
        pending.current = { kind, at };
      });
    },
    [post],
  );

  const debounce = React.useCallback((key: "sections" | "theme", ms: number, fn: () => void) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(fn, ms);
  }, []);

  // ---------------------------------------------------------------- outlines
  const drawOutlines = React.useCallback(() => {
    const box = (id: string | null) => {
      const el = id ? findSection(document, id) : null;
      return el ? sectionBox(el) : null;
    };
    const edit = mode.current === "edit";
    placeOutline(document, SELECT_ID, edit ? box(selected.current) : null, "selected");
    placeOutline(document, HOVER_ID, edit && hovered.current !== selected.current ? box(hovered.current) : null, "hover");
  }, []);

  const select = React.useCallback(
    (id: string | null, scroll: boolean) => {
      selected.current = id;
      const el = id ? findSection(document, id) : null;
      const box = el && scroll ? sectionBox(el) : null;
      // Below the sticky header (≈ 6rem), not under it.
      if (box) window.scrollTo({ top: Math.max(0, window.scrollY + box.top - 96), behavior: "smooth" });
      drawOutlines();
    },
    [drawOutlines],
  );

  // ---------------------------------------------------------------- messages from the editor
  const onMessage = React.useCallback(
    (m: EditorMessage) => {
      const at = performance.now();
      switch (m.type) {
        case "hello":
          return post(storeMessage({ type: "ready", path: `${location.pathname}${location.search}`, protocol: 1 }));
        case "theme": {
          const next = previewThemeFrom(m.tokens);
          if (!next) return post(storeMessage({ type: "error", code: "bad_message", message: "Invalid brand tokens" }));
          theme.current = next;
          applyPreviewTheme(document, next);
          post(storeMessage({ type: "rendered", kind: "theme", ms: Math.round(performance.now() - at) }));
          // Server-side too, for the variants that change markup rather than CSS.
          return debounce("theme", THEME_SYNC_DEBOUNCE_MS, () => sync({ tokens: next.tokens }, "theme", performance.now()));
        }
        case "theme-reset":
          theme.current = null;
          resetPreviewTheme(document);
          return debounce("theme", 0, () => sync({ tokens: null }, "theme", at));
        case "sections":
          return debounce("sections", SECTIONS_DEBOUNCE_MS, () => sync({ home: { sections: m.sections, ...(m.seo ? { seo: m.seo } : {}) } }, "sections", at));
        case "sections-reset":
          return debounce("sections", 0, () => sync({ home: null }, "sections", at));
        case "select":
          return select(m.id, true);
        case "mode":
          mode.current = m.mode;
          return drawOutlines();
        case "navigate": {
          const path = safePreviewPath(m.path);
          if (!path) return post(storeMessage({ type: "error", code: "bad_message", message: "Path not allowed" }));
          pending.current = { kind: "navigate", at };
          return startTransition(() => router.push(path));
        }
      }
    },
    [debounce, drawOutlines, post, router, select, sync],
  );

  React.useEffect(() => {
    setTopLevel(window.top === window);
    // Talk first when the parent's origin is known and allowed (Chrome/Safari expose it; else wait for `hello`).
    const guess = (location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins?.[0] ?? (document.referrer ? new URL(document.referrer).origin : null);
    if (guess && isAllowedOrigin(guess, origins.current) && window.parent !== window) {
      parentOrigin.current = guess;
      post(storeMessage({ type: "ready", path: `${location.pathname}${location.search}`, protocol: 1 }));
    }
    const listener = (e: MessageEvent) => {
      if (e.source !== window.parent || window.parent === window) return;
      if (parentOrigin.current && e.origin !== parentOrigin.current) return;
      const m = readEditorMessage(e, origins.current);
      if (!m) return;
      parentOrigin.current = e.origin;
      onMessage(m);
    };
    window.addEventListener("message", listener);
    const t = timers.current;
    return () => {
      window.removeEventListener("message", listener);
      clearTimeout(t.sections);
      clearTimeout(t.theme);
    };
  }, [onMessage, post]);

  // ---------------------------------------------------------------- hover / click / scroll
  React.useEffect(() => {
    let frame = 0;
    const redraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(drawOutlines);
    };
    const onMove = (e: MouseEvent) => {
      const id = mode.current === "edit" ? sectionIdOf(e.target) : null;
      if (id !== hovered.current) {
        hovered.current = id;
        redraw();
      }
    };
    const onLeave = () => {
      hovered.current = null;
      redraw();
    };
    const onClick = (e: MouseEvent) => {
      if (mode.current !== "edit") return;
      const id = sectionIdOf(e.target);
      if (!id) return;
      // Links inside a section would leave the page being edited; buttons, sliders and tabs keep working.
      if ((e.target as Element).closest?.("a[href]")) e.preventDefault();
      select(id, false);
      post(storeMessage({ type: "select", sectionId: id }));
    };
    document.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseleave", onLeave);
    document.addEventListener("click", onClick, true);
    window.addEventListener("scroll", redraw, { passive: true, capture: true });
    window.addEventListener("resize", redraw);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("scroll", redraw, true);
      window.removeEventListener("resize", redraw);
    };
  }, [drawOutlines, post, select]);

  // ---------------------------------------------------------------- after a soft refresh / navigation
  React.useEffect(() => {
    if (isPending || !pending.current) return;
    const { kind, at } = pending.current;
    pending.current = null;
    // Re-assert the unsaved look (a re-render may have replaced the root) and the outlines, then report the latency.
    if (theme.current) applyPreviewTheme(document, theme.current);
    requestAnimationFrame(() => {
      drawOutlines();
      post(storeMessage({ type: "rendered", kind, ms: Math.round(performance.now() - at) }));
    });
  }, [isPending, drawOutlines, post]);

  React.useEffect(() => {
    hovered.current = null;
    if (theme.current) applyPreviewTheme(document, theme.current);
    drawOutlines();
    post(storeMessage({ type: "navigate", path: `${pathname}${location.search}` }));
  }, [pathname, drawOutlines, post]);

  // Token ran out: the editor fetches a new one and re-enters.
  React.useEffect(() => {
    const ms = Date.parse(expiresAt) - Date.now();
    if (!Number.isFinite(ms)) return;
    const t = setTimeout(() => post(storeMessage({ type: "error", code: "expired" })), Math.max(0, Math.min(ms, 2 ** 31 - 1)));
    return () => clearTimeout(t);
  }, [expiresAt, post]);

  if (!topLevel) return null;
  const m = previewMessages(locale);
  return (
    <div
      role="status"
      data-sr-preview-ui=""
      className="fixed inset-x-0 bottom-0 z-[70] flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-neutral-950/95 px-4 py-2 text-center text-sm text-white shadow-lg"
    >
      <span>{m.banner}</span>
      <a href={exitHref} className="font-semibold underline underline-offset-2">
        {m.exit}
      </a>
    </div>
  );
}
