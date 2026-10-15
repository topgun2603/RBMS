"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, Loader2Icon, MailIcon, MessageCircleIcon, SmartphoneIcon } from "lucide-react";
import { AnimatePresence, AuthLayout, Button, cn, Input, Label, OtpInput, SlideIn, toast } from "@srirealtime/ui";
import { BrandMark } from "../components/brand-mark";
import { LocaleSwitcher } from "../components/locale-switcher";
import { ThemeToggle } from "../components/theme-toggle";
import { api, ApiError } from "../lib/api";
import { meQueryKey } from "../lib/auth";
import { useShop } from "../lib/branding";
import { normalizeTarget } from "../lib/format";
import { describeError, useI18n } from "../lib/i18n";
import { setToken, useHydrated, useToken } from "../lib/session";
import type { OtpRequestResponse, SignInResponse } from "../lib/types";

const OTP_LENGTH = 6;
type Channel = "sms" | "whatsapp" | "email";

/**
 * OTP sign-in for the current shop. Verifies with the address the user TYPED (normalised): the OTP request only
 * returns a masked target for display. `home` is where to go once signed in.
 */
export function LoginScreen({ home = "/" }: { home?: string }) {
  const { t } = useI18n();
  const { shopName } = useShop();
  const router = useRouter();
  const qc = useQueryClient();
  const hydrated = useHydrated();
  const token = useToken();

  const [step, setStep] = React.useState<"identify" | "verify">("identify");
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

  const parsed = normalizeTarget(raw);
  const channel: Channel = parsed.kind === "email" ? "email" : phoneChannel;

  // Already signed in → straight in.
  React.useEffect(() => {
    if (hydrated && token && step === "identify" && !sent) router.replace(home);
  }, [hydrated, token, step, sent, router, home]);

  React.useEffect(() => {
    if (step !== "verify") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [step]);
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const request = useMutation({
    mutationFn: async (target: string) => {
      const res = await api.post<OtpRequestResponse>("/auth/otp/request", { target, channel });
      return { res, target };
    },
    onSuccess: ({ res, target }) => {
      setSentTo(target);
      setSent(res);
      setCode("");
      setCodeError(null);
      setResendAt(Date.now() + (res.resendInSeconds ?? 30) * 1000);
      setNow(Date.now());
      setStep("verify");
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const verify = useMutation({
    mutationFn: (otp: string) => {
      if (!sentTo) throw new Error(t("web.login.restart"));
      return api.post<SignInResponse>("/auth/otp/verify", { target: sentTo, code: otp });
    },
    onSuccess: (res) => {
      setToken(res.token);
      qc.removeQueries({ queryKey: meQueryKey });
      toast.success(res.isNewUser ? t("web.login.welcomeNew") : t("web.login.welcomeBack"));
      router.replace(home);
    },
    onError: (err) => {
      setCode("");
      setCodeError(err instanceof ApiError && err.status < 500 ? t("web.login.invalidCode") : describeError(err, t));
    },
  });

  const onIdentify = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (parsed.kind === "invalid") return;
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
        {step === "identify" ? (
          <SlideIn key="identify" direction="right" distance={16}>
            <div className="mb-6 space-y-1.5 text-center">
              <h1 className="font-heading text-xl font-semibold tracking-tight">{t("web.login.title", { shop: shopName })}</h1>
              <p className="text-sm text-muted-foreground">{t("web.login.subtitle")}</p>
            </div>
            <form onSubmit={onIdentify} className="grid gap-4" noValidate>
              <div className="grid gap-2">
                <Label htmlFor="target">{t("web.login.targetLabel")}</Label>
                <div className="relative">
                  {parsed.kind === "email" ? (
                    <MailIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  ) : (
                    <SmartphoneIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  )}
                  <Input
                    id="target"
                    autoFocus
                    autoComplete="username"
                    inputMode={raw.includes("@") ? "email" : /^[\d\s+]*$/.test(raw) ? "tel" : "text"}
                    placeholder={t("web.login.targetPlaceholder")}
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                    aria-invalid={touched && parsed.kind === "invalid"}
                    className="h-11 pl-9 text-base"
                  />
                </div>
                {touched && parsed.kind === "invalid" ? (
                  <p className="text-xs text-destructive">{t("web.login.targetInvalid")}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("web.login.targetHint")}</p>
                )}
              </div>

              {parsed.kind === "phone" && (
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("web.login.channel")}>
                  {(["sms", "whatsapp"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={phoneChannel === c}
                      onClick={() => setPhoneChannel(c)}
                      className={cn(
                        "flex h-11 items-center justify-center gap-2 rounded-md border text-sm transition-colors",
                        phoneChannel === c ? "border-primary bg-primary/5 font-medium text-foreground" : "text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {c === "sms" ? <SmartphoneIcon className="size-4" /> : <MessageCircleIcon className="size-4" />}
                      {t(`web.login.channel.${c}`)}
                    </button>
                  ))}
                </div>
              )}

              <Button type="submit" size="lg" className="h-11" disabled={request.isPending || !raw.trim()}>
                {request.isPending && <Loader2Icon className="animate-spin" />}
                {t("web.login.sendCode")}
              </Button>
            </form>
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
              <Button type="submit" size="lg" className="h-11" disabled={verify.isPending || code.length !== OTP_LENGTH}>
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
