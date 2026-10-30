"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLinkIcon, LoaderIcon, MonitorIcon, RefreshCwIcon, SmartphoneIcon, TabletIcon, TriangleAlertIcon } from "lucide-react";
import { Button, cn } from "@rbms/ui";
import { api, useI18n, useTenantSlug } from "@rbms/web";
import { storeUrlFor } from "../lib/store-url";
import { LivePreviewFrame } from "./live-preview-frame";
import { liveMessages } from "./live-preview-messages";
import {
  cleanPath,
  editorMessage,
  enterUrl,
  originOf,
  PREVIEW_PROTOCOL_VERSION,
  readStoreMessage,
  type EditorMessage,
  type PreviewDevice,
} from "./live-preview-protocol";

/*
 * The real store, live, inside the editor: an iframe of the shop's storefront in preview mode (a 30-minute token from
 * POST /v1/cms/preview-token), driven over postMessage. Unsaved `tokens` restyle it instantly; unsaved `sections`
 * re-render the home in place (~a few hundred ms, no reload); clicking a section reports it via `onSelect`; the
 * shopper-facing pages (product, category…) open inside the frame and are reported via `onNavigate`.
 */

export interface LivePreviewProps {
  /** Store origin, e.g. "http://anbu.localhost:3003". Default: the current shop's store address. */
  storeOrigin?: string;
  /** Page to show (controlled when `onNavigate` is given). Default "/". */
  path?: string;
  onNavigate?: (path: string) => void;
  /** Device width; uncontrolled (starts on `defaultDevice`) when `onDevice` isn't given. */
  device?: PreviewDevice;
  defaultDevice?: PreviewDevice;
  onDevice?: (d: PreviewDevice) => void;
  /** Unsaved brand tokens (see live-preview-drafts.ts `appearanceTokens` / `brandTokens`); null/undefined = saved look. */
  tokens?: Record<string, unknown> | null;
  /** Unsaved home sections with ids (`previewSections(items)`); null/undefined = the saved draft. */
  sections?: readonly Record<string, unknown>[] | null;
  seo?: Record<string, unknown>;
  /** Section to outline/scroll to (a preview section id). */
  selectedId?: string | null;
  onSelect?: (sectionId: string) => void;
  /** edit: outlines + click to select (default) · browse: the plain store. */
  mode?: "edit" | "browse";
  /** Each finished update (kind + ms from message to new UI). */
  onRendered?: (e: { kind: "theme" | "sections" | "navigate"; ms: number }) => void;
  /** Extra controls at the end of the toolbar. */
  toolbarEnd?: React.ReactNode;
  className?: string;
}

const READY_TIMEOUT_MS = 20_000;
const PROBE_TIMEOUT_MS = 8_000;

/**
 * Whether anything answers at the store origin (an opaque no-cors GET: any HTTP answer counts, only a network failure
 * doesn't). A slow answer counts as up — the ready timeout covers that case.
 */
export async function probeStore(origin: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const tm = setTimeout(() => ctl?.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetcher(`${origin}/favicon.svg`, { mode: "no-cors", cache: "no-store", credentials: "omit", signal: ctl?.signal });
    return true;
  } catch (err) {
    return err instanceof DOMException && err.name === "AbortError";
  } finally {
    clearTimeout(tm);
  }
}

interface TokenResponse {
  token: string;
  expiresAt: string;
  ttlSeconds: number;
}

/** A preview token for the current shop, renewed a minute before it runs out. */
export function usePreviewToken(enabled = true) {
  const slug = useTenantSlug();
  return useQuery({
    queryKey: ["site", "preview-token", slug],
    enabled: enabled && !!slug,
    queryFn: () => api.post<TokenResponse>("/cms/preview-token"),
    staleTime: Infinity,
    gcTime: 0,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchInterval: (q) => {
      const exp = q.state.data ? Date.parse(q.state.data.expiresAt) : NaN;
      return Number.isFinite(exp) ? Math.max(30_000, exp - Date.now() - 60_000) : false;
    },
  });
}

const DEVICES: { id: PreviewDevice; icon: typeof SmartphoneIcon; key: "phone" | "tablet" | "desktop" }[] = [
  { id: "phone", icon: SmartphoneIcon, key: "phone" },
  { id: "tablet", icon: TabletIcon, key: "tablet" },
  { id: "desktop", icon: MonitorIcon, key: "desktop" },
];

export function LivePreview({
  storeOrigin: originProp,
  path = "/",
  onNavigate,
  device: deviceProp,
  defaultDevice = "phone",
  onDevice,
  tokens,
  sections,
  seo,
  selectedId = null,
  onSelect,
  mode = "edit",
  onRendered,
  toolbarEnd,
  className,
}: LivePreviewProps) {
  const { locale } = useI18n();
  const t = liveMessages(locale);
  const slug = useTenantSlug();
  const storeOrigin = originProp ?? (slug ? originOf(storeUrlFor(slug, "/")) : null);
  const tokenQ = usePreviewToken(!!storeOrigin);
  const token = tokenQ.data?.token ?? null;

  const [ownDevice, setOwnDevice] = React.useState<PreviewDevice>(defaultDevice);
  const device = deviceProp ?? ownDevice;
  const setDevice = (d: PreviewDevice) => (onDevice ? onDevice(d) : setOwnDevice(d));

  const frame = React.useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = React.useState(false);
  const [problem, setProblem] = React.useState<"error" | "errorExpired" | "errorDraft" | "errorVersion" | null>(null);
  const [lastMs, setLastMs] = React.useState<number | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  // Where the frame is now (follows in-frame navigation without reloading it).
  const current = React.useRef(cleanPath(path));
  // What the store has been sent (JSON), so unchanged props aren't re-posted.
  const sent = React.useRef<{ theme?: string; sections?: string; select?: string | null; mode?: string }>({});

  // The frame URL changes only with a new token / store / reload; `path` changes go over postMessage.
  const src = React.useMemo(
    () => (storeOrigin && token ? enterUrl(storeOrigin, token, current.current) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storeOrigin, token, reloadKey],
  );
  React.useEffect(() => {
    setReady(false);
    setProblem(null);
    sent.current = {};
  }, [src]);

  const post = React.useCallback(
    (m: EditorMessage) => {
      const w = frame.current?.contentWindow;
      if (w && storeOrigin) w.postMessage(editorMessage(m), storeOrigin);
    },
    [storeOrigin],
  );

  // ---------------------------------------------------------------- push state to the store
  const latest = React.useRef({ tokens, sections, seo, selectedId, mode });
  latest.current = { tokens, sections, seo, selectedId, mode };

  const pushState = React.useCallback(() => {
    const s = latest.current;
    const modeKey = s.mode;
    if (sent.current.mode !== modeKey) {
      post({ type: "mode", mode: s.mode });
      sent.current.mode = modeKey;
    }
    const themeKey = s.tokens ? JSON.stringify(s.tokens) : "";
    if (sent.current.theme !== themeKey) {
      if (s.tokens) post({ type: "theme", tokens: s.tokens });
      else if (sent.current.theme) post({ type: "theme-reset" });
      sent.current.theme = themeKey;
    }
    const sectionsKey = s.sections ? JSON.stringify([s.sections, s.seo ?? null]) : "";
    if (sent.current.sections !== sectionsKey) {
      if (s.sections) post({ type: "sections", sections: s.sections as Record<string, unknown>[], ...(s.seo ? { seo: s.seo } : {}) });
      else if (sent.current.sections) post({ type: "sections-reset" });
      sent.current.sections = sectionsKey;
    }
    if (sent.current.select !== s.selectedId) {
      post({ type: "select", id: s.selectedId });
      sent.current.select = s.selectedId;
    }
  }, [post]);

  // Theme drags fire many changes: one post per animation frame is plenty (the store applies them without network).
  React.useEffect(() => {
    if (!ready) return;
    const f = requestAnimationFrame(pushState);
    return () => cancelAnimationFrame(f);
  }, [ready, tokens, sections, seo, selectedId, mode, pushState]);

  // Controlled path: navigate inside the frame.
  React.useEffect(() => {
    const p = cleanPath(path);
    if (ready && p !== current.current) {
      current.current = p;
      post({ type: "navigate", path: p });
    }
  }, [path, ready, post]);

  // ---------------------------------------------------------------- messages from the store
  const handlers = React.useRef({ onSelect, onNavigate, onRendered });
  handlers.current = { onSelect, onNavigate, onRendered };
  React.useEffect(() => {
    if (!storeOrigin) return;
    const listener = (e: MessageEvent) => {
      const m = readStoreMessage(e, frame.current?.contentWindow, storeOrigin);
      if (!m) return;
      switch (m.type) {
        case "ready":
          if (m.protocol !== PREVIEW_PROTOCOL_VERSION) return setProblem("errorVersion");
          setProblem(null);
          // A (re)loaded page knows nothing yet: send everything.
          sent.current = {};
          setReady(true);
          requestAnimationFrame(pushState);
          return;
        case "select":
          return handlers.current.onSelect?.(m.sectionId);
        case "navigate": {
          const p = cleanPath(m.path);
          current.current = p;
          return handlers.current.onNavigate?.(p);
        }
        case "rendered":
          setLastMs(m.ms);
          return handlers.current.onRendered?.({ kind: m.kind, ms: m.ms });
        case "error":
          if (m.code === "expired") {
            void tokenQ.refetch();
            return setProblem("errorExpired");
          }
          if (m.code === "draft_failed") return setProblem("errorDraft");
          return;
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [storeOrigin, pushState, tokenQ]);

  // The bridge answers `hello` with `ready` (in case it couldn't tell the parent's origin itself).
  const onLoad = React.useCallback(() => post({ type: "hello" }), [post]);
  React.useEffect(() => {
    if (!src || ready) return;
    const tm = setTimeout(() => setProblem((p) => p ?? "error"), READY_TIMEOUT_MS);
    return () => clearTimeout(tm);
  }, [src, ready]);
  // A store that isn't answering at all (server down, wrong address) shows the browser's error page in the frame, which
  // never says `ready`: probe the origin once so the editor says so at once instead of spinning for 20 s.
  React.useEffect(() => {
    if (!src || !storeOrigin) return;
    let live = true;
    void probeStore(storeOrigin).then((up) => {
      if (live && !up) setProblem((p) => p ?? "error");
    });
    return () => {
      live = false;
    };
  }, [src, storeOrigin]);

  const reload = () => {
    setReloadKey((k) => k + 1);
    if (problem === "errorExpired" || tokenQ.isError) void tokenQ.refetch();
  };
  const openHref = storeOrigin && token ? enterUrl(storeOrigin, token, current.current) : null;
  const failed = tokenQ.isError || problem === "error" || problem === "errorVersion" || problem === "errorExpired";
  const seg = (on: boolean) =>
    cn(
      "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
      on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)} data-testid="live-preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg bg-muted p-0.5" role="radiogroup" aria-label={t("device")}>
          {DEVICES.map(({ id, icon: Icon, key }) => (
            <button key={id} type="button" role="radio" aria-checked={device === id} className={seg(device === id)} onClick={() => setDevice(id)}>
              <Icon className="size-3.5" /> <span className="max-sm:sr-only">{t(key)}</span>
            </button>
          ))}
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <p className="min-w-0 truncate text-xs text-muted-foreground" aria-live="polite">
            {problem === "errorDraft" ? t("errorDraft") : lastMs !== null ? t("updated", { ms: lastMs }) : t("live")}
          </p>
          <Button type="button" variant="ghost" size="icon-sm" onClick={reload} aria-label={t("reload")} title={t("reload")}>
            <RefreshCwIcon />
          </Button>
          {openHref && (
            <Button asChild variant="ghost" size="icon-sm" title={t("openTab")}>
              <a href={openHref} target="_blank" rel="noopener" aria-label={t("openTab")}>
                <ExternalLinkIcon />
              </a>
            </Button>
          )}
          {toolbarEnd}
        </div>
      </div>
      <LivePreviewFrame key={src ?? "none"} ref={frame} src={failed ? null : src} device={device} title={t("frameTitle")} onLoad={onLoad} className="min-h-[480px] flex-1">
        {!failed && !ready && (
          <div className="absolute inset-0 grid place-items-center bg-background/70 text-sm text-muted-foreground" role="status">
            <span className="inline-flex items-center gap-2">
              <LoaderIcon className="size-4 animate-spin motion-reduce:animate-none" /> {t("loading")}
            </span>
          </div>
        )}
        {(failed || !storeOrigin) && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center" role="alert">
            <div className="grid max-w-xs justify-items-center gap-3 text-sm">
              <TriangleAlertIcon className="size-6 text-warning" />
              <p>{!storeOrigin ? t("errorNoStore") : problem === "errorVersion" ? t("errorVersion") : problem === "errorExpired" ? t("errorExpired") : t("error")}</p>
              {storeOrigin && (
                <Button type="button" size="sm" variant="outline" onClick={reload}>
                  {t("retry")}
                </Button>
              )}
            </div>
          </div>
        )}
      </LivePreviewFrame>
    </div>
  );
}
