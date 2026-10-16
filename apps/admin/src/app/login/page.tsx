"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
  Separator,
  SlideIn,
  toast,
} from "@srirealtime/ui";
import { BrandMark } from "@/components/brand-mark";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { api, ApiError, GOOGLE_CLIENT_ID } from "@/lib/api";
import { normalizeTarget } from "@/lib/format";
import { describeError, useI18n } from "@/lib/i18n";
import { getTenantSlug, setTenantSlug, setToken, useHydrated, useToken } from "@/lib/session";
import type { MyTenant, OtpRequestResponse, SignInResponse } from "@/lib/types";
import {
  firebasePhoneMessage,
  isFirebaseError,
  resolvePhoneMethod,
  sendFirebasePhoneCode,
  type AuthClientConfig,
  type FirebasePhoneCode,
} from "@srirealtime/web/firebase-phone";

const OTP_LENGTH = 6;
type Channel = "sms" | "whatsapp" | "email";

const fetchAuthConfig = () => api.get<AuthClientConfig>("/auth/config", undefined, { tenant: null });
const maskPhone = (p: string) => (p.length <= 4 ? p : `${p.slice(0, 3)}${"*".repeat(Math.max(0, p.length - 7))}${p.slice(-4)}`);

/** Where to go after signing in: last workspace if still a member, the only workspace, or the picker. */
async function nextRoute(isSuperAdmin: boolean): Promise<string> {
  try {
    const { items } = await api.get<{ items: MyTenant[] }>("/tenancy/mine", undefined, { tenant: null });
    const stored = getTenantSlug();
    if (stored && items.some((m) => m.tenant.slug === stored)) return "/";
    if (items.length === 1 && items[0]) {
      setTenantSlug(items[0].tenant.slug);
      return "/";
    }
    if (items.length === 0 && isSuperAdmin) return "/platform/tenants";
  } catch {
    // fall through to the picker
  }
  return "/select-tenant";
}

export default function LoginPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const hydrated = useHydrated();
  const token = useToken();

  const [step, setStep] = React.useState<"identify" | "verify">("identify");
  const [raw, setRaw] = React.useState("");
  const [phoneChannel, setPhoneChannel] = React.useState<"sms" | "whatsapp">("sms");
  const [touched, setTouched] = React.useState(false);
  const [sent, setSent] = React.useState<OtpRequestResponse | null>(null);
  const [code, setCode] = React.useState("");
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [resendAt, setResendAt] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  /** Set while the code was sent by Firebase (phone + SMS); verify then exchanges its ID token. */
  const firebaseCode = React.useRef<FirebasePhoneCode | null>(null);

  const parsed = normalizeTarget(raw);
  const channel: Channel = parsed.kind === "email" ? "email" : phoneChannel;

  // Already signed in → straight in.
  React.useEffect(() => {
    if (hydrated && token && step === "identify" && !sent) router.replace("/");
  }, [hydrated, token, step, sent, router]);

  React.useEffect(() => {
    if (step !== "verify") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [step]);
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const finish = async (res: SignInResponse) => {
    setToken(res.token);
    qc.clear();
    toast.success(res.isNewUser ? t("admin.login.welcomeNew") : t("admin.login.welcomeBack"));
    router.replace(await nextRoute(res.user.platformRoles.includes("superadmin")));
  };

  // The address the code was sent to. `sent.target` is masked for display and can't be used to verify.
  const [sentTo, setSentTo] = React.useState<string | null>(null);

  const request = useMutation({
    mutationFn: async () => {
      const target = parsed.target;
      firebaseCode.current = null;
      // The admin runs on one fixed host (localhost:3000 / admin.<domain>), which is a Firebase authorized domain.
      if ((await resolvePhoneMethod({ kind: parsed.kind, target, channel }, fetchAuthConfig)) === "firebase") {
        firebaseCode.current = await sendFirebasePhoneCode(target, { locale });
        const res: OtpRequestResponse = { target: maskPhone(target), channel: "sms", expiresInSeconds: 300, resendInSeconds: 30 };
        return { res, target };
      }
      const res = await api.post<OtpRequestResponse>("/auth/otp/request", { target, channel }, { tenant: null });
      return { res, target };
    },
    onSuccess: ({ res, target }) => {
      setSentTo(target);
      setSent(res);
      setCode("");
      setCodeError(null);
      setResendAt(Date.now() + res.resendInSeconds * 1000);
      setNow(Date.now());
      setStep("verify");
    },
    onError: (err) => toast.error(isFirebaseError(err) ? firebasePhoneMessage(err, locale) : describeError(err, t)),
  });

  const verify = useMutation({
    mutationFn: async (otp: string) => {
      const fb = firebaseCode.current;
      if (fb) return api.post<SignInResponse>("/auth/firebase", { idToken: await fb.confirm(otp) }, { tenant: null });
      return api.post<SignInResponse>("/auth/otp/verify", { target: sentTo ?? parsed.target, code: otp }, { tenant: null });
    },
    onSuccess: finish,
    onError: (err) => {
      setCode("");
      if (isFirebaseError(err)) return setCodeError(firebasePhoneMessage(err, locale));
      setCodeError(err instanceof ApiError && err.status < 500 ? t("admin.login.invalidCode") : describeError(err, t));
    },
  });

  const google = useMutation({
    mutationFn: (idToken: string) => api.post<SignInResponse>("/auth/google", { idToken }, { tenant: null }),
    onSuccess: finish,
    onError: (err) => toast.error(describeError(err, t)),
  });

  const onIdentify = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (parsed.kind === "invalid") return;
    request.mutate();
  };

  return (
    <AuthLayout
      logo={<BrandMark size="lg" />}
      corner={
        <>
          <LocaleSwitcher />
          <ThemeToggle />
        </>
      }
      footer={t("admin.login.footer")}
    >
      <AnimatePresence mode="wait" initial={false}>
        {step === "identify" ? (
          <SlideIn key="identify" direction="right" distance={16}>
            <div className="mb-6 space-y-1.5 text-center">
              <h1 className="font-heading text-xl font-semibold tracking-tight">{t("admin.login.title")}</h1>
              <p className="text-sm text-muted-foreground">{t("admin.login.subtitle")}</p>
            </div>
            <form onSubmit={onIdentify} className="grid gap-4" noValidate>
              <Field id="target">
                <FieldLabel>{t("admin.login.targetLabel")}</FieldLabel>
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
                      inputMode={raw.includes("@") ? "email" : "text"}
                      placeholder={t("admin.login.targetPlaceholder")}
                      value={raw}
                      onChange={(e) => setRaw(e.target.value)}
                      className="pl-9"
                    />
                  </FieldControl>
                </div>
                {touched && parsed.kind === "invalid" ? (
                  <FieldError>{t("admin.login.targetInvalid")}</FieldError>
                ) : (
                  <FieldHint>{t("admin.login.targetHint")}</FieldHint>
                )}
              </Field>

              {parsed.kind === "phone" && (
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("admin.login.channel")}>
                  {(["sms", "whatsapp"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={phoneChannel === c}
                      onClick={() => setPhoneChannel(c)}
                      className={cn(
                        "flex items-center justify-center gap-2 rounded-md border text-sm transition-colors",
                        controlHeight(),
                        phoneChannel === c ? "border-primary bg-primary/5 font-medium text-foreground" : "text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {c === "sms" ? <SmartphoneIcon className="size-4" /> : <MessageCircleIcon className="size-4" />}
                      {t(`admin.login.channel.${c}`)}
                    </button>
                  ))}
                </div>
              )}

              <Button type="submit" size="lg" disabled={request.isPending || !raw.trim()}>
                {request.isPending && <Loader2Icon className="animate-spin" />}
                {t("admin.login.sendCode")}
              </Button>
            </form>

            {GOOGLE_CLIENT_ID && (
              <>
                <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                  <Separator className="flex-1" />
                  {t("admin.login.or")}
                  <Separator className="flex-1" />
                </div>
                <GoogleButton onCredential={(c) => google.mutate(c)} busy={google.isPending} />
              </>
            )}
          </SlideIn>
        ) : (
          <SlideIn key="verify" direction="left" distance={16}>
            <div className="mb-6 space-y-1.5 text-center">
              <h1 className="font-heading text-xl font-semibold tracking-tight">{t("admin.login.verifyTitle")}</h1>
              <p className="text-sm text-muted-foreground">
                {t(`admin.login.sentVia.${sent?.channel ?? "sms"}`, { target: sent?.target ?? parsed.target })}
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
                  aria-label={t("admin.login.digit")}
                />
                <p className={cn("min-h-4 text-xs", codeError ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
                  {codeError ??
                    (sent ? t("admin.login.expiresIn", { minutes: Math.max(1, Math.round(sent.expiresInSeconds / 60)) }) : "")}
                </p>
              </div>
              <Button type="submit" size="lg" disabled={verify.isPending || code.length !== OTP_LENGTH}>
                {verify.isPending && <Loader2Icon className="animate-spin" />}
                {t("admin.login.verify")}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-ml-2 text-muted-foreground"
                  onClick={() => {
                    setStep("identify");
                    setSent(null);
                    firebaseCode.current = null;
                  }}
                >
                  <ArrowLeftIcon /> {t("admin.login.change")}
                </Button>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="tabular-nums"
                  disabled={resendIn > 0 || request.isPending}
                  onClick={() => request.mutate()}
                >
                  {resendIn > 0 ? t("admin.login.resendIn", { seconds: resendIn }) : t("admin.login.resend")}
                </Button>
              </div>
            </form>
          </SlideIn>
        )}
      </AnimatePresence>
    </AuthLayout>
  );
}

// ---- Google Identity Services

interface GoogleCredentialResponse {
  credential: string;
}
interface GoogleIdApi {
  initialize(opts: { client_id: string; callback: (r: GoogleCredentialResponse) => void; ux_mode?: "popup" }): void;
  renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

function loadGsi(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.getElementById("gsi-client") as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("Failed to load Google sign-in")));
    if (!existing) {
      script.id = "gsi-client";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
}

function GoogleButton({ onCredential, busy }: { onCredential: (idToken: string) => void; busy: boolean }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const { locale } = useI18n();
  const cb = React.useRef(onCredential);
  cb.current = onCredential;

  React.useEffect(() => {
    let cancelled = false;
    loadGsi()
      .then(() => {
        if (cancelled || !ref.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (r) => cb.current(r.credential),
          ux_mode: "popup",
        });
        ref.current.innerHTML = "";
        window.google.accounts.id.renderButton(ref.current, {
          type: "standard",
          theme: document.documentElement.classList.contains("dark") ? "filled_black" : "outline",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          width: ref.current.offsetWidth || 320,
          locale,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [locale]);

  return (
    <div className={cn("relative flex min-h-10 justify-center", busy && "pointer-events-none opacity-60")}>
      <div ref={ref} className="w-full [&>div]:mx-auto" />
      {busy && <Loader2Icon className="absolute top-1/2 left-1/2 size-5 -translate-1/2 animate-spin" />}
    </div>
  );
}
