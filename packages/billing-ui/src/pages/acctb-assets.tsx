"use client";

import * as React from "react";
import { ArmchairIcon, PlusIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  ChipGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@rbms/ui";
import { ConfirmDialog, describeError, QueryError, useI18n } from "@rbms/web";
import { AccountSelect, AccountingPage, Panel, TableSkeleton } from "../components/accounting/parts";
import { Figure } from "../components/accounting/part-b";
import { MoneyInput } from "../components/money-input";
import { ACC_POST, useAccounts } from "../lib/accounting";
import { pct, useAssets, useCancelRun, useDepreciationPreview, useDepreciationRuns, useDisposeAsset, useRunDepreciation, useSaveAsset, type FixedAsset } from "../lib/accounting-b";
import { useHasPermission } from "../lib/access";
import { money, rupeesToPaise, todayIST } from "../lib/format";

/** Fixed assets (equipment, furniture, vehicles): cost, depreciation charged, value now; post depreciation; sell or scrap. */
export default function AccountingAssetsPage() {
  const { t, formatDate } = useI18n();
  const canPost = useHasPermission(ACC_POST);
  const assets = useAssets();
  const runs = useDepreciationRuns();
  const [upTo, setUpTo] = React.useState(todayIST());
  const preview = useDepreciationPreview(upTo);
  const run = useRunDepreciation();
  const cancel = useCancelRun();
  const [adding, setAdding] = React.useState(false);
  const [dispose, setDispose] = React.useState<FixedAsset | null>(null);
  const [confirmRun, setConfirmRun] = React.useState(false);
  const d = (s: string | null) => (s ? formatDate(s, { day: "numeric", month: "short", year: "numeric" }) : "-");
  const items = assets.data?.items ?? [];
  const active = items.filter((a) => a.status === "active");

  const post = async () => {
    try {
      const r = await run.mutateAsync({ upTo });
      toast.success(t("billing.acctb.assets.posted", { amount: money(r.total) }));
      setConfirmRun(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <AccountingPage
      title={t("billing.acctb.nav.assets")}
      description={t("billing.acctb.assets.subtitle")}
      icon={ArmchairIcon}
      actions={
        canPost ? (
          <Button size="lg" onClick={() => setAdding(true)}>
            <PlusIcon /> {t("billing.acctb.assets.add")}
          </Button>
        ) : undefined
      }
    >
      {assets.isError && !assets.data ? (
        <QueryError error={assets.error} onRetry={() => void assets.refetch()} />
      ) : assets.isPending ? (
        <TableSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-section">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Figure label={t("billing.acctb.assets.cost")}>{money(active.reduce((s, a) => s + a.cost, 0))}</Figure>
            <Figure label={t("billing.acctb.assets.accumulated")}>{money(active.reduce((s, a) => s + a.accumulated, 0))}</Figure>
            <Figure label={t("billing.acctb.assets.value")}>{money(active.reduce((s, a) => s + a.bookValue, 0))}</Figure>
          </div>

          {items.length === 0 ? (
            <EmptyState icon={ArmchairIcon} title={t("billing.acctb.assets.noneTitle")} description={t("billing.acctb.assets.noneBody")} />
          ) : (
            <Panel>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("billing.acctb.assets.asset")}</TableHead>
                      <TableHead>{t("billing.acctb.assets.method")}</TableHead>
                      <TableHead className="text-right">{t("billing.acctb.assets.cost")}</TableHead>
                      <TableHead className="text-right">{t("billing.acctb.assets.accumulated")}</TableHead>
                      <TableHead className="text-right">{t("billing.acctb.assets.value")}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((a) => (
                      <TableRow key={a.id} className={a.status === "active" ? undefined : "opacity-60"}>
                        <TableCell className="min-w-48 max-w-72 whitespace-normal">
                          <span className="block font-medium">{a.name}</span>
                          <span className="block text-meta text-muted-foreground">
                            {a.accountName} · {t("billing.acctb.assets.since", { date: d(a.inUseFrom) })}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {a.method === "slm" ? t("billing.acctb.assets.slm") : t("billing.acctb.assets.wdv")}
                          <span className="block text-meta text-muted-foreground">{a.rate ? t("billing.acctb.assets.perYear", { rate: pct(a.rate) }) : t("billing.acctb.assets.lifeMonths", { months: a.lifeMonths ?? 0 })}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{money(a.cost)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(a.accumulated)}
                          <span className="block text-meta text-muted-foreground">{a.depreciatedTo ? t("billing.acctb.assets.to", { date: d(a.depreciatedTo) }) : t("billing.acctb.assets.notYet")}</span>
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{money(a.bookValue)}</TableCell>
                        <TableCell className="text-right">
                          {a.status === "disposed" ? (
                            <StatusPill tone="neutral">{t("billing.acctb.assets.disposedOn", { date: d(a.disposedOn) })}</StatusPill>
                          ) : (
                            canPost && (
                              <Button size="sm" variant="outline" onClick={() => setDispose(a)}>
                                {t("billing.acctb.assets.dispose")}
                              </Button>
                            )
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Panel>
          )}

          <Card>
            <CardContent className="grid gap-4">
              <div>
                <p className="font-medium">{t("billing.acctb.assets.runTitle")}</p>
                <p className="text-meta text-muted-foreground">{t("billing.acctb.assets.runBody")}</p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="dep-to">{t("billing.acctb.assets.upTo")}</Label>
                  <Input id="dep-to" type="date" className="w-44" value={upTo} max={todayIST()} onChange={(e) => e.target.value && setUpTo(e.target.value)} />
                </div>
                <p className="pb-2 text-sm">
                  {preview.data ? t("billing.acctb.assets.willPost", { amount: money(preview.data.total), count: preview.data.items.length }) : ""}
                </p>
                {canPost && (
                  <Button className="ml-auto" onClick={() => setConfirmRun(true)} disabled={!preview.data?.total || run.isPending}>
                    {t("billing.acctb.assets.post")}
                  </Button>
                )}
              </div>
              {!!preview.data?.items.length && (
                <ul className="grid gap-1 text-sm">
                  {preview.data.items.map((i) => (
                    <li key={i.assetId} className="flex flex-wrap justify-between gap-2">
                      <span className="min-w-0 flex-1 basis-48 break-words">
                        {i.name} · {d(i.from)} - {d(i.to)}
                      </span>
                      <span className="tabular-nums">{money(i.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!!runs.data?.length && (
                <details className="rounded-xl border p-3">
                  <summary className="cursor-pointer text-sm font-medium">{t("billing.acctb.assets.runs", { count: runs.data.length })}</summary>
                  <ul className="mt-2 grid gap-2 text-sm">
                    {runs.data.map((r, i) => (
                      <li key={r.entryId} className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          {r.number} · {t("billing.acctb.assets.to", { date: d(r.upTo) })} · {money(r.total)}
                        </span>
                        {r.status === "cancelled" ? (
                          <StatusPill tone="neutral">{t("billing.acctb.cancelled")}</StatusPill>
                        ) : (
                          canPost &&
                          i === 0 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                void cancel
                                  .mutateAsync(r.entryId)
                                  .then(() => toast.success(t("billing.acctb.assets.runCancelled")))
                                  .catch((err) => toast.error(describeError(err, t)))
                              }
                            >
                              {t("billing.common.cancel")}
                            </Button>
                          )
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      <ConfirmDialog
        open={confirmRun}
        onOpenChange={setConfirmRun}
        destructive={false}
        title={t("billing.acctb.assets.post")}
        description={t("billing.acctb.assets.confirmRun", { amount: money(preview.data?.total ?? 0), date: d(upTo) })}
        confirmLabel={t("billing.acctb.assets.post")}
        onConfirm={post}
      />
      <AddAssetDialog open={adding} onClose={() => setAdding(false)} />
      <DisposeDialog asset={dispose} onClose={() => setDispose(null)} />
    </AccountingPage>
  );
}

function AddAssetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const accounts = useAccounts(false);
  const save = useSaveAsset();
  const [name, setName] = React.useState("");
  const [accountId, setAccountId] = React.useState("");
  const [bought, setBought] = React.useState(todayIST());
  const [cost, setCost] = React.useState("");
  const [salvage, setSalvage] = React.useState("");
  const [method, setMethod] = React.useState<"slm" | "wdv">("slm");
  const [rate, setRate] = React.useState("");
  const [years, setYears] = React.useState("5");
  const [record, setRecord] = React.useState<"existing" | "purchase">("existing");
  const [paidFrom, setPaidFrom] = React.useState("");
  const [opening, setOpening] = React.useState("");
  React.useEffect(() => {
    if (!open) return;
    setName("");
    setCost("");
    setSalvage("");
    setRate("");
    setYears("5");
    setOpening("");
    setBought(todayIST());
  }, [open]);
  const fixed = (accounts.data ?? []).filter((a) => a.group === "fixed_assets" && a.key !== "accumulated_depreciation");
  React.useEffect(() => {
    if (!accountId && fixed[0]) setAccountId(fixed[0].id);
  }, [accountId, fixed]);
  const submit = async () => {
    try {
      await save.mutateAsync({
        name: name.trim(),
        assetAccountId: accountId,
        purchaseDate: bought,
        cost: rupeesToPaise(cost) ?? 0,
        salvage: rupeesToPaise(salvage) ?? 0,
        method,
        rate: method === "wdv" ? Math.round(Number(rate) * 100) : rate ? Math.round(Number(rate) * 100) : null,
        lifeMonths: method === "slm" && !rate ? Math.round(Number(years) * 12) : null,
        record,
        paidFromAccountId: record === "purchase" ? paidFrom : null,
        openingDepreciation: record === "existing" ? (rupeesToPaise(opening) ?? 0) : 0,
      });
      toast.success(t("billing.acctb.assets.added"));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const ok = name.trim() && accountId && (rupeesToPaise(cost) ?? 0) > 0 && (method === "slm" ? !!rate || Number(years) > 0 : Number(rate) > 0) && (record === "existing" || !!paidFrom);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" closeLabel={t("billing.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("billing.acctb.assets.add")}</DialogTitle>
          <DialogDescription>{t("billing.acctb.assets.addBody")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="as-name">{t("billing.acctb.assets.asset")}</Label>
            <Input id="as-name" maxLength={120} value={name} placeholder={t("billing.acctb.assets.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("billing.acctb.assets.account")}</Label>
            <AccountSelect value={accountId} onChange={setAccountId} accounts={fixed} aria-label={t("billing.acctb.assets.account")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="as-date">{t("billing.acctb.assets.bought")}</Label>
            <Input id="as-date" type="date" value={bought} onChange={(e) => setBought(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="as-cost">{t("billing.acctb.assets.cost")}</Label>
            <MoneyInput id="as-cost" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="as-salv">{t("billing.acctb.assets.salvage")}</Label>
            <MoneyInput id="as-salv" value={salvage} onChange={(e) => setSalvage(e.target.value)} placeholder="0" />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>{t("billing.acctb.assets.method")}</Label>
            <ChipGroup
              size="sm"
              aria-label={t("billing.acctb.assets.method")}
              value={method}
              onChange={setMethod}
              options={[
                { value: "slm" as const, label: t("billing.acctb.assets.slm") },
                { value: "wdv" as const, label: t("billing.acctb.assets.wdv") },
              ]}
            />
            <p className="text-meta text-muted-foreground">{method === "slm" ? t("billing.acctb.assets.slmHint") : t("billing.acctb.assets.wdvHint")}</p>
          </div>
          {method === "slm" && (
            <div className="grid gap-1.5">
              <Label htmlFor="as-years">{t("billing.acctb.assets.years")}</Label>
              <Input id="as-years" inputMode="decimal" value={years} disabled={!!rate} onChange={(e) => setYears(e.target.value.replace(/[^\d.]/g, ""))} />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="as-rate">{method === "slm" ? t("billing.acctb.assets.rateOptional") : t("billing.acctb.assets.rate")}</Label>
            <Input id="as-rate" inputMode="decimal" value={rate} placeholder="%" onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>{t("billing.acctb.assets.record")}</Label>
            <ChipGroup
              size="sm"
              aria-label={t("billing.acctb.assets.record")}
              value={record}
              onChange={setRecord}
              options={[
                { value: "existing" as const, label: t("billing.acctb.assets.existing") },
                { value: "purchase" as const, label: t("billing.acctb.assets.purchase") },
              ]}
            />
            <p className="text-meta text-muted-foreground">{record === "existing" ? t("billing.acctb.assets.existingHint") : t("billing.acctb.assets.purchaseHint")}</p>
          </div>
          {record === "purchase" ? (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>{t("billing.acctb.assets.paidFrom")}</Label>
              <AccountSelect value={paidFrom} onChange={setPaidFrom} accounts={accounts.data ?? []} filter={(a) => a.isBank || a.isCash || a.group === "loans"} aria-label={t("billing.acctb.assets.paidFrom")} />
            </div>
          ) : (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="as-open">{t("billing.acctb.assets.openingDep")}</Label>
              <MoneyInput id="as-open" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("billing.common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!ok || save.isPending}>
            {t("billing.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DisposeDialog({ asset, onClose }: { asset: FixedAsset | null; onClose: () => void }) {
  const { t } = useI18n();
  const accounts = useAccounts(false);
  const dispose = useDisposeAsset();
  const [date, setDate] = React.useState(todayIST());
  const [amount, setAmount] = React.useState("");
  const [into, setInto] = React.useState("");
  React.useEffect(() => {
    if (asset) {
      setDate(todayIST());
      setAmount("");
    }
  }, [asset]);
  React.useEffect(() => {
    if (!into && accounts.data) setInto(accounts.data.find((a) => a.key === "bank")?.id ?? "");
  }, [into, accounts.data]);
  const paise = rupeesToPaise(amount) ?? 0;
  const submit = async () => {
    if (!asset) return;
    try {
      await dispose.mutateAsync({ id: asset.id, date, saleAmount: paise, receivedInAccountId: paise > 0 ? into : null });
      toast.success(t("billing.acctb.assets.disposed"));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={!!asset} onOpenChange={(o) => !o && !dispose.isPending && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={t("billing.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("billing.acctb.assets.disposeTitle", { name: asset?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("billing.acctb.assets.disposeBody", { value: money(asset?.bookValue ?? 0) })}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="ds-date">{t("billing.accounting.date")}</Label>
            <Input id="ds-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ds-amt">{t("billing.acctb.assets.saleAmount")}</Label>
            <MoneyInput id="ds-amt" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </div>
          {paise > 0 && (
            <div className="grid gap-1.5">
              <Label>{t("billing.acctb.assets.receivedIn")}</Label>
              <AccountSelect value={into} onChange={setInto} accounts={accounts.data ?? []} filter={(a) => a.isBank || a.isCash} aria-label={t("billing.acctb.assets.receivedIn")} />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("billing.common.cancel")}
          </Button>
          <Button onClick={submit} disabled={dispose.isPending || (paise > 0 && !into)}>
            {t("billing.acctb.assets.dispose")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
