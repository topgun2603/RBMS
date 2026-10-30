"use client";

import * as React from "react";
import { Loader2Icon, ShieldAlertIcon } from "lucide-react";
import { Card } from "@rbms/ui/components/card";
import { Skeleton } from "@rbms/ui/components/skeleton";
import { firebasePhoneMessage, firebaseWebConfig, isFirebaseError, loadAuthConfig, signInWithGoogle } from "@rbms/web/firebase-phone";
import { api, errorMessage, normalizeTarget, setSignInContext } from "@/lib/api";
import { useSite } from "./site-context";
import { SignInMethods } from "./method-sign-in";

interface Trip {
  shop: string;
  origin: string;
  mode: "popup" | "redirect";
  returnUrl: string | null;
  /** A number the shop already collected (E.164): prefilled. */
  phone: string;
  /** The method the shopper picked in the storefront (opens it here). */
  method: "google" | "password" | null;
}

/** `?shop=&origin=&mode=&return=`; the API decides whether the origin really is the shop's. */
function tripFromUrl(): Trip | null {
  const q = new URLSearchParams(window.location.search);
  const shop = (q.get("shop") ?? "").trim().toLowerCase();
  const origin = (q.get("origin") ?? "").trim();
  if (!shop || !origin) return null;
  return { shop, origin, mode: q.get("mode") === "redirect" ? "redirect" : "popup", returnUrl: q.get("return"), phone: normalizeTarget(q.get("phone") ?? "")?.replace(/^\+91/, "") ?? "", method: q.get("method") === "password" ? "password" : q.get("method") === "google" ? "google" : null };
}

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
    // The shop's CUSTOMER sign-in options apply to every call made here (the API enforces them).
    setSignInContext({ shop: tr.shop, audience: "customer" });
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
          <SignInMethods
            initialTarget={trip?.phone.startsWith("+") ? "" : (trip?.phone ?? "")}
            onSignedIn={() => void finish()}
            onGoogle={() => void withGoogle()}
            googleBusy={busy}
            googleAvailable={google}
            initialView={trip?.method === "password" ? "password" : trip?.phone ? "code" : undefined}
            testId="store-methods"
          />
        </div>
      )}
    </Card>
  );
}
