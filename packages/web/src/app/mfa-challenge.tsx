"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeftIcon, Loader2Icon } from "lucide-react";
import { Button, Field, FieldControl, FieldLabel, Input, OtpInput, toast } from "@rbms/ui";
import { MfaEnrol, RecoveryCodes } from "../components/mfa-enrol";
import { ApiError } from "../lib/api";
import { useShop } from "../lib/branding";
import { describeError, useI18n } from "../lib/i18n";
import { verifyMfaSignIn, type MfaRequiredResponse } from "../lib/mfa";
import type { SignInResponse } from "../lib/types";

/**
 * Step 2 of staff sign-in (after the OTP / Google / Firebase step): the 6-digit code from the authenticator app, or a
 * recovery code. When the shop requires two-factor and the user has none yet (`enrolRequired`), the setup comes first
 * and its confirmation signs the user in. `onSession` receives the session.
 */
export function MfaChallenge({ challenge, onSession, onBack }: { challenge: MfaRequiredResponse; onSession: (res: SignInResponse) => void; onBack: () => void }) {
  const { t } = useI18n();
  const { shopName } = useShop();
  const [useRecovery, setUseRecovery] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [recovery, setRecovery] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  /** After a forced setup: the session waits until the recovery codes were saved. */
  const [enrolled, setEnrolled] = React.useState<{ codes: string[]; session: SignInResponse } | null>(null);

  const verify = useMutation({
    mutationFn: (c: string) => verifyMfaSignIn(challenge.challengeToken, c),
    onSuccess: (res) => {
      if (useRecovery) toast.message(t("web.mfa.challenge.recoveryUsed"));
      onSession(res);
    },
    onError: (err) => {
      setCode("");
      if (err instanceof ApiError && err.code === "mfa_challenge_invalid") return setError(t("web.mfa.challenge.expired"));
      if (err instanceof ApiError && err.status === 429) return setError(t("web.mfa.challenge.locked"));
      setError(err instanceof ApiError && err.status < 500 ? t("web.mfa.challenge.invalid") : describeError(err, t));
    },
  });

  if (enrolled) {
    return <RecoveryCodes codes={enrolled.codes} shop={shopName} onDone={() => onSession(enrolled.session)} />;
  }

  if (challenge.enrolRequired) {
    return (
      <div className="grid gap-4">
        <div className="space-y-1.5 text-center">
          <h1 className="font-heading text-xl font-semibold tracking-tight">{t("web.mfa.required.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("web.mfa.required.hint")}</p>
        </div>
        <MfaEnrol
          challengeToken={challenge.challengeToken}
          autoStart
          onCancel={onBack}
          onEnabled={(codes, session) => (session ? setEnrolled({ codes, session }) : toast.error(t("web.mfa.challenge.expired")))}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="space-y-1.5 text-center">
        <h1 className="font-heading text-xl font-semibold tracking-tight">{t("web.mfa.challenge.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("web.mfa.challenge.hint")}</p>
      </div>
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          const c = useRecovery ? recovery.trim() : code;
          if (c) verify.mutate(c);
        }}
      >
        {useRecovery ? (
          <Field id="mfa-recovery">
            <FieldLabel>{t("web.mfa.challenge.recoveryLabel")}</FieldLabel>
            <FieldControl>
              <Input
                autoFocus
                autoComplete="off"
                autoCapitalize="characters"
                placeholder={t("web.mfa.challenge.recoveryPlaceholder")}
                value={recovery}
                onChange={(e) => {
                  setRecovery(e.target.value);
                  setError(null);
                }}
                size="lg"
                className="font-mono text-base tracking-wider"
              />
            </FieldControl>
          </Field>
        ) : (
          <div className="grid justify-items-center">
            <OtpInput
              length={6}
              value={code}
              onChange={(v) => {
                setCode(v);
                setError(null);
              }}
              onComplete={(v) => verify.mutate(v)}
              disabled={verify.isPending}
              invalid={!!error}
              autoFocus
              aria-label={t("web.login.digit")}
            />
          </div>
        )}
        <p className={error ? "min-h-4 text-center text-xs text-destructive" : "min-h-4 text-center text-xs"} aria-live="polite">
          {error}
        </p>
        <Button type="submit" size="lg" disabled={verify.isPending || (useRecovery ? !recovery.trim() : code.length !== 6)}>
          {verify.isPending && <Loader2Icon className="animate-spin" />}
          {t("web.mfa.challenge.verify")}
        </Button>
        <div className="flex items-center justify-between text-sm">
          <Button type="button" variant="ghost" className="-ml-2 text-muted-foreground" onClick={onBack}>
            <ArrowLeftIcon /> {t("web.mfa.challenge.back")}
          </Button>
          <Button
            type="button"
            variant="link"
            onClick={() => {
              setUseRecovery((v) => !v);
              setError(null);
            }}
          >
            {useRecovery ? t("web.mfa.challenge.useApp") : t("web.mfa.challenge.useRecovery")}
          </Button>
        </div>
      </form>
    </div>
  );
}
