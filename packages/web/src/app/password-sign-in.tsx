"use client";

import * as React from "react";
import { ArrowLeftIcon, EyeIcon, EyeOffIcon, Loader2Icon, MailCheckIcon } from "lucide-react";
import { Button, Field, FieldControl, FieldError, FieldHint, FieldLabel, Input, toast } from "@rbms/ui";
import {
  firebasePhoneErrorKind,
  firebasePhoneMessage,
  isFirebaseError,
  passwordProblem,
  resendVerification,
  sendPasswordReset,
  signInWithPassword,
  signUpWithPassword,
} from "../lib/firebase-phone";
import { describeError, useI18n } from "../lib/i18n";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Mode = "signin" | "signup" | "reset" | "resetSent" | "verify";

/**
 * Email + password through Firebase (docs/firebase-auth.md, "Email and password"): sign in, create an account (a
 * verification email is sent and nobody gets in until the link is opened), and forgot password. Firebase keeps the
 * passwords; `exchange` posts the Firebase ID token to `POST /v1/auth/firebase`. Wrong email and wrong password read the
 * same, so the screen can't be used to find out who has an account.
 */
export function PasswordSignIn({
  exchange,
  onUseCode,
  initialMode = "signin",
}: {
  /** Trades the Firebase ID token for our session (and navigates). */
  exchange: (idToken: string) => Promise<void>;
  /** "Get a code instead" (when a code method is also on). */
  onUseCode?: () => void;
  initialMode?: Mode;
}) {
  const { t, locale } = useI18n();
  const [mode, setMode] = React.useState<Mode>(initialMode);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fail = (err: unknown) => setError(isFirebaseError(err) ? firebasePhoneMessage(err, locale) : describeError(err, t));
  const go = (next: Mode) => {
    setMode(next);
    setError(null);
    if (next === "signin" || next === "signup") setPassword("");
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const mail = email.trim().toLowerCase();
  const emailOk = EMAIL_RE.test(mail);

  const onSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailOk) return setError(firebasePhoneMessage({ code: "auth/invalid-email" }, locale));
    if (!password) return setError(t("web.login.passwordMissing"));
    void run(async () => {
      try {
        await exchange(await signInWithPassword(mail, password, { locale }));
      } catch (err) {
        if (firebasePhoneErrorKind(err) === "email_not_verified") return setMode("verify");
        throw err;
      }
    });
  };

  const onSignUp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailOk) return setError(firebasePhoneMessage({ code: "auth/invalid-email" }, locale));
    if (passwordProblem(password)) return setError(firebasePhoneMessage({ code: "auth/weak-password" }, locale));
    void run(async () => {
      await signUpWithPassword(mail, password, { locale });
      setMode("verify");
    });
  };

  const onReset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailOk) return setError(firebasePhoneMessage({ code: "auth/invalid-email" }, locale));
    void run(async () => {
      await sendPasswordReset(mail, { locale });
      setMode("resetSent");
    });
  };

  const onResend = () =>
    void run(async () => {
      await resendVerification(mail, password, { locale });
      toast.success(t("web.login.verifyEmailSent"));
    });

  const emailField = (
    <Field id="pw-email" invalid={!!error && mode !== "signin" && !emailOk}>
      <FieldLabel>{t("web.login.emailLabel")}</FieldLabel>
      <FieldControl>
        <Input
          type="email"
          inputMode="email"
          autoComplete="username"
          autoFocus
          size="lg"
          className="text-base"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </FieldControl>
    </Field>
  );

  const passwordField = (autoComplete: "current-password" | "new-password") => (
    <Field id="pw-password">
      <FieldLabel>{t("web.login.passwordLabel")}</FieldLabel>
      <div className="relative">
        <FieldControl>
          <Input
            type={show ? "text" : "password"}
            autoComplete={autoComplete}
            size="lg"
            className="pr-11 text-base"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FieldControl>
        <button
          type="button"
          className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => setShow((s) => !s)}
          aria-label={t(show ? "web.login.hidePassword" : "web.login.showPassword")}
        >
          {show ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
        </button>
      </div>
      {autoComplete === "new-password" && <FieldHint>{t("web.login.passwordHint")}</FieldHint>}
    </Field>
  );

  const errorLine = error && (
    <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {error}
    </p>
  );

  if (mode === "verify" || mode === "resetSent") {
    const verify = mode === "verify";
    return (
      <div className="grid justify-items-center gap-4 text-center" role="status" aria-live="polite">
        <MailCheckIcon className="size-10 text-primary" />
        <h1 className="font-heading text-xl font-semibold tracking-tight">{t(verify ? "web.login.verifyEmailTitle" : "web.login.resetTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t(verify ? "web.login.verifyEmailBody" : "web.login.resetSent", { email: mail })}</p>
        {errorLine}
        {verify && password && (
          <Button type="button" variant="outline" disabled={busy} onClick={onResend}>
            {busy && <Loader2Icon className="animate-spin" />} {t("web.login.verifyEmailResend")}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={() => go("signin")}>
          <ArrowLeftIcon /> {t("web.login.backToSignIn")}
        </Button>
      </div>
    );
  }

  if (mode === "reset") {
    return (
      <form onSubmit={onReset} className="grid gap-4" noValidate>
        <div className="space-y-1.5 text-center">
          <h1 className="font-heading text-xl font-semibold tracking-tight">{t("web.login.resetTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("web.login.resetBody")}</p>
        </div>
        {emailField}
        {errorLine}
        <Button type="submit" size="lg" disabled={busy || !email.trim()}>
          {busy && <Loader2Icon className="animate-spin" />} {t("web.login.resetSend")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => go("signin")}>
          <ArrowLeftIcon /> {t("web.login.backToSignIn")}
        </Button>
      </form>
    );
  }

  const signup = mode === "signup";
  return (
    <form onSubmit={signup ? onSignUp : onSignIn} className="grid gap-4" noValidate>
      <div className="space-y-1.5 text-center">
        <h1 className="font-heading text-xl font-semibold tracking-tight">{t(signup ? "web.login.signUpTitle" : "web.login.passwordTitle")}</h1>
      </div>
      {emailField}
      {passwordField(signup ? "new-password" : "current-password")}
      {errorLine}
      <Button type="submit" size="lg" disabled={busy || !email.trim() || !password}>
        {busy && <Loader2Icon className="animate-spin" />} {t(signup ? "web.login.signUp" : "web.login.signInPassword")}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        {signup ? (
          <Button type="button" variant="link" className="h-auto p-0" onClick={() => go("signin")}>
            {t("web.login.haveAccount")}
          </Button>
        ) : (
          <>
            <Button type="button" variant="link" className="h-auto p-0" onClick={() => go("reset")}>
              {t("web.login.forgot")}
            </Button>
            <Button type="button" variant="link" className="h-auto p-0" onClick={() => go("signup")}>
              {t("web.login.createAccount")}
            </Button>
          </>
        )}
      </div>
      {onUseCode && (
        <Button type="button" variant="ghost" className="text-muted-foreground" onClick={onUseCode}>
          {t("web.login.useCode")}
        </Button>
      )}
    </form>
  );
}
