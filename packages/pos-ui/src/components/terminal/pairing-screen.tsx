"use client";

import * as React from "react";
import { AlertTriangleIcon, CameraIcon, Link2Icon, Loader2Icon, MonitorSmartphoneIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent, Field, FieldHint, FieldLabel, Input } from "@rbms/ui";
import { API_URL, LocaleSwitcher, ThemeToggle, useI18n, useOptionalShop } from "@rbms/web";
import { initialPairing, pairErrorOf, pairingReducer, parsePairingQr } from "../../lib/pairing";
import { pairDevice } from "../../lib/terminal-api";
import type { PairResponse } from "../../lib/terminal-types";
import { CameraScanDialog } from "../camera-scan";

/**
 * "Use this device as a POS terminal": enter the code from Settings → POS terminals (or scan its QR) → POST /pos/pair.
 * `onPaired` stores the device token. A QR made for another server is refused before it is sent.
 */
export function PairingScreen({ onPaired, notice }: { onPaired: (r: PairResponse) => void | Promise<void>; notice?: "revoked" }) {
  const { t } = useI18n();
  const shop = useOptionalShop();
  const [state, dispatch] = React.useReducer(pairingReducer, initialPairing);
  const [camera, setCamera] = React.useState(false);
  const [otherServer, setOtherServer] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const onPairedRef = React.useRef(onPaired);
  onPairedRef.current = onPaired;

  // Pairing: one request per "pairing" state.
  const code = state.step === "pairing" ? state.code : null;
  React.useEffect(() => {
    if (!code) return;
    let cancelled = false;
    pairDevice(code)
      .then(async (r) => {
        if (cancelled) return;
        dispatch({ type: "paired", terminal: r.terminal, shop: r.shop });
        await onPairedRef.current(r);
      })
      .catch((err: unknown) => !cancelled && dispatch({ type: "failed", error: pairErrorOf(err) }));
    return () => {
      cancelled = true;
    };
  }, [code]);

  const onScanned = (text: string) => {
    const qr = parsePairingQr(text);
    setOtherServer(false);
    if (qr?.origin && sameOrigin(qr.origin) === false) {
      setOtherServer(true);
      return;
    }
    dispatch({ type: "scanned", text });
  };

  const busy = state.step !== "enter";
  const error = state.step === "enter" ? state.error : null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-background text-foreground" data-pos-root="" data-pos-pair="">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3">
        <span className="truncate text-sm font-semibold sm:text-base">{shop?.shopName ?? t("pos.pair.appName")}</span>
        <div className="ml-auto flex items-center gap-1">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <main className="grid flex-1 place-items-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="grid gap-6">
            <div className="grid justify-items-center gap-3 text-center">
              <span className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                <MonitorSmartphoneIcon className="size-7" />
              </span>
              <h1 className="font-heading text-2xl font-semibold">{t("pos.pair.title")}</h1>
              <p className="text-sm text-muted-foreground">{t("pos.pair.body")}</p>
            </div>

            {notice === "revoked" && !error && (
              <Alert variant="warning">
                <Link2Icon />
                <AlertTitle>{t("pos.pair.revoked")}</AlertTitle>
                <AlertDescription>{t("pos.pair.revokedBody")}</AlertDescription>
              </Alert>
            )}

            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                setOtherServer(false);
                dispatch({ type: "submit" });
              }}
            >
              <Field invalid={!!error}>
                <FieldLabel>{t("pos.pair.code")}</FieldLabel>
                <Input
                  ref={inputRef}
                  value={state.step === "enter" ? state.code : ""}
                  onChange={(e) => dispatch({ type: "input", value: e.target.value })}
                  placeholder="ABCD-2345"
                  autoFocus
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  disabled={busy}
                  aria-invalid={!!error}
                  className="h-16 text-center font-mono text-3xl tracking-[0.2em] uppercase"
                />
                <FieldHint>{t("pos.pair.codeHint")}</FieldHint>
              </Field>

              {(error || otherServer) && (
                <Alert variant="destructive" role="alert">
                  <AlertTriangleIcon />
                  <AlertTitle>{otherServer ? t("pos.pair.error.otherServer") : t(`pos.pair.error.${error}`)}</AlertTitle>
                </Alert>
              )}

              <Button type="submit" size="lg" className="h-12 text-base" disabled={busy}>
                {busy ? <Loader2Icon className="animate-spin" /> : null} {busy ? t("pos.pair.pairing") : t("pos.pair.submit")}
              </Button>
              <Button type="button" variant="outline" size="lg" className="h-12" onClick={() => setCamera(true)} disabled={busy}>
                <CameraIcon /> {t("pos.pair.scan")}
              </Button>
            </form>

            <ol className="grid list-decimal gap-1 pl-5 text-sm text-muted-foreground">
              <li>{t("pos.pair.step1")}</li>
              <li>{t("pos.pair.step2")}</li>
              <li>{t("pos.pair.step3")}</li>
            </ol>
          </CardContent>
        </Card>
      </main>
      <CameraScanDialog open={camera} onClose={() => setCamera(false)} onCode={onScanned} />
    </div>
  );
}

/** Same API origin as this app talks to (null = can't tell). */
function sameOrigin(origin: string): boolean | null {
  try {
    return new URL(origin).origin === new URL(API_URL).origin;
  } catch {
    return null;
  }
}
