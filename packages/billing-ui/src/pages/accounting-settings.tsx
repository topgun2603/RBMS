"use client";

import * as React from "react";
import { LockIcon, LockOpenIcon, PlayIcon, RefreshCwIcon, SearchCheckIcon, SettingsIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, ChipGroup, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Switch, toast } from "@srirealtime/ui";
import { describeError, QueryError, useI18n } from "@srirealtime/web";
import { AccountingPage } from "../components/accounting/parts";
import { ACC_LOCK, ACC_POST, useAccounts, useAccountingSettings, useBackfill, useSetLock, useSyncNow, useUpdateAccountingSettings, type SyncResult } from "../lib/accounting";
import { useHasPermission } from "../lib/access";
import { todayIST } from "../lib/format";

const METHODS = ["upi", "card", "bank", "cheque", "other"] as const;

/** Period lock, how imported history is treated, valuing stock, which account each payment method lands in, and the posting run. */
export default function AccountingSettingsPage() {
  const { t, formatDate } = useI18n();
  const canLock = useHasPermission(ACC_LOCK);
  const canPost = useHasPermission(ACC_POST);
  const settings = useAccountingSettings();
  const accounts = useAccounts(false);
  const setLock = useSetLock();
  const update = useUpdateAccountingSettings();
  const backfill = useBackfill();
  const sync = useSyncNow();

  const [lockDate, setLockDate] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [result, setResult] = React.useState<SyncResult | null>(null);

  React.useEffect(() => {
    if (settings.data) setLockDate(settings.data.lockedThrough ?? "");
  }, [settings.data]);

  const s = settings.data;
  const fail = (err: unknown) => toast.error(describeError(err, t));

  const lock = async (value: string | null) => {
    try {
      await setLock.mutateAsync({ lockedThrough: value, reason: reason.trim() || null });
      toast.success(t(value ? "billing.accounting.lock.locked" : "billing.accounting.lock.unlocked"));
      setReason("");
    } catch (err) {
      fail(err);
    }
  };
  const patch = async (body: Parameters<typeof update.mutateAsync>[0]) => {
    try {
      await update.mutateAsync(body);
      toast.success(t("billing.accounting.settings.saved"));
    } catch (err) {
      fail(err);
    }
  };
  const run = async (dryRun: boolean) => {
    try {
      const r = await backfill.mutateAsync({ from: from || null, dryRun });
      setResult(r);
      if (!dryRun) toast.success(t("billing.accounting.setup.done", { count: r.posted }));
    } catch (err) {
      fail(err);
    }
  };

  const moneyAccounts = (accounts.data ?? []).filter((a) => a.isCash || a.isBank);

  return (
    <AccountingPage title={t("billing.accounting.settings.title")} description={t("billing.accounting.settings.subtitle")} icon={SettingsIcon} needsSetup={false}>
      {settings.isError && !s ? (
        <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
      ) : !s ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <div className="mx-auto grid max-w-3xl gap-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LockIcon className="size-4" /> {t("billing.accounting.lock.title")}
              </CardTitle>
              <p className="text-meta text-muted-foreground">{t("billing.accounting.lock.body")}</p>
            </CardHeader>
            <CardContent className="grid gap-4">
              <p className="text-sm">
                {s.lockedThrough ? <b>{t("billing.accounting.lockedThrough", { date: formatDate(s.lockedThrough, { day: "numeric", month: "short", year: "numeric" }) })}</b> : t("billing.accounting.lock.open")}
              </p>
              {canLock ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
                    <div className="grid gap-1.5">
                      <Label htmlFor="lock-date">{t("billing.accounting.lock.upTo")}</Label>
                      <Input id="lock-date" type="date" max={todayIST()} value={lockDate} onChange={(e) => setLockDate(e.target.value)} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="lock-reason">{t("billing.accounting.lock.reason")}</Label>
                      <Input id="lock-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("billing.accounting.lock.reasonPlaceholder")} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => lock(lockDate)} disabled={!lockDate || lockDate === s.lockedThrough || setLock.isPending}>
                      <LockIcon /> {t("billing.accounting.lock.lockButton")}
                    </Button>
                    {s.lockedThrough && (
                      <Button type="button" variant="outline" onClick={() => lock(null)} disabled={setLock.isPending}>
                        <LockOpenIcon /> {t("billing.accounting.lock.unlockButton")}
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-meta text-muted-foreground">{t("billing.accounting.lock.noPermission")}</p>
              )}
              {s.lockHistory.length > 0 && (
                <div>
                  <p className="mb-1 text-meta font-medium text-muted-foreground">{t("billing.accounting.lock.history")}</p>
                  <ul className="grid gap-1 text-meta">
                    {s.lockHistory.map((h) => (
                      <li key={h.id} className="text-muted-foreground">
                        {formatDate(h.at, { day: "numeric", month: "short", year: "numeric" })} ·{" "}
                        {h.lockedThrough ? t("billing.accounting.lock.historyLocked", { date: h.lockedThrough }) : t("billing.accounting.lock.historyOpened")}
                        {h.reason ? ` · ${h.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("billing.accounting.settings.books")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="grid gap-2">
                <p className="font-medium">{t("billing.accounting.settings.imported")}</p>
                <p className="text-meta text-muted-foreground">{t("billing.accounting.settings.importedHint")}</p>
                <ChipGroup
                  size="sm"
                  aria-label={t("billing.accounting.settings.imported")}
                  value={s.importedBills}
                  onChange={(v) => canPost && patch({ importedBills: v })}
                  options={[
                    { value: "exclude", label: t("billing.accounting.settings.importedExclude") },
                    { value: "post", label: t("billing.accounting.settings.importedPost") },
                  ]}
                />
              </div>
              <div className="flex items-start justify-between gap-3 rounded-xl border p-3">
                <div>
                  <p className="font-medium">{t("billing.accounting.settings.valueStock")}</p>
                  <p className="text-meta text-muted-foreground">{t("billing.accounting.settings.valueStockHint")}</p>
                </div>
                <Switch checked={s.valueStock} disabled={!canPost} onCheckedChange={(v) => patch({ valueStock: v })} aria-label={t("billing.accounting.settings.valueStock")} />
              </div>
              <div className="grid gap-2">
                <p className="font-medium">{t("billing.accounting.settings.methods")}</p>
                <p className="text-meta text-muted-foreground">{t("billing.accounting.settings.methodsHint")}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {METHODS.map((m) => (
                    <div key={m} className="grid gap-1.5">
                      <Label htmlFor={`m-${m}`}>{t(`billing.payment.methods.${m}`)}</Label>
                      <Select value={s.methodAccounts[m] ?? "default"} disabled={!canPost} onValueChange={(v) => patch({ methodAccounts: { [m]: v === "default" ? null : v } })}>
                        <SelectTrigger id={`m-${m}`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">{t("billing.accounting.settings.defaultBank")}</SelectItem>
                          {moneyAccounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("billing.accounting.settings.posting")}</CardTitle>
              <p className="text-meta text-muted-foreground">{t(s.autoPost ? "billing.accounting.settings.postingOn" : "billing.accounting.settings.postingOff")}</p>
            </CardHeader>
            <CardContent className="grid gap-4">
              {s.lastSyncAt && (
                <p className="text-meta text-muted-foreground">
                  {t("billing.accounting.lastPosted", { when: formatDate(s.lastSyncAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}
                  {s.lastSyncSummary ? ` · ${t("billing.accounting.settings.lastRun", { posted: s.lastSyncSummary.posted ?? 0, reversed: s.lastSyncSummary.reversed ?? 0 })}` : ""}
                </p>
              )}
              {canPost ? (
                <>
                  <div className="grid gap-1.5 sm:max-w-xs">
                    <Label htmlFor="bf-from">{t("billing.accounting.settings.from")}</Label>
                    <Input id="bf-from" type="date" max={todayIST()} value={from} onChange={(e) => setFrom(e.target.value)} />
                    <p className="text-meta text-muted-foreground">{t("billing.accounting.settings.fromHint")}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={() => run(true)} disabled={backfill.isPending}>
                      <SearchCheckIcon /> {t("billing.accounting.setup.previewButton")}
                    </Button>
                    <Button type="button" onClick={() => run(false)} disabled={backfill.isPending}>
                      <PlayIcon /> {t(s.autoPost ? "billing.accounting.settings.postAgain" : "billing.accounting.setup.postButton")}
                    </Button>
                    {s.autoPost && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={sync.isPending}
                        onClick={async () => {
                          try {
                            const r = await sync.mutateAsync();
                            setResult(r);
                            toast.success(t("billing.accounting.syncDone", { posted: r.posted, reversed: r.reversed }));
                          } catch (err) {
                            fail(err);
                          }
                        }}
                      >
                        <RefreshCwIcon /> {t("billing.accounting.syncNow")}
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-meta text-muted-foreground">{t("billing.accounting.setup.askAccountant")}</p>
              )}
              {result && (
                <div className="rounded-xl border bg-muted/30 p-3 text-sm">
                  <p className="font-medium">{t(result.dryRun ? "billing.accounting.settings.previewResult" : "billing.accounting.settings.runResult", { posted: result.posted, reversed: result.reversed, unchanged: result.unchanged })}</p>
                  <ul className="mt-1 grid gap-0.5 text-meta text-muted-foreground">
                    {Object.entries(result.byType)
                      .filter(([, v]) => v.posted || v.reversed)
                      .map(([k, v]) => (
                        <li key={k}>
                          {t(`billing.accounting.source.${k}`)}: {v.posted} {t("billing.accounting.settings.new")}
                          {v.reversed ? `, ${v.reversed} ${t("billing.accounting.settings.undone")}` : ""}
                        </li>
                      ))}
                  </ul>
                  {result.late > 0 && <p className="mt-1 text-meta text-warning-ink">{t("billing.accounting.settings.lateNote", { count: result.late })}</p>}
                  {result.errors.length > 0 && <p className="mt-1 text-meta text-danger-ink">{t("billing.accounting.settings.errorsNote", { count: result.errors.length })}</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </AccountingPage>
  );
}
