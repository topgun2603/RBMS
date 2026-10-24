"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { DownloadIcon, ShareIcon, SquarePlusIcon, XIcon } from "lucide-react";
import { INSTALL_DISMISS_KEY, INSTALL_VIEWS_KEY, installUi, isIosSafari, isQuietPath } from "../lib/pwa";
import { useStore } from "./store-context";

/**
 * Installable storefront, browser side (rendered once by StoreLayout):
 * - registers /sw.js in production builds (when the browser supports service workers);
 * - when a new worker takes over after a deploy, the next navigation is a full page load (never on cart / checkout /
 *   order pages, so a payment in progress is never interrupted);
 * - the "Install <shop> app" banner (Android / Chrome `beforeinstallprompt`) or, on iOS Safari, a short
 *   "Share → Add to Home Screen" card, after the shopper has seen 2 pages; dismissal is remembered for 30 days.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    /** Captured by PWA_EARLY_SCRIPT before React hydrates (the event can fire very early). */
    __srInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function read(kind: "local" | "session", key: string): string | null {
  try {
    return storage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(kind: "local" | "session", key: string, value: string): void {
  try {
    storage(kind)?.setItem(key, value);
  } catch {
    /* storage off (private mode): the banner just forgets */
  }
}

function isStandalone(): boolean {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** Registers the worker and turns "a new version is active" into a full load on the next (non-checkout) navigation. */
function useServiceWorker() {
  const pathname = usePathname();
  const updateReady = React.useRef(false);
  const lastGesture = React.useRef(0);

  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext) return;
    const sw = navigator.serviceWorker;
    // First install also fires controllerchange (clients.claim); only a replaced worker means "new version".
    const hadController = !!sw.controller;
    const onControllerChange = () => {
      if (hadController) updateReady.current = true;
    };
    sw.addEventListener("controllerchange", onControllerChange);

    // A link click after an update: go there with a full load instead of a client transition.
    const onClick = (e: MouseEvent) => {
      if (!updateReady.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || isQuietPath(url.pathname)) return;
      e.preventDefault();
      updateReady.current = false;
      window.location.assign(url.href);
    };
    document.addEventListener("click", onClick, true);
    // Only a shopper's own navigation may swap to the new version; a page that moves by itself never reloads.
    const onGesture = () => {
      lastGesture.current = Date.now();
    };
    for (const ev of ["pointerdown", "keydown", "touchstart"]) document.addEventListener(ev, onGesture, { capture: true, passive: true });

    let reg: ServiceWorkerRegistration | null = null;
    const register = () => {
      sw.register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((r) => {
          reg = r;
        })
        .catch(() => {
          /* blocked (privacy settings) or offline: the store works without it */
        });
    };
    // Check for a new worker when the shopper comes back to the tab.
    const onVisible = () => {
      if (document.visibilityState === "visible") reg?.update().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => {
      sw.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("click", onClick, true);
      for (const ev of ["pointerdown", "keydown", "touchstart"]) document.removeEventListener(ev, onGesture, true);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("load", register);
    };
  }, []);

  // Programmatic navigations (router.push) the shopper started: reload the page we landed on, unless it's a quiet (checkout) page.
  React.useEffect(() => {
    if (!updateReady.current || isQuietPath(pathname)) return;
    if (Date.now() - lastGesture.current > 5000) return;
    updateReady.current = false;
    window.location.reload();
  }, [pathname]);
}

function InstallBanner() {
  const { t, shell } = useStore();
  const pathname = usePathname();
  const [prompt, setPrompt] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [env, setEnv] = React.useState<{ standalone: boolean; ios: boolean } | null>(null);
  const [views, setViews] = React.useState(0);
  const [dismissedAt, setDismissedAt] = React.useState<number | null>(null);
  const [hidden, setHidden] = React.useState(false);

  React.useEffect(() => {
    setEnv({ standalone: isStandalone(), ios: isIosSafari(navigator.userAgent, navigator.maxTouchPoints ?? 0) });
    const d = Number(read("local", INSTALL_DISMISS_KEY));
    setDismissedAt(Number.isFinite(d) && d > 0 ? d : null);
    if (window.__srInstallPrompt) setPrompt(window.__srInstallPrompt);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      window.__srInstallPrompt = e as BeforeInstallPromptEvent;
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      window.__srInstallPrompt = null;
      setPrompt(null);
      setHidden(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Pages seen this visit (each distinct navigation counts once).
  React.useEffect(() => {
    const n = (Number(read("session", INSTALL_VIEWS_KEY)) || 0) + 1;
    write("session", INSTALL_VIEWS_KEY, String(n));
    setViews(n);
  }, [pathname]);

  if (!env || hidden) return null;
  const ui = installUi({
    enabled: true,
    pathname,
    pagesViewed: views,
    dismissedAt,
    now: Date.now(),
    standalone: env.standalone,
    canPrompt: !!prompt,
    ios: env.ios,
  });
  if (ui === "none") return null;

  const dismiss = () => {
    const now = Date.now();
    write("local", INSTALL_DISMISS_KEY, String(now));
    setDismissedAt(now);
  };
  const install = async () => {
    if (!prompt) return;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      // A prompt can be used once; "dismissed" in the browser dialog counts as "not now".
      window.__srInstallPrompt = null;
      setPrompt(null);
      if (choice.outcome === "dismissed") dismiss();
    } catch {
      setPrompt(null);
    }
  };
  const lifted = pathname.startsWith("/p/");
  const title = ui === "ios" ? t("pwa.ios.title", { name: shell.name }) : t("pwa.install.title", { name: shell.name });

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={title}
      data-testid="pwa-install"
      data-variant={ui}
      className={`fixed left-4 right-4 z-40 max-w-[calc(100vw-2rem)] sm:right-auto sm:w-[22rem] ${lifted ? "bottom-24 lg:bottom-6" : "bottom-5 sm:bottom-6"} rounded-[calc(var(--radius)+0.25rem)] border bg-card p-4 text-card-foreground shadow-[var(--elevation-2)]`}
    >
      <div className="flex items-start gap-3">
        {/* The shop's own app icon (logo or lettermark), the same one the home screen will show. */}
        <img src="/app-icon/192.png" alt="" width={40} height={40} className="size-10 shrink-0 rounded-[0.6rem]" />

        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug">{title}</p>
          {ui === "prompt" ? (
            <p className="mt-1 text-sm text-muted-foreground">{t("pwa.install.body")}</p>
          ) : (
            <ol className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <ShareIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>{t("pwa.ios.step1")}</span>
              </li>
              <li className="flex gap-2">
                <SquarePlusIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>{t("pwa.ios.step2")}</span>
              </li>
              <li className="flex gap-2">
                <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center text-xs font-bold text-primary" aria-hidden>
                  3
                </span>
                <span>{t("pwa.ios.step3")}</span>
              </li>
            </ol>
          )}
        </div>
        <button type="button" onClick={dismiss} aria-label={t("pwa.install.close")} className="-m-1 rounded-full p-1 text-muted-foreground hover:text-foreground focus-ring">
          <XIcon className="size-4" />
        </button>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        {ui === "prompt" ? (
          <>
            <button type="button" onClick={dismiss} className="rounded-[var(--sf-button-radius,999px)] px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-ring">
              {t("pwa.install.later")}
            </button>
            <button
              type="button"
              onClick={install}
              data-testid="pwa-install-button"
              className="inline-flex items-center gap-1.5 rounded-[var(--sf-button-radius,999px)] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-ring"
            >
              <DownloadIcon className="size-4" aria-hidden />
              {t("pwa.install.cta")}
            </button>
          </>
        ) : (
          <button type="button" onClick={dismiss} className="rounded-[var(--sf-button-radius,999px)] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-ring">
            {t("pwa.ios.done")}
          </button>
        )}
      </div>
    </div>
  );
}

/** Service worker + install banner. `installBanner`: the shop's "Show install app banner" setting. */
export function PwaClient({ installBanner }: { installBanner: boolean }) {
  useServiceWorker();
  return installBanner ? <InstallBanner /> : null;
}
