"use client";

import * as React from "react";
import QRCode from "qrcode";
import { Loader2Icon } from "lucide-react";
import { Button } from "@rbms/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@rbms/ui/components/dialog";
import { Input } from "@rbms/ui/components/input";
import { OtpInput } from "@rbms/ui/components/otp-input";
import { api, ApiError, setMfaPrompt, type MfaEnrolStart, type MfaRequired, type SignInResult } from "@/lib/api";
import { useSite } from "./site-context";

interface Pending {
  challenge: MfaRequired;
  resolve: (r: SignInResult) => void;
  reject: (e: unknown) => void;
}

/**
 * The second step of sign-in on the landing site (two-factor accounts, and shops that require it). Mounted once in the
 * root layout; `api.verifyOtp` / `api.firebaseSignIn` await it through `setMfaPrompt`, so every sign-in screen gets the
 * step without changes. A forced setup (the shop requires two-factor and the person has none) shows the QR code first.
 */
export function MfaDialog() {
  const { t } = useSite();
  const [pending, setPending] = React.useState<Pending | null>(null);
  React.useEffect(() => {
    setMfaPrompt(
      (challenge) =>
        new Promise<SignInResult>((resolve, reject) => {
          setPending((old) => {
            old?.reject(new ApiError(0, "cancelled", t("mfa.cancelled")));
            return { challenge, resolve, reject };
          });
        }),
    );
    return () => setMfaPrompt(null);
  }, [t]);

  const cancel = () => {
    pending?.reject(new ApiError(0, "cancelled", t("mfa.cancelled")));
    setPending(null);
  };
  const done = (r: SignInResult) => {
    pending?.resolve(r);
    setPending(null);
  };

  return (
    <Dialog open={!!pending} onOpenChange={(open) => !open && cancel()}>
      <DialogContent className="max-w-md" data-testid="mfa-dialog">
        {pending && (pending.challenge.enrolRequired ? <Enrol challenge={pending.challenge} onSession={done} onCancel={cancel} /> : <Verify challenge={pending.challenge} onSession={done} onCancel={cancel} />)}
      </DialogContent>
    </Dialog>
  );
}

function failure(err: unknown, t: (k: string) => string): string {
  if (err instanceof ApiError) {
    if (err.code === "mfa_challenge_invalid") return t("mfa.expired");
    if (err.status === 429) return t("mfa.locked");
    if (err.status < 500) return t("mfa.wrong");
  }
  return t("mfa.wrong");
}

function Verify({ challenge, onSession, onCancel }: { challenge: MfaRequired; onSession: (r: SignInResult) => void; onCancel: () => void }) {
  const { t } = useSite();
  const [recovery, setRecovery] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submit = async (value: string) => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      onSession(await api.mfaVerify(challenge.challengeToken, value.trim()));
    } catch (err) {
      setCode("");
      setError(failure(err, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(code);
      }}
    >
      <DialogHeader>
        <DialogTitle>{t("mfa.title")}</DialogTitle>
        <DialogDescription>{t("mfa.hint")}</DialogDescription>
      </DialogHeader>
      <div className="grid justify-items-center gap-2">
        {recovery ? (
          <Input
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="XXXX-XXXX"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
            className="font-mono tracking-wider"
            aria-label={t("mfa.recoveryLabel")}
          />
        ) : (
          <OtpInput
            length={6}
            value={code}
            onChange={(v) => {
              setCode(v);
              setError(null);
            }}
            onComplete={(v) => void submit(v)}
            disabled={busy}
            invalid={!!error}
            autoFocus
            aria-label={t("mfa.title")}
          />
        )}
        <p className="min-h-4 text-xs text-destructive" aria-live="polite">
          {error}
        </p>
      </div>
      <Button type="submit" disabled={busy || !code.trim()}>
        {busy && <Loader2Icon className="animate-spin" />}
        {t("mfa.verify")}
      </Button>
      <div className="flex items-center justify-between text-sm">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("mfa.cancel")}
        </Button>
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => {
            setRecovery((v) => !v);
            setCode("");
            setError(null);
          }}
        >
          {recovery ? t("mfa.useApp") : t("mfa.useRecovery")}
        </Button>
      </div>
    </form>
  );
}

function Enrol({ challenge, onSession, onCancel }: { challenge: MfaRequired; onSession: (r: SignInResult) => void; onCancel: () => void }) {
  const { t } = useSite();
  const [started, setStarted] = React.useState<MfaEnrolStart | null>(null);
  const [qr, setQr] = React.useState<string | null>(null);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<{ codes: string[]; session: SignInResult } | null>(null);
  const [ack, setAck] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    api
      .mfaEnrolStart(challenge.challengeToken)
      .then(async (s) => {
        if (!live) return;
        setStarted(s);
        setQr(await QRCode.toDataURL(s.otpauthUri, { margin: 1, width: 360, errorCorrectionLevel: "M" }));
      })
      .catch((err) => live && setError(failure(err, t)));
    return () => {
      live = false;
    };
  }, [challenge.challengeToken, t]);

  const confirm = async (value: string) => {
    if (busy || value.length !== 6) return;
    setBusy(true);
    try {
      const { recoveryCodes, ...session } = await api.mfaEnrolConfirm(challenge.challengeToken, value);
      setSaved({ codes: recoveryCodes, session: session as SignInResult });
    } catch (err) {
      setCode("");
      setError(failure(err, t));
    } finally {
      setBusy(false);
    }
  };

  if (saved) {
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle>{t("mfa.codes.title")}</DialogTitle>
          <DialogDescription>{t("mfa.codes.hint")}</DialogDescription>
        </DialogHeader>
        <ul className="grid grid-cols-2 gap-2 rounded-xl border bg-muted/40 p-4 font-mono text-sm tabular-nums">
          {saved.codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="size-4" />
          {t("mfa.codes.saved")}
        </label>
        <Button disabled={!ack} onClick={() => onSession(saved.session)}>
          {t("mfa.codes.done")}
        </Button>
      </div>
    );
  }
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void confirm(code);
      }}
    >
      <DialogHeader>
        <DialogTitle>{t("mfa.enrol.title")}</DialogTitle>
        <DialogDescription>{t("mfa.enrol.hint")}</DialogDescription>
      </DialogHeader>
      {started ? (
        <div className="flex flex-wrap items-center gap-4">
          <div className="size-40 shrink-0 rounded-lg bg-white p-2">
            {qr && (
              // eslint-disable-next-line @next/next/no-img-element -- generated data URL
              <img src={qr} alt={t("mfa.enrol.qrAlt")} className="size-full" />
            )}
          </div>
          <div className="min-w-0 space-y-1 text-sm">
            <p className="text-muted-foreground">{t("mfa.enrol.keyLabel")}</p>
            <p className="font-mono tracking-wider break-all select-all">{started.secret.match(/.{1,4}/g)?.join(" ")}</p>
          </div>
        </div>
      ) : (
        !error && <Loader2Icon className="mx-auto animate-spin text-muted-foreground" />
      )}
      <div className="grid justify-items-center gap-2">
        <OtpInput
          length={6}
          value={code}
          onChange={(v) => {
            setCode(v);
            setError(null);
          }}
          onComplete={(v) => void confirm(v)}
          disabled={busy || !started}
          invalid={!!error}
          aria-label={t("mfa.title")}
        />
        <p className="min-h-4 text-xs text-destructive" aria-live="polite">
          {error}
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !started || code.length !== 6}>
          {busy && <Loader2Icon className="animate-spin" />}
          {t("mfa.enrol.confirm")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("mfa.cancel")}
        </Button>
      </div>
    </form>
  );
}
