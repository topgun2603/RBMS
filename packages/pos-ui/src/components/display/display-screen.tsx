"use client";

import * as React from "react";
import { Loader2Icon, MonitorIcon } from "lucide-react";
import { Button, Input } from "@rbms/ui";
import { absoluteUrl, useTenantSlug } from "@rbms/web";
import { DISPLAY_TEXT, displayChannelName, type DisplayState } from "../../lib/display";
import {
  DisplayHttpError,
  fetchDisplayConfig,
  pairDisplay,
  readDisplayFeed,
  readDisplayToken,
  stateFromMessage,
  writeDisplayToken,
  type DisplayConfig,
} from "../../lib/display-client";
import { CustomerDisplay, NO_IDLE, type IdleContent } from "./customer-display";

/**
 * The page a second monitor or tablet opens (`/pos/display`). Two ways to be fed:
 * - `?local=<register>`: a tab on the counter's own PC, fed by a BroadcastChannel (nothing to pair, nothing on the server);
 * - otherwise a paired screen: a 6-digit code from the counter trades for a display token kept in this browser, and the
 *   screen reads that register's feed from the server. It has no account and can only see that one register's bill.
 */

const RETRY_MS = 3000;
const CONFIG_REFRESH_MS = 5 * 60_000;

const idleState = (locale: "en" | "ta" = "en", shop: DisplayState["shop"] = null): DisplayState => ({
  phase: "idle",
  lines: [],
  more: 0,
  itemCount: 0,
  total: 0,
  savings: 0,
  customerName: null,
  upi: null,
  paid: null,
  locale,
  shop,
  at: 0,
});

export function DisplayScreen() {
  const tenant = useTenantSlug() ?? null;
  const [local, setLocal] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("local");
    setLocal(q ? q : null);
  }, []);
  if (local === undefined) return null;
  return local ? <LocalDisplay tenant={tenant} register={local} /> : <PairedDisplay tenant={tenant} />;
}

/** Keeps the page fullscreen-friendly and the screen awake while it runs. */
function useKioskPage() {
  React.useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const wake = () => {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
      nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    };
    wake();
    const onVisible = () => document.visibilityState === "visible" && wake();
    document.addEventListener("visibilitychange", onVisible);
    document.body.style.cursor = "none";
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      document.body.style.cursor = "";
      void lock?.release().catch(() => undefined);
    };
  }, []);
}

function LocalDisplay({ tenant, register }: { tenant: string | null; register: string }) {
  useKioskPage();
  const [state, setState] = React.useState<DisplayState>(() => idleState());
  React.useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(displayChannelName(tenant, register));
    ch.onmessage = (e: MessageEvent) => {
      const m = e.data as { type?: string; state?: unknown } | null;
      if (m?.type !== "state") return;
      const s = stateFromMessage(JSON.stringify(m.state));
      if (s) setState((cur) => (s.at >= cur.at ? s : cur));
    };
    ch.postMessage({ type: "hello" });
    return () => ch.close();
  }, [tenant, register]);
  return <CustomerDisplay state={state} idle={{ ...NO_IDLE, slides: state.slides ?? [] }} brandLogo={null} />;
}

function PairedDisplay({ tenant }: { tenant: string | null }) {
  const [token, setToken] = React.useState<string | null | undefined>(undefined);
  const [revoked, setRevoked] = React.useState(false);
  React.useEffect(() => setToken(readDisplayToken(tenant)), [tenant]);
  if (token === undefined) return null;
  if (!token) {
    return (
      <PairForm
        revoked={revoked}
        onPaired={(t) => {
          writeDisplayToken(tenant, t);
          setRevoked(false);
          setToken(t);
        }}
      />
    );
  }
  return (
    <Feed
      token={token}
      onRevoked={() => {
        writeDisplayToken(tenant, null);
        setRevoked(true);
        setToken(null);
      }}
    />
  );
}

function PairForm({ onPaired, revoked }: { onPaired: (token: string) => void; revoked: boolean }) {
  const w = DISPLAY_TEXT.en;
  const wt = DISPLAY_TEXT.ta;
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<"wrong" | "tooMany" | null>(null);
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6">
      <form
        className="grid w-full max-w-md gap-4 rounded-2xl border p-8 text-center"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || code.length !== 6) return;
          setBusy(true);
          setError(null);
          try {
            const r = await pairDisplay(code);
            onPaired(r.token);
          } catch (err) {
            setError(err instanceof DisplayHttpError && err.status === 429 ? "tooMany" : "wrong");
          } finally {
            setBusy(false);
          }
        }}
      >
        <MonitorIcon className="mx-auto size-10 text-primary" />
        <h1 className="text-2xl font-bold">
          {w.pairTitle} · {wt.pairTitle}
        </h1>
        <p className="text-sm text-muted-foreground">{w.pairBody}</p>
        <p className="text-sm text-muted-foreground">{wt.pairBody}</p>
        {revoked && <p className="text-sm text-destructive">{w.revoked}</p>}
        <Input
          autoFocus
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder={w.pairCode}
          aria-label={w.pairCode}
          className="h-16 text-center text-3xl tracking-[0.4em]"
        />
        <p className="min-h-5 text-sm text-destructive" aria-live="polite">
          {error === "wrong" ? `${w.pairWrong} ${wt.pairWrong}` : error === "tooMany" ? `${w.pairTooMany} ${wt.pairTooMany}` : ""}
        </p>
        <Button type="submit" size="lg" disabled={busy || code.length !== 6}>
          {busy && <Loader2Icon className="animate-spin" />} {busy ? w.pairBusy : `${w.pairButton} · ${wt.pairButton}`}
        </Button>
      </form>
    </div>
  );
}

function Feed({ token, onRevoked }: { token: string; onRevoked: () => void }) {
  useKioskPage();
  const [state, setState] = React.useState<DisplayState>(() => idleState());
  const [config, setConfig] = React.useState<DisplayConfig | null>(null);
  const [offline, setOffline] = React.useState(false);
  const revokedRef = React.useRef(onRevoked);
  revokedRef.current = onRevoked;

  // Shop, idle messages and photos: on start and every few minutes.
  React.useEffect(() => {
    let stop = false;
    const load = () =>
      fetchDisplayConfig(token)
        .then((c) => !stop && setConfig(c))
        .catch((err) => {
          if (err instanceof DisplayHttpError && err.status === 401) revokedRef.current();
        });
    void load();
    const id = window.setInterval(load, CONFIG_REFRESH_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [token]);

  // The register's feed, reconnecting by itself.
  React.useEffect(() => {
    const ctl = new AbortController();
    let timer: number | undefined;
    const run = async () => {
      try {
        await readDisplayFeed(
          token,
          (m) => {
            if (m.event === "ready") setOffline(false);
            else if (m.event === "revoked") revokedRef.current();
            else if (m.event === "state") {
              const s = stateFromMessage(m.data);
              if (s) setState((cur) => (s.at >= cur.at ? s : cur));
            }
          },
          ctl.signal,
        );
      } catch (err) {
        if (ctl.signal.aborted) return;
        if (err instanceof DisplayHttpError && err.status === 401) return revokedRef.current();
      }
      if (ctl.signal.aborted) return;
      setOffline(true);
      timer = window.setTimeout(() => void run(), RETRY_MS);
    };
    void run();
    return () => {
      ctl.abort();
      window.clearTimeout(timer);
    };
  }, [token]);

  const idle = React.useMemo<IdleContent>(
    () =>
      config
        ? {
            ...config.messages,
            slides: config.slides.map((s) => ({ ...s, image: absoluteUrl(s.image) ?? s.image })),
            slideSeconds: config.display.settings.slideSeconds ?? 8,
          }
        : NO_IDLE,
    [config],
  );
  const language = config?.display.settings.language;
  const shown: DisplayState = {
    ...state,
    locale: language === "en" || language === "ta" ? language : state.locale,
    shop: state.shop ?? (config?.shop.name ? { name: config.shop.name, logoUrl: config.shop.logoUrl ? (absoluteUrl(config.shop.logoUrl) ?? null) : null } : null),
  };
  return <CustomerDisplay state={shown} idle={idle} brandLogo={null} offline={offline} />;
}
