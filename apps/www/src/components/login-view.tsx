"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, Loader2Icon, LogOutIcon, MonitorSmartphoneIcon, PlusIcon, ReceiptIndianRupeeIcon, StoreIcon } from "lucide-react";
import { Badge } from "@rbms/ui/components/badge";
import { Button } from "@rbms/ui/components/button";
import { Card } from "@rbms/ui/components/card";
import { Skeleton } from "@rbms/ui/components/skeleton";
import { AnimatePresence, motion, Stagger, StaggerItem } from "@rbms/ui/motion";
import { firebasePhoneMessage, isFirebaseError, safeReturnUrl, signInWithGoogle } from "@rbms/web/firebase-phone";
import { api, errorMessage, getToken, handoffUrl, normalizeTarget, setSignInContext, type Shop, type User } from "@/lib/api";
import { appUrlFor, PHONE_RETURN_ORIGINS } from "@/lib/site";
import { useSite } from "./site-context";
import { SignInMethods } from "./method-sign-in";
import { useGoogleAvailable } from "./google-button";

type ShopRow = { tenant: Shop; roles: string[] };

/**
 * `?return=<app login URL>&phone=<number>`: a shop app whose host Firebase doesn't authorize (per-shop subdomains)
 * sends phone sign-in here. After signing in, a single-use handoff code goes back to that (validated) URL.
 */
function returnTripFromUrl(): { returnUrl: string; phone: string; method: "google" | "password" | null } | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const returnUrl = safeReturnUrl(q.get("return"), PHONE_RETURN_ORIGINS);
  // The shop whose STAFF are signing in: the API applies that shop's sign-in options to the calls made here.
  const shop = (q.get("shop") ?? "").trim().toLowerCase();
  setSignInContext({ audience: "staff", ...(returnUrl && /^[a-z0-9-]{1,63}$/.test(shop) ? { shop } : {}) });
  if (!returnUrl) return null;
  const method = q.get("method");
  return { returnUrl, phone: normalizeTarget(q.get("phone") ?? "") ?? "", method: method === "google" || method === "password" ? method : null };
}

/** OTP sign-in, then the user's shops with "Open" (single-use handoff code → the shop app's /login). */
export function LoginView() {
  const { t, locale } = useSite();
  const google = useGoogleAvailable();
  const [googleBusy, setGoogleBusy] = React.useState(false);
  const [trip] = React.useState(returnTripFromUrl);
  const [phase, setPhase] = React.useState<"loading" | "signin" | "shops" | "returning">("loading");
  const [user, setUser] = React.useState<User | null>(null);
  const [shops, setShops] = React.useState<ShopRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [opening, setOpening] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    setShops(null);
    try {
      const [me, mine] = await Promise.all([api.me(), api.myShops()]);
      setUser(me.user);
      setShops(mine.items);
      setPhase("shops");
    } catch (err) {
      if (!getToken()) setPhase("signin");
      else {
        setError(errorMessage(err, t));
        setPhase("shops");
      }
    }
  }, [t]);

  /** Back to the app that sent us here, signed in there with a single-use handoff code. */
  const goBack = React.useCallback(
    async (returnUrl: string) => {
      setPhase("returning");
      setError(null);
      try {
        const h = await api.handoff();
        window.location.assign(handoffUrl(returnUrl, h.code));
      } catch (err) {
        setError(errorMessage(err, t));
        setPhase("signin");
      }
    },
    [t],
  );

  React.useEffect(() => {
    if (trip) {
      // Reuse this site's session only when it is the number the app asked about; otherwise verify it now.
      if (!getToken() || !trip.phone) return setPhase("signin");
      api
        .me()
        .then((me) => (me.user.phone === trip.phone ? goBack(trip.returnUrl) : setPhase("signin")))
        .catch(() => setPhase("signin"));
      return;
    }
    if (getToken()) void load();
    else setPhase("signin");
  }, [load, trip, goBack]);

  const open = async (s: Shop) => {
    setOpening(s.id);
    setError(null);
    try {
      const h = await api.handoff(s.id);
      window.location.assign(h.url ?? handoffUrl(h.appUrl ?? appUrlFor(s.appId, s.slug), h.code));
    } catch (err) {
      setError(errorMessage(err, t));
      setOpening(null);
    }
  };

  /** Google (through Firebase); not on a return trip, which verifies one particular phone number. */
  const withGoogle = async () => {
    setGoogleBusy(true);
    setError(null);
    try {
      await api.firebaseSignIn(await signInWithGoogle({ locale }));
      if (trip) await goBack(trip.returnUrl);
      else await load();
    } catch (err) {
      setError(isFirebaseError(err) ? firebasePhoneMessage(err, locale) : errorMessage(err, t));
    } finally {
      setGoogleBusy(false);
    }
  };

  const signOut = async () => {
    await api.logout();
    setUser(null);
    setShops(null);
    setPhase("signin");
  };

  return (
    <Card className="gap-0 overflow-hidden rounded-[1.75rem] p-0" data-testid="login-view" data-phase={phase}>
      <AnimatePresence mode="wait" initial={false}>
        {phase === "loading" && (
          <motion.div key="loading" exit={{ opacity: 0 }} className="space-y-3 p-6 sm:p-8">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </motion.div>
        )}
        {phase === "returning" && (
          <motion.div key="returning" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid justify-items-center gap-3 p-10 text-center" role="status" aria-live="polite">
            <Loader2Icon className="size-8 animate-spin text-primary" />
            <p className="font-semibold">{t("login.returning")}</p>
          </motion.div>
        )}
        {phase === "signin" && (
          <motion.div key="signin" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="space-y-6 p-6 sm:p-8">
            <div className="space-y-1.5">
              <h1 className="font-display text-2xl font-bold sm:text-3xl">{trip?.phone ? t("login.verifyTitle") : t("login.title")}</h1>
              <p className="text-muted-foreground">{trip ? t("login.verifySub", { host: new URL(trip.returnUrl).host }) : t("login.sub")}</p>
            </div>
            {error && (
              <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </p>
            )}
            <SignInMethods
              initialTarget={trip?.phone.replace(/^\+91/, "") ?? ""}
              onSignedIn={() => (trip ? void goBack(trip.returnUrl) : void load())}
              onGoogle={() => void withGoogle()}
              googleBusy={googleBusy}
              googleAvailable={google}
              // Google on a return trip for one particular phone number would be the wrong person's proof.
              showGoogle={!trip?.phone}
              initialView={trip?.method === "password" ? "password" : undefined}
              testId="login-methods"
            />
          </motion.div>
        )}
        {phase === "shops" && (
          <motion.div key="shops" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6 p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <h1 className="font-display text-2xl font-bold sm:text-3xl">{t("login.shops")}</h1>
                <p className="truncate text-sm text-muted-foreground">{user ? user.name || user.phone || user.email : ""}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void signOut()} data-testid="sign-out">
                <LogOutIcon />
                {t("login.signOut")}
              </Button>
            </div>
            {error && (
              <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </p>
            )}
            {shops === null && !error ? (
              <Skeleton className="h-16 w-full rounded-xl" />
            ) : shops && shops.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-8 text-center" data-testid="no-shops">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <StoreIcon className="size-6" />
                </span>
                <p className="font-semibold">{t("login.none")}</p>
                <p className="text-sm text-muted-foreground">{t("login.noneBody")}</p>
                <Button asChild className="rounded-full">
                  <Link href="/signup">{t("cta.trial")}</Link>
                </Button>
              </div>
            ) : (
              <Stagger className="grid gap-3" data-testid="shop-list">
                {(shops ?? []).map(({ tenant: s, roles }) => (
                  <StaggerItem key={s.id}>
                    <motion.div whileHover={{ y: -2 }} className="flex items-center gap-4 rounded-2xl border bg-card p-4 transition-shadow hover:shadow-www">
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5">{s.appId === "BL" ? <ReceiptIndianRupeeIcon /> : <MonitorSmartphoneIcon />}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{s.name}</p>
                        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="truncate">{s.slug}</span>
                          {s.appId && <Badge variant="muted">{t(`login.app.${s.appId}`)}</Badge>}
                          {roles[0] && <Badge variant="outline">{t.has(`login.role.${roles[0]}`) ? t(`login.role.${roles[0]}`) : roles[0]}</Badge>}
                        </p>
                      </div>
                      <Button onClick={() => void open(s)} disabled={opening !== null} className="shrink-0 rounded-full" data-testid={`open-${s.slug}`}>
                        {opening === s.id ? <Loader2Icon className="animate-spin" /> : null}
                        {opening === s.id ? t("login.opening") : t("login.open")}
                        {opening !== s.id && <ArrowRightIcon />}
                      </Button>
                    </motion.div>
                  </StaggerItem>
                ))}
              </Stagger>
            )}
            {shops && shops.length > 0 && (
              <Button asChild variant="outline" className="w-full rounded-full">
                <Link href="/signup">
                  <PlusIcon />
                  {t("login.newShop")}
                </Link>
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
