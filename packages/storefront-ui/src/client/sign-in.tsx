"use client";

import * as React from "react";
import { KeyRoundIcon, Loader2Icon, MailIcon, PhoneIcon, ShieldCheckIcon } from "lucide-react";
import { Button } from "@srirealtime/ui/components/button";
import { OtpInput } from "@srirealtime/ui/components/otp-input";
import { toast } from "@srirealtime/ui/components/sonner";
import { cn } from "@srirealtime/ui/lib/utils";
import { normalizeMobile } from "../lib/format";
import type { AuthUser } from "../types";
import { call, errorMessage } from "./api";
import { isTestTarget, LEGACY_SHOPPER_METHODS, useCentralSignIn, type ShopperMethod } from "./central-sign-in";
import { useStore } from "./store-context";

interface OtpRequestResult {
  target: string;
  channel: string;
  expiresInSeconds: number;
  resendInSeconds: number;
}

/**
 * Shopper sign-in: the ways the SHOP turned on (Settings → Sign-in options), preferred first. Codes by SMS / WhatsApp /
 * email use the form below; Google and email + password run on the landing site in a popup (central-sign-in.ts) because
 * Firebase can't be used on every shop domain. Verify uses the address the shopper typed (normalised), never the masked
 * `target` echoed by /otp/request. After sign-in the anonymous cart is merged (StoreProvider.signIn). The API refuses a
 * method the shop switched off, so hiding a button here is only the polite half.
 */
const GoogleG = () => (
  <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
    <path fill="#FBBC05" d="M10.5 28.6a14.5 14.5 0 0 1 0-9.2l-7.9-6.2a24 24 0 0 0 0 21.6l7.9-6.2z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.2C6.5 42.6 14.6 48 24 48z" />
  </svg>
);

type Block = "google" | "password" | "code";

/** The blocks to show, in the shop's preferred order (a block's place is that of its first method). */
export function signInBlocks(methods: readonly ShopperMethod[], central: boolean): Block[] {
  const has = (m: ShopperMethod) => methods.includes(m);
  const blocks: Block[] = [];
  if (has("google") && central) blocks.push("google");
  if (has("password") && central) blocks.push("password");
  if (has("sms") || has("whatsapp") || has("email_code")) blocks.push("code");
  const rank = (b: Block) => methods.findIndex((m) => (b === "code" ? m === "sms" || m === "whatsapp" || m === "email_code" : m === b));
  return blocks.sort((a, b) => rank(a) - rank(b));
}

export function OtpSignIn({ onSignedIn, className, compact }: { onSignedIn?: (user: AuthUser) => void; className?: string; compact?: boolean }) {
  const { t, auth } = useStore();
  const id = React.useId();
  const central = useCentralSignIn((u) => {
    toast.success(t("auth.signedIn"));
    onSignedIn?.(u);
  });
  const methods: ShopperMethod[] = central.methods ?? LEGACY_SHOPPER_METHODS;
  const smsOn = methods.includes("sms");
  const whatsappOn = methods.includes("whatsapp");
  const phoneOn = smsOn || whatsappOn;
  const emailOn = methods.includes("email_code");
  const blocks = signInBlocks(methods, central.available);

  const [pickedMode, setMode] = React.useState<"phone" | "email" | null>(null);
  const mode: "phone" | "email" = pickedMode === "email" && emailOn ? "email" : pickedMode === "phone" && phoneOn ? "phone" : phoneOn ? "phone" : "email";
  const [pickedVia, setVia] = React.useState<"sms" | "whatsapp" | null>(null);
  const via: "sms" | "whatsapp" = pickedVia === "whatsapp" && whatsappOn ? "whatsapp" : pickedVia === "sms" && smsOn ? "sms" : smsOn ? "sms" : "whatsapp";

  const [value, setValue] = React.useState("");
  const [target, setTarget] = React.useState<string | null>(null);
  const [display, setDisplay] = React.useState("");
  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resendIn, setResendIn] = React.useState(0);

  React.useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const request = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    const normalized = mode === "phone" ? normalizeMobile(value) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : null;
    if (!normalized) return setError(mode === "phone" ? t("auth.invalidPhone") : t("auth.invalidEmail"));
    // SMS to real numbers is verified by Firebase on the landing site; the dev test numbers keep the fixed-code form.
    if (mode === "phone" && via === "sms" && central.available && !isTestTarget(normalized, central.testTargets)) return central.start({ phone: normalized });
    setBusy(true);
    try {
      const r = await call<OtpRequestResult>("/auth/otp/request", { body: { target: normalized, ...(mode === "phone" ? { channel: via } : {}) }, auth: false });
      setTarget(normalized);
      setDisplay(r.target || normalized);
      setResendIn(r.resendInSeconds ?? 30);
      setCode("");
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (c = code) => {
    if (!target || c.length < 6) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ token: string; user: AuthUser; isNewUser: boolean }>("/auth/otp/verify", {
        body: { target, code: c, ...(name.trim() ? { name: name.trim() } : {}) },
        auth: false,
      });
      await auth.signIn(r.token, r.user);
      toast.success(t("auth.signedIn"));
      onSignedIn?.(r.user);
    } catch (err) {
      setError(errorMessage(err, t));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const codeFields = (
    <>
      {phoneOn && smsOn && whatsappOn && mode === "phone" && (
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("auth.phone")}>
          {(["sms", "whatsapp"] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={via === c}
              onClick={() => setVia(c)}
              className={cn("h-10 rounded-xl border text-sm transition-colors", via === c ? "border-primary bg-primary/5 font-medium" : "text-muted-foreground hover:bg-accent")}
            >
              {t(c === "sms" ? "auth.viaSms" : "auth.viaWhatsapp")}
            </button>
          ))}
        </div>
      )}
      <label htmlFor={`${id}-v`} className="text-sm font-medium">
        {mode === "phone" ? t("auth.phone") : t("auth.email")}
      </label>
      <div className="relative">
        {mode === "phone" ? (
          <span className="pointer-events-none absolute top-1/2 left-3 flex -translate-y-1/2 items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <PhoneIcon className="size-4" /> +91
          </span>
        ) : (
          <MailIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        )}
        <input
          id={`${id}-v`}
          value={value}
          onChange={(e) => setValue(mode === "phone" ? e.target.value.replace(/[^\d ]/g, "").slice(0, 12) : e.target.value)}
          type={mode === "phone" ? "tel" : "email"}
          inputMode={mode === "phone" ? "numeric" : "email"}
          autoComplete={mode === "phone" ? "tel-national" : "email"}
          placeholder={mode === "phone" ? "98765 43210" : "you@example.com"}
          aria-invalid={!!error}
          aria-describedby={[mode === "phone" ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined}
          className={cn("block h-11 w-full rounded-xl border border-input bg-background pe-3 text-base tracking-wide outline-none focus:ring-[3px] focus:ring-ring/30", mode === "phone" ? "ps-[4.5rem]" : "ps-10")}
          data-testid="otp-target"
        />
      </div>
      {mode === "phone" && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {t(via === "whatsapp" ? "auth.phoneHintWhatsapp" : "auth.phoneHint")}
        </p>
      )}
      {(error || central.error) && (
        <p id={`${id}-err`} className="text-sm text-danger-ink" role="alert">
          {error || central.error}
        </p>
      )}
      <Button type="submit" size="lg" className="rounded-full text-base" disabled={busy || central.busy} data-testid="otp-send">
        {(busy || central.busy) && <Loader2Icon className="animate-spin" />}
        {busy || central.busy ? t("auth.sending") : t("auth.sendCode")}
      </Button>
      {phoneOn && emailOn && (
        <button
          type="button"
          className="justify-self-center text-sm font-medium text-primary hover:underline"
          onClick={() => {
            setMode(mode === "phone" ? "email" : "phone");
            setValue("");
            setError(null);
          }}
        >
          {mode === "phone" ? t("auth.useEmail") : t("auth.usePhone")}
        </button>
      )}
    </>
  );

  return (
    <div className={cn("grid gap-5", className)} data-testid="otp-signin">
      {!compact && (
        <div className="text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheckIcon className="size-7" />
          </span>
          <h2 className="mt-4 font-heading text-2xl font-bold tracking-tight">{t("auth.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("auth.subtitle")}</p>
        </div>
      )}
      {!target ? (
        <form onSubmit={request} className="grid gap-3">
          {central.methods !== null && blocks.length === 0 && <p className="text-center text-sm text-muted-foreground">{t("auth.noMethods")}</p>}
          {blocks.map((block, i) => (
            <React.Fragment key={block}>
              {i > 0 && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
                  <span className="h-px flex-1 bg-border" />
                  {t("auth.or")}
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              {block === "google" && (
                <Button type="button" variant="outline" size="lg" className="rounded-full text-base" disabled={central.busy || busy} onClick={() => central.start({ method: "google" })} data-testid="google-signin">
                  {central.busy ? <Loader2Icon className="animate-spin" /> : <GoogleG />}
                  {central.busy ? t("auth.waiting") : t("auth.google")}
                </Button>
              )}
              {block === "password" && (
                <Button type="button" variant="outline" size="lg" className="rounded-full text-base" disabled={central.busy || busy} onClick={() => central.start({ method: "password" })} data-testid="password-signin">
                  {central.busy ? <Loader2Icon className="animate-spin" /> : <KeyRoundIcon />}
                  {central.busy ? t("auth.waiting") : t("auth.password")}
                </Button>
              )}
              {block === "code" && codeFields}
            </React.Fragment>
          ))}
          {!blocks.includes("code") && (error || central.error) && (
            <p className="text-sm text-danger-ink" role="alert">
              {error || central.error}
            </p>
          )}
        </form>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <p className="text-center text-sm text-muted-foreground">
            {t("auth.codeSent", { target: display })}{" "}
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setTarget(null)}>
              {t("auth.change")}
            </button>
          </p>
          <OtpInput value={code} onChange={setCode} onComplete={(c) => void verify(c)} autoFocus disabled={busy} invalid={!!error} aria-label={t("auth.code")} className="justify-center" />
          <div className="grid content-start gap-1.5">
            <label htmlFor={`${id}-n`} className="text-sm font-medium">
              {t("auth.name")} <span className="text-muted-foreground">({t("common.optional")})</span>
            </label>
            <input id={`${id}-n`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-[3px] focus:ring-ring/30" />
          </div>
          {error && (
            <p className="text-center text-sm text-danger-ink" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="rounded-full text-base" disabled={busy || code.length < 6} data-testid="otp-verify">
            {busy && <Loader2Icon className="animate-spin" />}
            {busy ? t("auth.verifying") : t("auth.verify")}
          </Button>
          <button type="button" disabled={resendIn > 0 || busy} onClick={() => void request()} className="justify-self-center text-sm font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline">
            {resendIn > 0 ? t("auth.resendIn", { s: resendIn }) : t("auth.resend")}
          </button>
        </form>
      )}
    </div>
  );
}
