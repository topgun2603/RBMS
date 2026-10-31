"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, PowerOffIcon, RefreshCwIcon, WifiOffIcon } from "lucide-react";
import { Button, Card, CardContent } from "@rbms/ui";
import {
  getTenantStrategy,
  SessionProvider,
  setDeviceToken,
  setSessionOverride,
  setStoredTenant,
  ShopBranding,
  shopUrl,
  useI18n,
  useTenantSlug,
  type MeResponse,
} from "@rbms/web";
import { POS_FEATURES } from "../../lib/access";
import { initialTerminal, sessionExpired, terminalReducer, terminalView } from "../../lib/pairing";
import { idleExpired } from "../../lib/pin";
import {
  getDevice,
  lockPinSession,
  readCachedDevice,
  readDeviceToken,
  readPinSession,
  unpairDevice,
  writeCachedDevice,
  writeDeviceToken,
  writePinSession,
} from "../../lib/terminal-api";
import type { PairResponse, PinSession } from "../../lib/terminal-types";
import { CatalogProvider } from "../catalog-provider";
import { PosScreen } from "../pos-screen";
import { LockScreen } from "./lock-screen";
import { PairingScreen } from "./pairing-screen";
import { TerminalProvider, type TerminalEnv } from "./terminal-context";
import { WeighStation } from "./weigh-station";

const PAIR_HASH = "#pair=";
const DEVICE_REFRESH = 5 * 60_000;

/** A PIN session as the kit's signed-in member (for usePermission / useSession inside the counter). */
export function meFromPinSession(s: PinSession): MeResponse {
  return {
    user: { id: s.user.id, name: s.user.name || null, phone: null, email: null, avatarUrl: null, locale: "en", platformRoles: [], status: "active", createdAt: "" },
    tenantRoles: s.tenantRoles,
    permissions: s.permissions,
  };
}

/**
 * Terminal mode (public route `terminal`, e.g. /pos/terminal): this browser as a paired POS terminal. Unpaired →
 * pairing screen; paired → lock screen (PIN); unlocked → the counter (role pos) or the weighing station (role
 * weighing). Every request carries `x-device-token`; once unlocked the PIN session is the bearer token. The normal
 * staff sign-in stored in this browser is never touched.
 */
export function TerminalApp() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const tenant = useTenantSlug();
  const [state, dispatch] = React.useReducer(terminalReducer, initialTerminal);
  const [token, setToken] = React.useState<string | null>(null);
  const [tokenLoaded, setTokenLoaded] = React.useState(false);
  const [reload, setReload] = React.useState(0);

  // A pairing made on another address (the root host, or the wrong shop) hands the token over in the URL fragment.
  React.useEffect(() => {
    if (tenant === undefined) return;
    let tok = readDeviceToken(tenant);
    if (typeof window !== "undefined" && window.location.hash.startsWith(PAIR_HASH)) {
      tok = decodeURIComponent(window.location.hash.slice(PAIR_HASH.length)) || tok;
      writeDeviceToken(tenant, tok);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    setToken(tok);
    setTokenLoaded(true);
  }, [tenant]);

  const session = state.phase === "unlocked" ? state.session : null;

  // Wire the kit's api(): device token always, the PIN session (or none) instead of the stored staff sign-in.
  const dispatchRef = React.useRef(dispatch);
  dispatchRef.current = dispatch;
  setDeviceToken(token);
  setSessionOverride({ token: session?.token ?? null, onUnauthorized: (e) => dispatchRef.current({ type: "unauthorized", code: e.code }) });
  React.useEffect(
    () => () => {
      setDeviceToken(null);
      setSessionOverride(null);
    },
    [],
  );

  // GET /pos/device whenever the token changes (and every few minutes for renamed terminals / new settings).
  React.useEffect(() => {
    if (!tokenLoaded) return;
    if (!token) {
      dispatch({ type: "noToken" });
      return;
    }
    let cancelled = false;
    const load = () =>
      getDevice()
        .then((d) => {
          if (cancelled) return;
          writeCachedDevice(tenant, d);
          dispatch({ type: "device", device: d });
          // Back from a reload: the tab's PIN session, when still valid for this terminal.
          const saved = readPinSession(tenant);
          if (saved && !sessionExpired(saved)) dispatch({ type: "unlock", session: saved });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          dispatch({ type: "deviceFailed", error: err, cached: readCachedDevice(tenant) });
        });
    void load();
    const id = window.setInterval(() => void getDevice().then((d) => !cancelled && dispatch({ type: "device", device: d })).catch(() => undefined), DEVICE_REFRESH);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [token, tokenLoaded, tenant, reload]);

  // Side effects of leaving phases: forget the token when unpaired, the PIN session when locked.
  React.useEffect(() => {
    if (state.phase === "unpaired" && token) {
      writeDeviceToken(tenant, null);
      writeCachedDevice(tenant, null);
      writePinSession(tenant, null);
      setToken(null);
    }
    if (state.phase === "locked") writePinSession(tenant, null);
  }, [state.phase, token, tenant]);

  const clearCashierData = React.useCallback(() => {
    // The next cashier must not see the last one's queries (the catalogue lives in IndexedDB and stays; so do the
    // features and the shop's branding, which belong to the terminal, not the cashier).
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "features" && q.queryKey[0] !== "branding" });
  }, [qc]);

  const lock = React.useCallback(
    (reason?: "idle" | "expired" | "locked") => {
      // Revoke on the server while the PIN token is still the bearer.
      void lockPinSession().catch(() => undefined);
      writePinSession(tenant, null);
      clearCashierData();
      dispatch({ type: "lock", reason });
    },
    [tenant, clearCashierData],
  );

  const onPaired = async (r: PairResponse) => {
    const strategy = getTenantStrategy();
    if (strategy.from === "storage") {
      setStoredTenant(r.shop.slug);
      writeDeviceToken(r.shop.slug, r.deviceToken);
    } else if (tenant !== r.shop.slug) {
      // Paired on the root address or another shop's: continue on the shop's own address (its own storage).
      const path = window.location.pathname + window.location.search;
      window.location.assign(`${shopUrl(r.shop.slug).replace(/\/$/, "")}${path}${PAIR_HASH}${encodeURIComponent(r.deviceToken)}`);
      return;
    } else writeDeviceToken(tenant, r.deviceToken);
    setToken(r.deviceToken);
    dispatch({ type: "paired" });
  };

  const forget = async () => {
    await unpairDevice().catch(() => undefined);
    dispatch({ type: "unpaired" });
  };

  const view = terminalView(state, { terminals: POS_FEATURES.terminals, weighing: POS_FEATURES.weighing });

  // A paired device has no staff session, so ShopGate's branding never runs here: load the shop's colours with the
  // device token (the API resolves its shop) or, before pairing, the shop address (x-tenant) — every screen below.
  const branding = <ShopBranding slug={tenant ?? null} via={token ? "device" : "shop"} enabled={tokenLoaded && (Boolean(token) || Boolean(tenant))} />;
  const screen = (() => {

  if (view === "loading") return <Centered>{<Loader2Icon className="size-8 animate-spin text-muted-foreground" aria-label={t("pos.terminal.loading")} />}</Centered>;
  if (view === "pair") return <PairingScreen onPaired={onPaired} notice={state.phase === "unpaired" ? state.notice : undefined} />;
  if (view === "offline") {
    return (
      <Centered>
        <Card className="w-full max-w-sm">
          <CardContent className="grid justify-items-center gap-3 text-center">
            <WifiOffIcon className="size-8 text-muted-foreground" />
            <h1 className="font-heading text-xl font-semibold">{t("pos.terminal.offline")}</h1>
            <p className="text-sm text-muted-foreground">
              {state.phase === "offline" && state.device ? t("pos.terminal.offlineBody", { name: state.device.terminal.name }) : t("pos.terminal.offlineBodyNew")}
            </p>
            <Button type="button" onClick={() => setReload((n) => n + 1)}>
              <RefreshCwIcon /> {t("pos.terminal.retry")}
            </Button>
          </CardContent>
        </Card>
      </Centered>
    );
  }
  if (state.phase !== "locked" && state.phase !== "unlocked") return null;
  const device = state.device;
  if (view === "off") {
    return (
      <Centered>
        <Card className="w-full max-w-sm">
          <CardContent className="grid justify-items-center gap-3 text-center">
            <PowerOffIcon className="size-8 text-muted-foreground" />
            <h1 className="font-heading text-xl font-semibold">{t(device.terminal.role === "weighing" ? "pos.terminal.weighingOff" : "pos.terminal.off")}</h1>
            <p className="text-sm text-muted-foreground">{t("pos.terminal.offBody", { shop: device.shop.name })}</p>
            <Button type="button" variant="outline" onClick={() => setReload((n) => n + 1)}>
              <RefreshCwIcon /> {t("pos.terminal.retry")}
            </Button>
          </CardContent>
        </Card>
      </Centered>
    );
  }
  if (state.phase === "locked") {
    return (
      <LockScreen
        device={device}
        notice={state.notice}
        onUnlock={(s) => {
          writePinSession(tenant, s);
          clearCashierData();
          dispatch({ type: "unlock", session: s });
        }}
        onUnpaired={() => dispatch({ type: "unauthorized", code: "device_not_paired" })}
        onForget={forget}
      />
    );
  }
  return <Unlocked device={device} session={state.session} lock={lock} tenant={tenant ?? null} weighing={view === "weighing"} />;
  })();
  return (
    <>
      {branding}
      {screen}
    </>
  );
}

function Unlocked({ device, session, lock, tenant, weighing }: Pick<TerminalEnv, "device" | "session" | "lock"> & { tenant: string | null; weighing: boolean }) {
  const env = React.useMemo<TerminalEnv>(() => ({ device, session, lock, has: (f) => device.features.includes(f) }), [device, session, lock]);
  const me = React.useMemo(() => meFromPinSession(session), [session]);
  useIdleLock(device.terminal.settings.lockAfterMinutes || 5, session.expiresAt, lock);
  return (
    <SessionProvider me={me}>
      <TerminalProvider value={env}>
        {weighing ? (
          <CatalogProvider enabled tenant={tenant}>
            <WeighStation />
          </CatalogProvider>
        ) : (
          <PosScreen />
        )}
      </TerminalProvider>
    </SessionProvider>
  );
}

/** Locks after `minutes` without a touch / key / click, and when the PIN session expires. */
function useIdleLock(minutes: number, expiresAt: string, lock: TerminalEnv["lock"]) {
  React.useEffect(() => {
    let last = Date.now();
    const bump = () => {
      last = Date.now();
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, bump, { passive: true, capture: true });
    const id = window.setInterval(() => {
      if (sessionExpired({ expiresAt })) lock("expired");
      else if (idleExpired(last, minutes)) lock("idle");
    }, 10_000);
    return () => {
      for (const e of events) window.removeEventListener(e, bump, { capture: true });
      window.clearInterval(id);
    };
  }, [minutes, expiresAt, lock]);
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 z-40 grid place-items-center bg-background p-4 text-foreground">{children}</div>;
}
