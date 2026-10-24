"use client";

import * as React from "react";
import { ArrowLeftIcon, EyeIcon, EyeOffIcon, Loader2Icon, MailCheckIcon } from "lucide-react";
import { Button } from "@srirealtime/ui/components/button";
import { Field, FieldControl, FieldHint, FieldLabel } from "@srirealtime/ui/components/field";
import { Input } from "@srirealtime/ui/components/input";
import {
  firebasePhoneErrorKind,
  firebasePhoneMessage,
  firebaseWebConfig,
  isFirebaseError,
  loadAuthConfig,
  passwordProblem,
  resendVerification,
  sendPasswordReset,
  signInWithPassword,
  signUpWithPassword,
  type AuthClientConfig,
  type SignInMethod,
} from "@srirealtime/web/firebase-phone";
import { api, errorMessage, type SignInResult } from "@/lib/api";
import { GoogleButton } from "./google-button";
import { OtpSignIn } from "./otp-sign-in";
import { useSite } from "./site-context";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Mode = "signin" | "signup" | "reset" | "resetSent" | "verify";

/**
 * Email + password through Firebase on the landing site (an authorized domain): sign in, create an account (Firebase
 * emails a verification link and nobody gets in until it is opened), and forgot password. `onSignedIn` runs once the API
 * has exchanged the Firebase token for a session. Wrong email and wrong password read the same.
 */
export function PasswordSignIn({ onSignedIn }: { onSignedIn: (r: SignInResult) => void }) {
  const { t, locale } = useSite();
  const [mode, setMode] = React.useState<Mode>("signin");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);

  const mail = email.trim().toLowerCase();
  const emailOk = EMAIL_RE.test(mail);
  const msg = (code: string) => firebasePhoneMessage({ code }, locale);
  const go = (next: Mode) => {
    setMode(next);
    setError(null);
    setNote(null);
    if (next === "signin" || next === "signup") setPassword("");
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(isFirebaseError(err) ? firebasePhoneMessage(err, locale) : errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const signIn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailOk) return setError(msg("auth/invalid-email"));
    if (!password) return setError(t("pw.passwordMissing"));
    void run(async () => {
      let token: string;
      try {
        token = await signInWithPassword(mail, password, { locale });
      } catch (err) {
        if (firebasePhoneErrorKind(err) === "email_not_verified") return setMode("verify");
        throw err;
      }
      onSignedIn(await api.firebaseSignIn(token));
    });
  };
  const signUp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailOk) return setError(msg("auth/invalid-email"));
    if (passwordProblem(password)) return setError(msg("auth/weak-password"));
    void run(async () => {
      await signUpWithPassword(mail, password, { locale });
      setMode("verify");
    });
  };
  const reset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailOk) return setError(msg("auth/invalid-email"));
    void run(async () => {
      await sendPasswordReset(mail, { locale });
      setMode("resetSent");
    });
  };
  const resend = () =>
    void run(async () => {
      await resendVerification(mail, password, { locale });
      setNote(t("pw.verifySent"));
    });

  const back = (
    <Button type="button" variant="ghost" className="justify-self-center" onClick={() => go("signin")}>
      <ArrowLeftIcon /> {t("pw.back")}
    </Button>
  );

  if (mode === "verify" || mode === "resetSent") {
    const verify = mode === "verify";
    return (
      <div className="grid justify-items-center gap-4 text-center" role="status" aria-live="polite" data-testid={verify ? "pw-verify" : "pw-reset-sent"}>
        <MailCheckIcon className="size-10 text-primary" />
        <p className="font-semibold">{t(verify ? "pw.verifyTitle" : "pw.resetTitle")}</p>
        <p className="text-sm text-muted-foreground">{t(verify ? "pw.verifyBody" : "pw.resetSent", { email: mail })}</p>
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
        {error && (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {verify && password && (
          <Button type="button" variant="outline" className="rounded-full" disabled={busy} onClick={resend}>
            {busy && <Loader2Icon className="animate-spin" />} {t("pw.verifyResend")}
          </Button>
        )}
        {back}
      </div>
    );
  }

  const emailField = (
    <Field invalid={!!error && !emailOk}>
      <FieldLabel>{t("pw.email")}</FieldLabel>
      <FieldControl>
        <Input size="lg" type="email" inputMode="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" data-testid="pw-email" />
      </FieldControl>
    </Field>
  );
  const errorLine = error && (
    <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="pw-error">
      {error}
    </p>
  );

  if (mode === "reset") {
    return (
      <form onSubmit={reset} className="grid gap-4" noValidate>
        <div className="space-y-1">
          <p className="font-semibold">{t("pw.resetTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("pw.resetBody")}</p>
        </div>
        {emailField}
        {errorLine}
        <Button type="submit" size="lg" className="w-full rounded-full" disabled={busy || !email.trim()}>
          {busy && <Loader2Icon className="animate-spin" />} {t("pw.resetSend")}
        </Button>
        {back}
      </form>
    );
  }

  const signup = mode === "signup";
  return (
    <form onSubmit={signup ? signUp : signIn} className="grid gap-4" noValidate data-testid="pw-form">
      <p className="font-semibold">{t(signup ? "pw.signUpTitle" : "pw.title")}</p>
      {emailField}
      <Field>
        <FieldLabel>{t("pw.password")}</FieldLabel>
        <div className="relative">
          <FieldControl>
            <Input size="lg" type={show ? "text" : "password"} autoComplete={signup ? "new-password" : "current-password"} className="pr-11" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="pw-password" />
          </FieldControl>
          <button type="button" className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShow((s) => !s)} aria-label={t(show ? "pw.hide" : "pw.show")}>
            {show ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </button>
        </div>
        {signup && <FieldHint>{t("pw.hint")}</FieldHint>}
      </Field>
      {errorLine}
      <Button type="submit" size="lg" className="w-full rounded-full" disabled={busy || !email.trim() || !password} data-testid="pw-submit">
        {busy && <Loader2Icon className="animate-spin" />} {t(signup ? "pw.signUp" : "pw.signIn")}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        {signup ? (
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => go("signin")}>
            {t("pw.haveAccount")}
          </button>
        ) : (
          <>
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => go("reset")} data-testid="pw-forgot">
              {t("pw.forgot")}
            </button>
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => go("signup")} data-testid="pw-create">
              {t("pw.create")}
            </button>
          </>
        )}
      </div>
    </form>
  );
}

/** What the landing site shows when the API sent no per-shop list: the old behaviour (codes), plus Google/password when set up. */
export function fallbackMethods(cfg: AuthClientConfig | null): SignInMethod[] {
  const out: SignInMethod[] = ["sms", "email_code"];
  if (cfg?.phone.method === "firebase") out.unshift("google");
  return out;
}

/**
 * The sign-in methods the shop (or the platform, on the landing site's own login) offers, preferred first: Google, a
 * code by phone/email, and email + password. `onGoogle` is the page's own Google handler; `googleAvailable` says whether
 * this site can run it. Password and codes work on any page that can reach the API.
 */
export function SignInMethods({
  onSignedIn,
  onGoogle,
  googleBusy,
  googleAvailable,
  showGoogle = true,
  initialTarget = "",
  initialView,
  testId,
}: {
  onSignedIn: (r: SignInResult) => void;
  onGoogle: () => void;
  googleBusy: boolean;
  googleAvailable: boolean;
  showGoogle?: boolean;
  initialTarget?: string;
  /** `?method=password` from a shop's login. */
  initialView?: "password" | "code";
  testId?: string;
}) {
  const { t } = useSite();
  const [cfg, setCfg] = React.useState<AuthClientConfig | null | undefined>(undefined);
  React.useEffect(() => {
    let alive = true;
    void loadAuthConfig(api.authConfig).then((c) => alive && setCfg(c));
    return () => {
      alive = false;
    };
  }, []);
  const [picked, setPicked] = React.useState<"password" | "code" | null>(null);

  if (cfg === undefined) return null; // config not in yet: no flash of options the shop turned off
  const methods = cfg?.signIn?.methods ?? fallbackMethods(cfg);
  const smsOn = methods.includes("sms");
  const whatsappOn = methods.includes("whatsapp");
  const emailOn = methods.includes("email_code");
  const phoneOn = smsOn || whatsappOn;
  const codeOn = phoneOn || emailOn;
  const passwordOn = methods.includes("password") && !!firebaseWebConfig() && cfg?.phone.method === "firebase";
  const googleOn = methods.includes("google") && googleAvailable && showGoogle;
  const firstPassword = methods.findIndex((m) => m === "password");
  const firstCode = methods.findIndex((m) => m === "sms" || m === "whatsapp" || m === "email_code");
  const natural: "password" | "code" = passwordOn && (!codeOn || (firstPassword >= 0 && firstPassword < firstCode)) ? "password" : "code";
  const view = picked ?? (initialView === "password" && passwordOn ? "password" : initialView === "code" && codeOn ? "code" : natural);

  if (!codeOn && !passwordOn && !googleOn) {
    return (
      <p role="alert" className="text-center text-sm text-muted-foreground">
        {t("pw.noMethods")}
      </p>
    );
  }

  return (
    <div className="grid gap-5" data-testid={testId}>
      {googleOn && <GoogleButton busy={googleBusy} onClick={onGoogle} testId={testId ? `${testId}-google` : undefined} />}
      {view === "password" ? (
        <>
          <PasswordSignIn onSignedIn={onSignedIn} />
          {codeOn && (
            <Button type="button" variant="ghost" className="justify-self-center text-muted-foreground" onClick={() => setPicked("code")}>
              {t("pw.useCode")}
            </Button>
          )}
        </>
      ) : (
        <>
          {codeOn && (
            <OtpSignIn
              initialTarget={initialTarget}
              onSignedIn={onSignedIn}
              allowPhone={phoneOn}
              allowEmail={emailOn}
              phoneChannel={smsOn ? "sms" : "whatsapp"}
            />
          )}
          {passwordOn && (
            <Button type="button" variant="ghost" className="justify-self-center text-muted-foreground" onClick={() => setPicked("password")} data-testid="use-password">
              {t("pw.usePassword")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
