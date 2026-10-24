"use client";

import * as React from "react";
import { ArrowRightIcon, Loader2Icon, PencilIcon } from "lucide-react";
import { Button } from "@srirealtime/ui/components/button";
import { Field, FieldControl, FieldError, FieldHint, FieldLabel } from "@srirealtime/ui/components/field";
import { Input } from "@srirealtime/ui/components/input";
import { OtpInput } from "@srirealtime/ui/components/otp-input";
import { AnimatePresence, motion } from "@srirealtime/ui/motion";
import {
  firebasePhoneMessage,
  isFirebaseError,
  resolvePhoneMethod,
  sendFirebasePhoneCode,
  type FirebasePhoneCode,
} from "@srirealtime/web/firebase-phone";
import { api, ApiError, errorMessage, normalizeTarget, type SignInResult } from "@/lib/api";
import { useSite } from "./site-context";

const maskPhone = (p: string) => (p.length <= 4 ? p : `${p.slice(0, 3)}${"*".repeat(Math.max(0, p.length - 7))}${p.slice(-4)}`);

/**
 * Phone / email → 6-digit code → signed in. Phones are verified by Firebase when it is configured (Google sends the
 * SMS); email, test numbers and setups without Firebase use the API's OTP. Same screens either way.
 */
export function OtpSignIn({
  onSignedIn,
  askName = false,
  initialTarget = "",
  phoneChannel = "sms",
  allowPhone = true,
  allowEmail = true,
}: {
  onSignedIn: (r: SignInResult) => void;
  askName?: boolean;
  /** Prefills the number (the round trip from a shop app's login). */
  initialTarget?: string;
  /** How phone codes are sent: SMS (Firebase when configured) or WhatsApp (when the shop turned SMS off). */
  phoneChannel?: "sms" | "whatsapp";
  /** The shop's sign-in options: refuse (and say so) a phone number or an email when that way is switched off. */
  allowPhone?: boolean;
  allowEmail?: boolean;
}) {
  const { t, locale } = useSite();
  const [stage, setStage] = React.useState<"target" | "code">("target");
  const [raw, setRaw] = React.useState(initialTarget);
  const firebaseCode = React.useRef<FirebasePhoneCode | null>(null);
  const [name, setName] = React.useState("");
  const [target, setTarget] = React.useState("");
  const [masked, setMasked] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resendAt, setResendAt] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (stage !== "code") return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [stage]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const norm = normalizeTarget(raw);
    if (!norm) return setError(t("otp.targetInvalid"));
    const kind = norm.includes("@") ? "email" : "phone";
    if (kind === "phone" && !allowPhone) return setError(t("otp.phoneOff"));
    if (kind === "email" && !allowEmail) return setError(t("otp.emailOff"));
    setBusy(true);
    setError(null);
    try {
      firebaseCode.current = null;
      const method = await resolvePhoneMethod({ kind, target: norm, channel: kind === "phone" ? phoneChannel : "email" }, api.authConfig);
      let shown = norm;
      let resend = 30;
      if (method === "firebase") {
        firebaseCode.current = await sendFirebasePhoneCode(norm, { locale });
        shown = maskPhone(norm);
      } else {
        const r = await api.requestOtp(norm, kind === "phone" && phoneChannel === "whatsapp" ? "whatsapp" : undefined);
        shown = r.target || norm;
        resend = r.resendInSeconds || 0;
      }
      setTarget(norm);
      setMasked(shown);
      setResendAt(Date.now() + Math.max(resend, 30) * 1000);
      setCode("");
      setStage("code");
    } catch (err) {
      setError(isFirebaseError(err) ? firebasePhoneMessage(err, locale) : errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value = code) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const fb = firebaseCode.current;
      const r = fb
        ? await api.firebaseSignIn(await fb.confirm(value), name.trim() || undefined)
        : await api.verifyOtp(target, value, name.trim() || undefined);
      onSignedIn(r);
    } catch (err) {
      if (isFirebaseError(err)) setError(firebasePhoneMessage(err, locale));
      else setError(err instanceof ApiError && err.status >= 400 && err.status < 500 ? t("otp.wrong") : errorMessage(err, t));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));

  return (
    <AnimatePresence mode="wait" initial={false}>
      {stage === "target" ? (
        <motion.form key="target" onSubmit={send} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22 }} className="grid gap-5" noValidate>
          {askName && (
            <Field>
              <FieldLabel>{t("otp.name")}</FieldLabel>
              <FieldControl>
                <Input size="lg" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} data-testid="otp-name" />
              </FieldControl>
            </Field>
          )}
          <Field invalid={!!error}>
            <FieldLabel>{t(allowPhone && allowEmail ? "otp.target" : allowPhone ? "otp.targetPhone" : "otp.targetEmail")}</FieldLabel>
            <FieldControl>
              <Input
                size="lg"
                value={raw}
                onChange={(e) => {
                  setRaw(e.target.value);
                  setError(null);
                }}
                placeholder={t("otp.targetPlaceholder")}
                autoComplete="username"
                autoFocus
                data-testid="otp-target"
              />
            </FieldControl>
            <FieldHint>{t("otp.sub")}</FieldHint>
            <FieldError>{error}</FieldError>
          </Field>
          <Button type="submit" size="lg" disabled={busy || !raw.trim()} className="group w-full rounded-full" data-testid="otp-send">
            {busy ? <Loader2Icon className="animate-spin" /> : null}
            {busy ? t("otp.sending") : t("otp.send")}
            {!busy && <ArrowRightIcon className="transition-transform group-hover:translate-x-0.5" />}
          </Button>
        </motion.form>
      ) : (
        <motion.form
          key="code"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 16 }}
          transition={{ duration: 0.22 }}
          className="grid gap-5"
          noValidate
        >
          <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span>{t("otp.codeSent", { target: masked })}</span>
            <button type="button" className="inline-flex items-center gap-1 font-medium text-primary hover:underline" onClick={() => setStage("target")}>
              <PencilIcon className="size-3" />
              {t("otp.change")}
            </button>
          </div>
          <Field invalid={!!error}>
            <FieldLabel htmlFor={null}>{t("otp.code")}</FieldLabel>
            <motion.div animate={error ? { x: [0, -8, 8, -5, 5, 0] } : { x: 0 }} transition={{ duration: 0.4 }}>
              <OtpInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} autoFocus invalid={!!error} disabled={busy} aria-label={t("otp.code")} />
            </motion.div>
            <FieldError>{error}</FieldError>
          </Field>
          <Button type="submit" size="lg" disabled={busy || code.length !== 6} className="w-full rounded-full" data-testid="otp-verify">
            {busy && <Loader2Icon className="animate-spin" />}
            {busy ? t("otp.verifying") : t("otp.verify")}
          </Button>
          <Button type="button" variant="ghost" disabled={wait > 0 || busy} onClick={() => void send()} className="justify-self-center">
            {wait > 0 ? t("otp.resendIn", { s: wait }) : t("otp.resend")}
          </Button>
        </motion.form>
      )}
    </AnimatePresence>
  );
}
