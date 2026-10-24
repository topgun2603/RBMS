"use client";

import * as React from "react";
import { Loader2Icon, ShieldAlertIcon } from "lucide-react";
import { Button } from "@srirealtime/ui/components/button";
import { Card } from "@srirealtime/ui/components/card";
import { Skeleton } from "@srirealtime/ui/components/skeleton";
import {
  firebasePhoneMessage,
  firebaseWebConfig,
  isFirebaseError,
  loadAuthConfig,
  signInWithGoogle,
} from "@srirealtime/web/firebase-phone";
import { api, errorMessage, normalizeTarget } from "@/lib/api";
import { useSite } from "./site-context";
import { OtpSignIn } from "./otp-sign-in";

interface Trip {
  shop: string;
  origin: string;
  mode: "popup" | "redirect";
  returnUrl: string | null;
  /** A number the shop already collected (E.164): prefilled. */
  phone: string;
}

/** `?shop=&origin=&mode=&return=`; the API decides whether the origin really is the shop's. */
function tripFromUrl(): Trip | null {
  const q = new URLSearchParams(window.location.search);
  const shop = (q.get("shop") ?? "").trim().toLowerCase();
  const origin = (q.get("origin") ?? "").trim();
  if (!shop || !origin) return null;
  return { shop, origin, mode: q.get("mode") === "redirect" ? "redirect" : "popup", returnUrl: q.get("return"), phone: normalizeTarget(q.get("phone") ?? "")?.replace(/^\+91/, "") ?? "" };
}

const GoogleG = () => (
  <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
    <path fill="#FBBC05" d="M10.5 28.6a14.5 14.5 0 0 1 0-9.2l-7.9-6.2a24 24 0 0 0 0 21.6l7.9-6.2z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.2C6.5 42.6 14.6 48 24 48z" />
  </svg>
);

/**
 * Shopper sign-in for a storefront, on the landing site (an authorized Firebase domain). Google or phone (Firebase), then
 * a single-use handoff code goes back to the storefront: `postMessage` to the opener in popup mode, or a redirect to
 * `<return>?handoff=` otherwise. The destination comes from the API's answer, never from the query string.
 */
export function StoreSignIn() {
  const { t, locale } = useSite();
  const [phase, setPhase] = React.useState<"loading" | "invalid" | "ready" | "returning" | "closed">("loading");
  const [trip, setTrip] = React.useState<Trip | null>(null);
  const [shopName, setShopName] = React.useState("");
  const [origin, setOrigin] = React.useState("");
  const [google, setGoogle] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const tr = tripFromUrl();
    setTrip(tr);
    if (!tr) return setPhase("invalid");
    let alive = true;
    (async () => {
      try {
        const ctx = await api.storeContext(tr.shop, tr.origin);
        if (!alive) return;
        if (!ctx.origin) return setPhase("invalid");
        setShopName(ctx.shop.name);
        setOrigin(ctx.origin);
        const web = firebaseWebConfig();
        const cfg = web ? await loadAuthConfig(api.authConfig) : null;
        if (!alive) return;
        setGoogle(!!web && cfg?.phone.method === "firebase" && cfg.phone.firebaseProjectId === web.projectId);
        setPhase("ready");
      } catch {
        if (alive) setPhase("invalid");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** Signed in here: get a code the API will only let go to this shop's storefront, hand it over and leave. */
  const finish = async () => {
    if (!trip) return;
    setPhase("returning");
    setError(null);
    try {
      const h = await api.storeHandoff(trip.shop, origin, trip.mode === "redirect" ? (trip.returnUrl ?? undefined) : undefined);
      await api.logout(); // nothing of this sign-in stays on the landing site
      const opener = trip.mode === "popup" ? window.opener : null;
      if (opener && !opener.closed) {
        opener.postMessage({ type: "sr-handoff", code: h.code }, h.origin);
        window.close();
        return setPhase("closed"); // shown only when the browser won't let the script close the window
      }
      const to = new URL(h.returnUrl ?? `${h.origin}/`);
      to.searchParams.set("handoff", h.code);
      window.location.assign(to.toString());
    } catch (err) {
      setError(errorMessage(err, t));
      setPhase("ready");
    }
  };

  const withGoogle = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.firebaseSignIn(await signInWithGoogle({ locale }));
      await finish();
    } catch (err) {
      setError(isFirebaseError(err) ? firebasePhoneMessage(err, locale) : errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-0 overflow-hidden rounded-[1.75rem] p-0" data-testid="store-sign-in" data-phase={phase}>
      {phase === "loading" && (
        <div className="space-y-3 p-6 sm:p-8">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-12 w-full rounded-full" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      )}
      {phase === "invalid" && (
        <div className="grid justify-items-center gap-3 p-8 text-center" role="alert" data-testid="store-invalid">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <ShieldAlertIcon className="size-6" />
          </span>
          <p className="font-semibold">{t("ssi.invalid")}</p>
          <p className="text-sm text-muted-foreground">{t("ssi.invalidBody")}</p>
        </div>
      )}
      {(phase === "returning" || phase === "closed") && (
        <div className="grid justify-items-center gap-3 p-10 text-center" role="status" aria-live="polite">
          {phase === "returning" && <Loader2Icon className="size-8 animate-spin text-primary" />}
          <p className="font-semibold">{phase === "returning" ? t("ssi.done") : t("ssi.close")}</p>
        </div>
      )}
      {phase === "ready" && (
        <div className="space-y-6 p-6 sm:p-8">
          <div className="space-y-1.5">
            <h1 className="font-display text-2xl font-bold sm:text-3xl">{t("ssi.title", { shop: shopName })}</h1>
            <p className="text-muted-foreground">{t("ssi.sub", { host: new URL(origin).host })}</p>
          </div>
          {error && (
            <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="store-error">
              {error}
            </p>
          )}
          {google && (
            <>
              <Button type="button" variant="outline" size="lg" className="w-full rounded-full" disabled={busy} onClick={() => void withGoogle()} data-testid="store-google">
                {busy ? <Loader2Icon className="animate-spin" /> : <GoogleG />}
                {busy ? t("ssi.googleBusy") : t("ssi.google")}
              </Button>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                {t("ssi.or")}
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          )}
          <OtpSignIn initialTarget={trip?.phone.startsWith("+") ? "" : (trip?.phone ?? "")} onSignedIn={() => void finish()} />
        </div>
      )}
    </Card>
  );
}
