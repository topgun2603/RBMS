"use client";

import * as React from "react";
import QRCode from "qrcode";
import { useMutation } from "@tanstack/react-query";
import { CopyIcon, DownloadIcon, Loader2Icon, ShieldCheckIcon } from "lucide-react";
import { Button, OtpInput, toast } from "@srirealtime/ui";
import { ApiError } from "../lib/api";
import { describeError, useI18n } from "../lib/i18n";
import { confirmMfaEnrol, recoveryCodesText, startMfaEnrol, type MfaEnrolStart } from "../lib/mfa";
import type { SignInResponse } from "../lib/types";

/** The otpauth:// link as a QR code (PNG data URL), dark on white so every authenticator app reads it. */
function Qr({ value, alt }: { value: string; alt: string }) {
  const [src, setSrc] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 1, width: 360, errorCorrectionLevel: "M" })
      .then((url) => !cancelled && setSrc(url))
      .catch(() => !cancelled && setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [value]);
  return (
    <div className="size-44 shrink-0 rounded-lg bg-white p-2">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- generated data URL
        <img src={src} alt={alt} className="size-full" />
      ) : (
        <div className="size-full animate-pulse rounded bg-neutral-200" aria-hidden />
      )}
    </div>
  );
}

/** The 10 recovery codes, once: copy, download, and a confirmation before the caller carries on. */
export function RecoveryCodes({ codes, shop, onDone }: { codes: string[]; shop: string; onDone: () => void }) {
  const { t } = useI18n();
  const [saved, setSaved] = React.useState(false);
  const text = recoveryCodesText(codes, shop);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toast.success(t("web.mfa.codes.copied"));
    } catch {
      /* clipboard blocked: the codes are on screen */
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="grid gap-4" data-testid="mfa-recovery-codes">
      <div className="space-y-1">
        <h2 className="font-heading text-lg font-semibold tracking-tight">{t("web.mfa.codes.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("web.mfa.codes.hint")}</p>
      </div>
      <ul className="grid grid-cols-2 gap-2 rounded-xl border bg-muted/40 p-4 font-mono text-sm tabular-nums">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          <CopyIcon /> {t("web.mfa.codes.copy")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <DownloadIcon /> {t("web.mfa.codes.download")}
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-4" />
        {t("web.mfa.codes.saved")}
      </label>
      <Button type="button" disabled={!saved} onClick={onDone}>
        {t("web.mfa.codes.done")}
      </Button>
    </div>
  );
}

/**
 * Two-factor setup: get a secret, scan the QR code (or type the key), enter the first code. Used in Settings → Security
 * (signed in) and, when the shop requires two-factor, during sign-in with the `challengeToken` of step 1: then the
 * confirm call also returns the session (`onEnabled(codes, session)`).
 */
export function MfaEnrol({
  challengeToken,
  autoStart,
  onEnabled,
  onCancel,
}: {
  challengeToken?: string;
  autoStart?: boolean;
  onEnabled: (recoveryCodes: string[], session: SignInResponse | null) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [started, setStarted] = React.useState<MfaEnrolStart | null>(null);
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const start = useMutation({
    mutationFn: () => startMfaEnrol(challengeToken),
    onSuccess: setStarted,
    onError: (err) => toast.error(describeError(err, t)),
  });
  const startedOnce = React.useRef(false);
  React.useEffect(() => {
    if (autoStart && !startedOnce.current) {
      startedOnce.current = true;
      start.mutate();
    }
  }, [autoStart, start]);

  const confirm = useMutation({
    mutationFn: (c: string) => confirmMfaEnrol(c, challengeToken),
    onSuccess: (r) => {
      const { recoveryCodes, ...rest } = r;
      onEnabled(recoveryCodes, rest.token ? (rest as SignInResponse) : null);
    },
    onError: (err) => {
      setCode("");
      if (err instanceof ApiError && err.code === "mfa_challenge_invalid") return setError(t("web.mfa.challenge.expired"));
      if (err instanceof ApiError && err.status === 429) return setError(t("web.mfa.challenge.locked"));
      setError(err instanceof ApiError && err.status < 500 ? t("web.mfa.challenge.invalid") : describeError(err, t));
    },
  });

  if (!started) {
    return (
      <div className="grid gap-3">
        <Button type="button" onClick={() => start.mutate()} disabled={start.isPending}>
          {start.isPending ? <Loader2Icon className="animate-spin" /> : <ShieldCheckIcon />}
          {t("web.mfa.enrol.start")}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("web.mfa.enrol.cancel")}
          </Button>
        )}
      </div>
    );
  }
  const groups = started.secret.match(/.{1,4}/g)?.join(" ") ?? started.secret;
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6) confirm.mutate(code);
      }}
    >
      <p className="text-sm font-medium">{t("web.mfa.enrol.step1")}</p>
      <div className="flex flex-wrap items-center gap-4">
        <Qr value={started.otpauthUri} alt={t("web.mfa.enrol.qrAlt")} />
        <div className="min-w-0 space-y-2 text-sm">
          <p className="text-muted-foreground">{t("web.mfa.enrol.step1Alt")}</p>
          <p className="font-mono text-base tracking-wider break-all select-all" data-testid="mfa-secret">
            {groups}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void navigator.clipboard?.writeText(started.secret).then(() => toast.success(t("web.mfa.enrol.copied")), () => undefined)}
            >
              <CopyIcon /> {t("web.mfa.enrol.copy")}
            </Button>
            <Button type="button" variant="link" size="sm" asChild>
              <a href={started.otpauthUri}>{t("web.mfa.enrol.openApp")}</a>
            </Button>
          </div>
        </div>
      </div>
      <p className="text-sm font-medium">{t("web.mfa.enrol.step2")}</p>
      <div className="grid justify-items-start gap-2">
        <OtpInput
          length={6}
          value={code}
          onChange={(v) => {
            setCode(v);
            setError(null);
          }}
          onComplete={(v) => confirm.mutate(v)}
          disabled={confirm.isPending}
          invalid={!!error}
          autoFocus
          aria-label={t("web.login.digit")}
        />
        <p className={error ? "min-h-4 text-xs text-destructive" : "min-h-4 text-xs"} aria-live="polite">
          {error}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={confirm.isPending || code.length !== 6}>
          {confirm.isPending && <Loader2Icon className="animate-spin" />}
          {t("web.mfa.enrol.confirm")}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("web.mfa.enrol.cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}
