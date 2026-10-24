"use client";

import * as React from "react";
import type { AuthUser } from "../types";
import { call, errorMessage as apiErrorMessage } from "./api";
import { useStore } from "./store-context";

/**
 * "Continue with Google" and Firebase phone sign-in for shoppers (docs/firebase-auth.md section 7).
 *
 * Storefronts live on per-shop subdomains and custom domains, which Firebase can't all authorize. So sign-in runs on the
 * landing site (`NEXT_PUBLIC_WWW_URL`, an authorized domain) in a popup. It sends back a single-use handoff code with
 * `postMessage` (the API only issues it for this shop's own origin), and the store redeems it through its own API path:
 * the session is created for the store origin. Where popups don't work (blocked, small phones) the page navigates to the
 * landing site and comes back with `?handoff=` instead.
 */

/** The landing site (resolved at build time, like the shop apps' NEXT_PUBLIC_WWW_URL). */
export const WWW_URL = (process.env.NEXT_PUBLIC_WWW_URL || "http://localhost:3005").replace(/\/+$/, "");
const WWW_ORIGIN = (() => {
  try {
    return new URL(WWW_URL).origin;
  } catch {
    return "http://localhost:3005";
  }
})();

export const HANDOFF_MESSAGE = "sr-handoff";

export type ShopperMethod = "sms" | "whatsapp" | "email_code" | "google" | "password";
interface AuthConfig {
  phone?: { method?: string };
  testTargets?: string[];
  /** The methods this shop offers its customers, preferred first (absent on an older API: the old behaviour). */
  signIn?: { methods: ShopperMethod[]; default: ShopperMethod };
}

/** What shoppers could do before shops chose their own options (an older API, or the config call failed). */
export const LEGACY_SHOPPER_METHODS: ShopperMethod[] = ["google", "sms", "email_code"];
let configPromise: Promise<AuthConfig | null> | null = null;
/** `GET /auth/config` once per page; null when it fails (the plain OTP flow then stays). */
export function loadAuthConfig(): Promise<AuthConfig | null> {
  configPromise ??= call<AuthConfig>("/auth/config", { auth: false, query: { audience: "customer" } }).catch(() => {
    configPromise = null;
    return null;
  });
  return configPromise;
}

/** Same rule as the API's test identities (exact values or `*` patterns; a bare `*` never matches). */
export function isTestTarget(target: string, patterns: readonly string[] = []): boolean {
  const value = target.trim().toLowerCase();
  return patterns.some((raw) => {
    const p = raw.trim().toLowerCase();
    if (!p || p === "*") return false;
    if (!p.includes("*")) return p === value;
    return new RegExp(`^${p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(value);
  });
}

/** The landing site's page for this shop; `origin` is only a claim, the API checks it against the shop's own addresses. */
export function centralSignInUrl(o: { shop: string; mode: "popup" | "redirect"; locale: string; phone?: string; returnUrl?: string; method?: "google" | "password" }): string {
  const u = new URL("/auth/store", WWW_URL);
  u.searchParams.set("shop", o.shop);
  u.searchParams.set("origin", window.location.origin);
  u.searchParams.set("mode", o.mode);
  if (o.locale) u.searchParams.set("lang", o.locale);
  if (o.phone) u.searchParams.set("phone", o.phone);
  if (o.method) u.searchParams.set("method", o.method);
  if (o.returnUrl) u.searchParams.set("return", o.returnUrl);
  return u.toString();
}

/** Redeems a handoff code on this origin: the API answers with a session for the store (token + user). */
export function redeemHandoff(code: string): Promise<{ token: string; user: AuthUser }> {
  return call<{ token: string; user: AuthUser }>("/auth/handoff/redeem", { body: { code }, auth: false });
}

/** The current page without `handoff`, to come back to after a redirect sign-in. */
function returnHere(): string {
  const u = new URL(window.location.href);
  u.searchParams.delete("handoff");
  u.hash = "";
  return u.toString();
}

/**
 * Sign-in through the landing site. `available` is true when the API verifies phones / Google with Firebase.
 * `start` opens the popup (call it from a click) and resolves once the shopper is signed in on this store.
 */
export function useCentralSignIn(onSignedIn?: (user: AuthUser) => void) {
  const { auth, shell, locale, t } = useStore();
  const [available, setAvailable] = React.useState(false);
  const [testTargets, setTestTargets] = React.useState<string[]>([]);
  /** The shop's customer sign-in methods, preferred first; null until the config is in (or when it failed). */
  const [methods, setMethods] = React.useState<ShopperMethod[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const cleanup = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    let alive = true;
    void loadAuthConfig().then((c) => {
      if (!alive || !c) return;
      setAvailable(c.phone?.method === "firebase" && !!shell.slug);
      setTestTargets(c.testTargets ?? []);
      setMethods(c.signIn?.methods ?? LEGACY_SHOPPER_METHODS);
    });
    return () => {
      alive = false;
      cleanup.current?.();
    };
  }, [shell.slug]);

  const start = React.useCallback(
    (opts: { phone?: string; method?: "google" | "password" } = {}) => {
      if (busy) return;
      setError(null);
      const common = { shop: shell.slug, locale, phone: opts.phone, method: opts.method };
      const popup = window.open(centralSignInUrl({ ...common, mode: "popup" }), "sr-sign-in", "popup=yes,width=480,height=760");
      if (!popup) {
        // Popup blocked: go there in this tab and come back with ?handoff=.
        window.location.assign(centralSignInUrl({ ...common, mode: "redirect", returnUrl: returnHere() }));
        return;
      }
      setBusy(true);
      let finished = false;
      const stop = () => {
        finished = true;
        window.removeEventListener("message", onMessage);
        window.clearInterval(timer);
        cleanup.current = null;
      };
      const onMessage = (e: MessageEvent) => {
        // Strict: only the landing site's window, from the landing site's origin, with our message shape.
        if (e.origin !== WWW_ORIGIN || e.source !== popup) return;
        const d = e.data as { type?: unknown; code?: unknown } | null;
        if (!d || d.type !== HANDOFF_MESSAGE || typeof d.code !== "string" || d.code.length < 16 || d.code.length > 128) return;
        stop();
        redeemHandoff(d.code)
          .then(async (r) => {
            await auth.signIn(r.token, r.user);
            onSignedIn?.(r.user);
          })
          .catch((err) => setError(apiErrorMessage(err, t)))
          .finally(() => setBusy(false));
      };
      window.addEventListener("message", onMessage);
      // Closed without signing in: stop waiting (a short grace lets a message that is already on its way arrive first).
      const timer = window.setInterval(() => {
        if (!popup.closed || finished) return;
        window.setTimeout(() => {
          if (finished) return;
          stop();
          setBusy(false);
        }, 800);
        window.clearInterval(timer);
      }, 500);
      cleanup.current = stop;
    },
    [auth, busy, locale, onSignedIn, shell.slug, t],
  );

  return { available, testTargets, methods, busy, error, start };
}
