"use client";

import * as React from "react";
import { KeyRoundIcon, Loader2Icon, LockIcon, ShieldCheckIcon, ShieldIcon } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Skeleton, Switch, toast } from "@srirealtime/ui";
import { MfaEnrol, RecoveryCodes } from "../components/mfa-enrol";
import { Page, PageHeading } from "../components/page";
import { QueryError } from "../components/query-state";
import { SettingsNav } from "../components/settings-nav";
import { useShop } from "../lib/branding";
import { describeError, useI18n } from "../lib/i18n";
import { mfaStatusKey, useDisableMfa, useMfaStatus, useRegenerateRecoveryCodes } from "../lib/mfa";
import { useSaveSignInSettings, useSignInSettings } from "../lib/sign-in-settings";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "./session";

/** Settings → Security: your own two-factor sign-in, recovery codes, and (owner / admin) the shop-wide requirement. */
export default function SecurityPage() {
  const { t, locale } = useI18n();
  const { shopName } = useShop();
  const { canManage } = useSession();
  const qc = useQueryClient();
  const status = useMfaStatus();
  const disable = useDisableMfa();
  const regenerate = useRegenerateRecoveryCodes();
  const [enrolling, setEnrolling] = React.useState(false);
  const [codes, setCodes] = React.useState<string[] | null>(null);
  const [mode, setMode] = React.useState<"disable" | "regenerate" | null>(null);
  const [code, setCode] = React.useState("");

  const run = () => {
    const c = code.trim();
    if (!c || !mode) return;
    if (mode === "disable") {
      disable.mutate(c, {
        onSuccess: () => {
          toast.success(t("web.security.2fa.disabled"));
          setMode(null);
          setCode("");
        },
        onError: (err) => toast.error(describeError(err, t)),
      });
    } else {
      regenerate.mutate(c, {
        onSuccess: (r) => {
          toast.success(t("web.security.recovery.regenerated"));
          setCodes(r.recoveryCodes);
          setMode(null);
          setCode("");
        },
        onError: (err) => toast.error(describeError(err, t)),
      });
    }
  };
  const busy = disable.isPending || regenerate.isPending;

  return (
    <Page width="narrow">
      <SettingsNav />
      <PageHeading icon={ShieldCheckIcon} title={t("web.security.title")} description={t("web.security.description")} />
      {status.error && !status.data ? (
        <QueryError error={status.error} onRetry={() => void status.refetch()} />
      ) : !status.data ? (
        <Skeleton className="h-56 rounded-2xl" />
      ) : (
        <div className="grid gap-4">
          <Card className="gap-1" data-testid="security-2fa">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <ShieldIcon className="size-4 text-muted-foreground" /> {t("web.security.2fa.title")}
                {status.data.available && <Badge variant={status.data.enabled ? "default" : "secondary"}>{status.data.enabled ? t("web.security.2fa.on") : t("web.security.2fa.off")}</Badge>}
              </CardTitle>
              <CardDescription>{t("web.security.2fa.hint")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {!status.data.available ? (
                <p className="text-sm text-muted-foreground">{t("web.security.2fa.unavailable")}</p>
              ) : codes ? (
                <RecoveryCodes codes={codes} shop={shopName} onDone={() => setCodes(null)} />
              ) : enrolling ? (
                <MfaEnrol
                  onCancel={() => setEnrolling(false)}
                  onEnabled={(c) => {
                    setEnrolling(false);
                    setCodes(c);
                    void qc.invalidateQueries({ queryKey: mfaStatusKey });
                    toast.success(t("web.security.2fa.enabled"));
                  }}
                />
              ) : status.data.enabled ? (
                <>
                  {status.data.enabledAt && (
                    <p className="text-sm text-muted-foreground">{t("web.security.2fa.since", { date: new Date(status.data.enabledAt).toLocaleDateString(locale) })}</p>
                  )}
                  <div className="space-y-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <KeyRoundIcon className="size-4 text-muted-foreground" /> {t("web.security.recovery.title")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t("web.security.recovery.left", { count: status.data.recoveryCodesLeft })}. {t("web.security.recovery.hint")}
                    </p>
                  </div>
                  {mode ? (
                    <form
                      className="grid gap-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        run();
                      }}
                    >
                      <p className="text-sm text-muted-foreground">{t("web.security.2fa.disableHint")}</p>
                      <Input
                        autoFocus
                        autoComplete="off"
                        inputMode="text"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="123456"
                        className="max-w-48 font-mono tracking-wider"
                        aria-label={t("web.mfa.challenge.title")}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" variant={mode === "disable" ? "destructive" : "default"} disabled={busy || !code.trim()}>
                          {busy && <Loader2Icon className="animate-spin" />}
                          {mode === "disable" ? t("web.security.2fa.disable") : t("web.security.recovery.regenerate")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setMode(null);
                            setCode("");
                          }}
                        >
                          {t("web.mfa.enrol.cancel")}
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" onClick={() => setMode("regenerate")}>
                        {t("web.security.recovery.regenerate")}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setMode("disable")}>
                        {t("web.security.2fa.disable")}
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <Button type="button" onClick={() => setEnrolling(true)}>
                    <ShieldCheckIcon /> {t("web.security.2fa.enable")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          {status.data.available && canManage && <PolicyCard ownEnabled={status.data.enabled} />}
        </div>
      )}
    </Page>
  );
}

/** Owner / admin: require two-factor for the shop's owners, admins and managers. */
function PolicyCard({ ownEnabled }: { ownEnabled: boolean }) {
  const { t } = useI18n();
  const settings = useSignInSettings(true);
  const save = useSaveSignInSettings();
  const staff = settings.data?.options.staff;
  const on = staff?.requireMfa === true;
  return (
    <Card className="gap-1" data-testid="security-policy">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LockIcon className="size-4 text-muted-foreground" /> {t("web.security.policy.title")}
        </CardTitle>
        <CardDescription>{t("web.security.policy.hint")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {settings.error && !settings.data ? (
          <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
        ) : !staff ? (
          <Skeleton className="h-10 rounded-xl" />
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="require-mfa" className="font-medium">
                {t("web.security.policy.title")}
              </label>
              <Switch
                id="require-mfa"
                checked={on}
                disabled={save.isPending || (!on && !ownEnabled)}
                onCheckedChange={(next) =>
                  save.mutate(
                    { staff: { ...staff, requireMfa: next } },
                    {
                      onSuccess: () => toast.success(t("web.security.policy.saved")),
                      onError: (err) => toast.error(describeError(err, t)),
                    },
                  )
                }
              />
            </div>
            {!on && !ownEnabled && <p className="text-xs text-muted-foreground">{t("web.security.policy.needsOwn")}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
