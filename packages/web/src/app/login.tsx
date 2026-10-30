"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, Loader2Icon, MailIcon, MessageCircleIcon, SmartphoneIcon } from "lucide-react";
import {
  AnimatePresence,
  AuthLayout,
  Button,
  cn,
  controlHeight,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  OtpInput,
  SlideIn,
  toast,
} from "@rbms/ui";
import { BrandMark } from "../components/brand-mark";
import { LocaleSwitcher } from "../components/locale-switcher";
import { ThemeToggle } from "../components/theme-toggle";
import { api, ApiError } from "../lib/api";
import { meQueryKey } from "../lib/auth";
import { useShop } from "../lib/branding";
import { normalizeTarget } from "../lib/format";
import { describeError, useI18n } from "../lib/i18n";
import { setToken, useHydrated, useToken } from "../lib/session";
import { useTenantSlug } from "../lib/tenant";
import { MfaChallenge } from "./mfa-challenge";
import { PasswordSignIn } from "./password-sign-in";
import { isMfaRequired, type MfaRequiredResponse } from "../lib/mfa";
import type { OtpRequestResponse, SignInResponse } from "../lib/types";
import {
  firebasePhoneMessage,
  isFirebaseAuthHost,
  isFirebaseError,
  methodSignInRedirectUrl,
  phoneSignInRedirectUrl,
  resolvePhoneMethod,
  sendFirebasePhoneCode,
  signInWithGoogle,
  type AuthClientConfig,
  type FirebasePhoneCode,
  type SignInMethod,
} from "../lib/firebase-phone";

const OTP_LENGTH = 6;
type Channel = "sms" | "whatsapp" | "email";

/** The landing site: phone sign-in for hosts Firebase doesn't authorize (per-shop subdomains) happens on its /login. */
const WWW_URL = (process.env.NEXT_PUBLIC_WWW_URL || "http://localhost:3005").replace(/\/+$/, "");

/** What staff could do before shops chose their own options (an older API, or the config call failed). */
const LEGACY_METHODS: SignInMethod[] = ["sms", "whatsapp", "email_code"];

const GoogleG = () => (
  <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
    <path fill="#FBBC05" d="M10.5 28.6a14.5 14.5 0 0 1 0-9.2l-7.9-6.2a24 24 0 0 0 0 21.6l7.9-6.2z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.2C6.5 42.6 14.6 48 24 48z" />
  </svg>
);

const fetchAuthConfig = () => api.get<AuthClientConfig>("/auth/config", undefined, { anonymous: true, tenant: null });

/** "+919876543210" → "+91******3210" (display only, like the API's masked target). */
const maskPhone = (p: string) => (p.length <= 4 ? p : `${p.slice(0, 3)}${"*".repeat(Math.max(0, p.length - 7))}${p.slice(-4)}`);

/** The `?handoff=` code of this page load (client only). */
function handoffCodeFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const code = new URLSearchParams(window.location.search).get("handoff");
  return code && /^[A-Za-z0-9_-]{16,128}$/.test(code) ? code : null;
}

/** Drops `handoff` from the address bar (it is single-use; keeps any other params). */
function stripHandoffFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("handoff");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/** "Continue with Google" with an "or" divider (above the code form, or below the password form). */
function GoogleBlock({ busy, onClick, label, busyLabel, or, below, alone }: { busy: boolean; onClick: () => void; label: string; busyLabel: string; or: string; below?: boolean; alone?: boolean }) {
  const divider = (
    <div className={cn("flex items-center gap-3 text-xs text-muted-foreground", below ? "mt-4" : "my-4")} aria-hidden="true">
      <span className="h-px flex-1 bg-border" />
      {or}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
  const button = (
    <Button type="button" variant="outline" size="lg" className="w-full" disabled={busy} onClick={onClick} data-testid="google-signin">
      {busy ? <Loader2Icon className="animate-spin" /> : <GoogleG />}
      {busy ? busyLabel : label}
    </Button>
  );
  if (alone) return button;
  return below ? (
    <>
      {divider}
      {button}
    </>
  ) : (
    <>
      {button}
      {divider}
    </>
  );
}

/**
 * Sign-in for the current shop's staff: the methods the shop switched on, preferred one first (code by SMS /
 * WhatsApp / email, Google, email + password). Verifies with the address the user TYPED (normalised): the OTP request only
 * returns a masked target for display. `home` is where to go once signed in.
 */
export function LoginScreen({ home = "/" }: { home?: string }) {
  const { t, locale } = useI18n();
  const { shopName } = useShop();
  const router = useRouter();
  const qc = useQueryClient();
  const hydrated = useHydrated();
  const token = useToken();

  const [step, setStep] = React.useState<"identify" | "verify">("identify");
  /** Step 1 passed but the account needs two-factor (or the shop requires setting it up): the second step shows. */
  const [mfa, setMfa] = React.useState<MfaRequiredResponse | null>(null);
  const [raw, setRaw] = React.useState("");
  const [phoneChannel, setPhoneChannel] = React.useState<"sms" | "whatsapp">("sms");
  const [touched, setTouched] = React.useState(false);
  const [sent, setSent] = React.useState<OtpRequestResponse | null>(null);
  /**
   * The exact address the code was sent to, as the user typed it (normalised). The OTP request
   * response only carries a MASKED target for display; verifying with that one always fails.
   */
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [code, setCode] = React.useState("");
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [resendAt, setResendAt] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  /** Set while the code was sent by Firebase (phone + SMS); verify then exchanges its ID token. */
  const firebaseCode = React.useRef<FirebasePhoneCode | null>(null);

  // The shop decides which ways of signing in staff get (Settings -> Sign-in options); the API enforces it too.
  const slug = useTenantSlug();
  const cfg = useQuery({
    queryKey: ["auth", "sign-in-config", slug ?? null],
    queryFn: () => api.get<AuthClientConfig>("/auth/config", { audience: "staff" }, { anonymous: true }),
    staleTime: 60_000,
    retry: 1,
  });
  const methods: SignInMethod[] = cfg.data?.signIn?.methods ?? LEGACY_METHODS;
  const smsOn = methods.includes("sms");
  const whatsappOn = methods.includes("whatsapp");
  const emailOn = methods.includes("email_code");
  const googleOn = methods.includes("google");
  const passwordOn = methods.includes("password");
  const phoneOn = smsOn || whatsappOn;
  const codeOn = phoneOn || emailOn;
  const firstMethod = cfg.data?.signIn?.default ?? methods[0];
  const [view, setView] = React.useState<"code" | "password" | null>(null);
  const activeView: "code" | "password" = view ?? (passwordOn && (firstMethod === "password" || !codeOn) ? "password" : "code");
  const [googleBusy, setGoogleBusy] = React.useState(false);

  const parsed = normalizeTarget(raw);
  const phoneCh: "sms" | "whatsapp" = phoneChannel === "whatsapp" ? (whatsappOn || !smsOn ? "whatsapp" : "sms") : smsOn || !whatsappOn ? "sms" : "whatsapp";
  const channel: Channel = parsed.kind === "email" ? "email" : phoneCh;

  /**
   * `?handoff=<code>`: the landing site (sign-up, "Open my shop") hands over a single-use 60 s code, redeemed here for
   * this origin's own session. Read once on mount; the code is removed from the address bar right away.
   */
  const [handoff, setHandoff] = React.useState<"idle" | "redeeming" | "failed">("idle");
  // Set synchronously in the effect below so the "already signed in" redirect (same commit) waits for the handoff.
  const handoffPending = React.useRef(false);
  const redeemStarted = React.useRef(false);
  React.useEffect(() => {
    const code = handoffCodeFromUrl();
    if (!code || redeemStarted.current) return;
    redeemStarted.current = true;
    handoffPending.current = true;
    setHandoff("redeeming");
    stripHandoffFromUrl();
    api
      .post<SignInResponse>("/auth/handoff/redeem", { code }, { anonymous: true })
      .then((res) => {
        setToken(res.token);
        qc.removeQueries({ queryKey: meQueryKey });
        router.replace(home);
      })
      .catch(() => {
        handoffPending.current = false;
        setHandoff("failed");
      });
  }, [qc, router, home]);

  // Already signed in → straight in (not while a handoff decides who signs in).
  React.useEffect(() => {
    if (handoffPending.current) return;
    if (hydrated && token && step === "identify" && !sent && handoff !== "redeeming") router.replace(home);
  }, [hydrated, token, step, sent, router, home, handoff]);

  React.useEffect(() => {
    if (step !== "verify") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [step]);
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const request = useMutation({
    mutationFn: async (target: string): Promise<{ res: OtpRequestResponse; target: string } | null> => {
      const kind = normalizeTarget(target).kind;
      const method = await resolvePhoneMethod({ kind, target, channel }, fetchAuthConfig);
      firebaseCode.current = null;
      if (method === "firebase") {
        if (!isFirebaseAuthHost(window.location.hostname)) {
          // Firebase can't run on this host (shop subdomains aren't authorized domains): verify on the landing site,
          // which hands the session back to this page with a `?handoff=` code.
          window.location.assign(phoneSignInRedirectUrl(WWW_URL, target, `${window.location.origin}${window.location.pathname}`));
          return null;
        }
        firebaseCode.current = await sendFirebasePhoneCode(target, { locale });
        return { res: { target: maskPhone(target), channel: "sms", expiresInSeconds: 300, resendInSeconds: 30 }, target };
      }
      const res = await api.post<OtpRequestResponse>("/auth/otp/request", { target, channel });
      return { res, target };
    },
    onSuccess: (r) => {
      if (!r) return; // navigating to the landing site
      const { res, target } = r;
      setSentTo(target);
      setSent(res);
      setCode("");
      setCodeError(null);
      setResendAt(Date.now() + (res.resendInSeconds ?? 30) * 1000);
      setNow(Date.now());
      setStep("verify");
    },
    onError: (err) => toast.error(isFirebaseError(err) ? firebasePhoneMessage(err, locale) : describeError(err, t)),
  });

  /** A session came back (code, Firebase token or handoff): keep it and go in. */
  const completeSignIn = (res: SignInResponse) => {
    setToken(res.token);
    qc.removeQueries({ queryKey: meQueryKey });
    toast.success(res.isNewUser ? t("web.login.welcomeNew") : t("web.login.welcomeBack"));
    router.replace(home);
  };

  /** Step 1 result: a session, or the two-factor challenge (no session yet). */
  const onStepOne = (res: SignInResponse | MfaRequiredResponse) => (isMfaRequired(res) ? setMfa(res) : completeSignIn(res));

  /** Firebase proved the email (password) or the Google account: trade its ID token for our session. */
  const exchangeFirebase = async (idToken: string) => {
    onStepOne(await api.post<SignInResponse | MfaRequiredResponse>("/auth/firebase", { idToken }, { anonymous: true }));
  };

  /** Google and email + password run in place on hosts Firebase authorizes; elsewhere on the landing site, which hands back here. */
  const inPlace = () => isFirebaseAuthHost(window.location.hostname);
  const viaLanding = (method: "google" | "password") =>
    window.location.assign(methodSignInRedirectUrl(WWW_URL, method, `${window.location.origin}${window.location.pathname}`, slug));

  const onGoogle = async () => {
    if (!inPlace()) return viaLanding("google");
    setGoogleBusy(true);
    try {
      await exchangeFirebase(await signInWithGoogle({ locale }));
    } catch (err) {
      toast.error(isFirebaseError(err) ? firebasePhoneMessage(err, locale) : describeError(err, t));
    } finally {
      setGoogleBusy(false);
    }
  };

  const verify = useMutation({
    mutationFn: async (otp: string) => {
      if (!sentTo) throw new Error(t("web.login.restart"));
      const fb = firebaseCode.current;
      if (fb) return api.post<SignInResponse | MfaRequiredResponse>("/auth/firebase", { idToken: await fb.confirm(otp) }, { anonymous: true });
      return api.post<SignInResponse | MfaRequiredResponse>("/auth/otp/verify", { target: sentTo, code: otp });
    },
    onSuccess: onStepOne,
    onError: (err) => {
      setCode("");
      if (isFirebaseError(err)) return setCodeError(firebasePhoneMessage(err, locale));
      setCodeError(err instanceof ApiError && err.status < 500 ? t("web.login.invalidCode") : describeError(err, t));
    },
  });

  const onIdentify = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (parsed.kind === "invalid") return;
    if (parsed.kind === "phone" && !phoneOn) return void toast.error(t("web.login.phoneOff"));
    if (parsed.kind === "email" && !emailOn) return void toast.error(t("web.login.emailOff"));
    request.mutate(parsed.target);
  };

  return (
    <AuthLayout
      logo={<BrandMark size="xl" showName={false} />}
      corner={
        <>
          <LocaleSwitcher />
          <ThemeToggle />
        </>
      }
      footer={t("web.login.footer")}
    >
      <AnimatePresence mode="wait" initial={false}>
        {handoff === "redeeming" ? (
          <SlideIn key="handoff" direction="up" distance={12}>
            <div className="grid justify-items-center gap-3 py-6 text-center" role="status" aria-live="polite">
              <Loader2Icon className="size-8 animate-spin text-primary" />
              <h1 className="font-heading text-xl font-semibold tracking-tight">{t("web.login.handoff")}</h1>
              <p className="text-sm text-muted-foreground">{t("web.login.handoffHint")}</p>
            </div>
          </SlideIn>
        ) : mfa ? (
          <SlideIn key="mfa" direction="left" distance={16}>
            <MfaChallenge
              challenge={mfa}
              onSession={completeSignIn}
              onBack={() => {
                setMfa(null);
                setCode("");
                setCodeError(null);
                setStep("identify");
                setSent(null);
                setSentTo(null);
                firebaseCode.current = null;
              }}
            />
          </SlideIn>
        ) : cfg.isPending ? (
          <SlideIn key="config" direction="up" distance={12}>
            <div className="grid justify-items-center py-10" role="status" aria-live="polite">
              <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
            </div>
          </SlideIn>
        ) : methods.length === 0 || (!codeOn && !passwordOn && !googleOn) ? (
          <SlideIn key="none" direction="up" distance={12}>
            <p role="alert" className="py-8 text-center text-sm text-muted-foreground">
              {t("web.login.noMethods")}
            </p>
          </SlideIn>
        ) : step === "identify" && activeView === "password" ? (
          <SlideIn key="password" direction="right" distance={16}>
            {handoff === "failed" && (
              <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {t("web.login.handoffExpired")}
              </p>
            )}
            {inPlace() ? (
              <PasswordSignIn exchange={exchangeFirebase} onUseCode={codeOn ? () => setView("code") : undefined} />
            ) : (
              <div className="grid gap-4 text-center">
                <h1 className="font-heading text-xl font-semibold tracking-tight">{t("web.login.passwordTitle")}</h1>
                <Button size="lg" onClick={() => viaLanding("password")}>
                  {t("web.login.signInPassword")}
                </Button>
                {codeOn && (
                  <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => setView("code")}>
                    {t("web.login.useCode")}
                  </Button>
                )}
              </div>
            )}
            {googleOn && (
              <GoogleBlock busy={googleBusy} onClick={() => void onGoogle()} label={t("web.login.google")} busyLabel={t("web.login.googleBusy")} or={t("web.login.or")} below />
            )}
          </SlideIn>
        ) : step === "identify" ? (
          <SlideIn key="identify" direction="right" distance={16}>
            <div className="mb-6 space-y-1.5 text-center">
              <h1 className="font-heading text-xl font-semibold tracking-tight">{t("web.login.title", { shop: shopName })}</h1>
              {codeOn && <p className="text-sm text-muted-foreground">{t("web.login.subtitle")}</p>}
            </div>
            {googleOn && (
              <GoogleBlock busy={googleBusy} onClick={() => void onGoogle()} label={t("web.login.google")} busyLabel={t("web.login.googleBusy")} or={t("web.login.or")} alone={!codeOn} />
            )}
            {handoff === "failed" && (
              <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {t("web.login.handoffExpired")}
              </p>
            )}
            {codeOn && <form onSubmit={onIdentify} className="grid gap-4" noValidate>
              <Field id="target">
                <FieldLabel>{t(phoneOn && emailOn ? "web.login.targetLabel" : phoneOn ? "web.login.targetLabelPhone" : "web.login.targetLabelEmail")}</FieldLabel>
                <div className="relative">
                  {parsed.kind === "email" ? (
                    <MailIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  ) : (
                    <SmartphoneIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  )}
                  <FieldControl>
                    <Input
                      autoFocus
                      autoComplete="username"
                      // One box takes a phone number or an email, so never lock it to the number pad (no letters for an email).
                      inputMode={raw.includes("@") || /[a-z]/i.test(raw) ? "email" : "text"}
                      placeholder={t("web.login.targetPlaceholder")}
                      value={raw}
                      onChange={(e) => setRaw(e.target.value)}
                      size="lg"
                      className="pl-9 text-base"
                    />
                  </FieldControl>
                </div>
                {touched && parsed.kind === "invalid" ? (
                  <FieldError>{t("web.login.targetInvalid")}</FieldError>
                ) : (
                  phoneOn && <FieldHint>{t("web.login.targetHint")}</FieldHint>
                )}
              </Field>

              {parsed.kind === "phone" && smsOn && whatsappOn && (
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("web.login.channel")}>
                  {(["sms", "whatsapp"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={phoneCh === c}
                      onClick={() => setPhoneChannel(c)}
                      className={cn(
                        "flex items-center justify-center gap-2 rounded-md border text-sm transition-colors",
                        controlHeight("lg"),
                        phoneCh === c ? "border-primary bg-primary/5 font-medium text-foreground" : "text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {c === "sms" ? <SmartphoneIcon className="size-4" /> : <MessageCircleIcon className="size-4" />}
                      {t(`web.login.channel.${c}`)}
                    </button>
                  ))}
                </div>
              )}

              <Button type="submit" size="lg" disabled={request.isPending || !raw.trim()}>
                {request.isPending && <Loader2Icon className="animate-spin" />}
                {t("web.login.sendCode")}
              </Button>
              {passwordOn && (
                <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => setView("password")}>
                  {t("web.login.usePassword")}
                </Button>
              )}
            </form>}
          </SlideIn>
        ) : (
          <SlideIn key="verify" direction="left" distance={16}>
            <div className="mb-6 space-y-1.5 text-center">
              <h1 className="font-heading text-xl font-semibold tracking-tight">{t("web.login.verifyTitle")}</h1>
              <p className="text-sm text-muted-foreground">
                {/* Display only: the masked target from the API (or what was typed). */}
                {t(`web.login.sentVia.${sent?.channel ?? "sms"}`, { target: sent?.target ?? sentTo ?? "" })}
              </p>
            </div>
            <form
              className="grid gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.length === OTP_LENGTH) verify.mutate(code);
              }}
            >
              <div className="grid justify-items-center gap-2">
                <OtpInput
                  length={OTP_LENGTH}
                  value={code}
                  onChange={(v) => {
                    setCode(v);
                    setCodeError(null);
                  }}
                  onComplete={(v) => verify.mutate(v)}
                  disabled={verify.isPending}
                  invalid={!!codeError}
                  autoFocus
                  aria-label={t("web.login.digit")}
                />
                <p className={cn("min-h-4 text-xs", codeError ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
                  {codeError ??
                    (sent ? t("web.login.expiresIn", { minutes: Math.max(1, Math.round((sent.expiresInSeconds ?? 300) / 60)) }) : "")}
                </p>
              </div>
              <Button type="submit" size="lg" disabled={verify.isPending || code.length !== OTP_LENGTH}>
                {verify.isPending && <Loader2Icon className="animate-spin" />}
                {t("web.login.verify")}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <Button
                  type="button"
                  variant="ghost"
                  className="-ml-2 text-muted-foreground"
                  onClick={() => {
                    setStep("identify");
                    setSent(null);
                    setSentTo(null);
                    firebaseCode.current = null;
                  }}
                >
                  <ArrowLeftIcon /> {t("web.login.change")}
                </Button>
                <Button
                  type="button"
                  variant="link"
                  className="tabular-nums"
                  disabled={resendIn > 0 || request.isPending || !sentTo}
                  onClick={() => sentTo && request.mutate(sentTo)}
                >
                  {resendIn > 0 ? t("web.login.resendIn", { seconds: resendIn }) : t("web.login.resend")}
                </Button>
              </div>
            </form>
          </SlideIn>
        )}
      </AnimatePresence>
    </AuthLayout>
  );
}
