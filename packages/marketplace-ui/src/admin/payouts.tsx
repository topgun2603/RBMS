"use client";

import * as React from "react";
import { AlertTriangleIcon, CalendarIcon, DownloadIcon, InfoIcon, PlayIcon, WalletIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  AnimatedNumber,
  AnimatePresence,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChipGroup,
  cn,
  DataTable,
  DataTableToolbar,
  EmptyState,
  Field,
  FieldControl,
  FieldHint,
  FieldLabel,
  Input,
  motion,
  Skeleton,
  SuccessCheck,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@rbms/ui";
import { ConfirmDialog, describeError, ModuleLink, Page, PageHeading, QueryError, useI18n, useServerTable, type ServerFilterDefs } from "@rbms/web";
import { RowsSkeleton } from "../components/lists";
import { usePayoutColumns } from "../components/table-columns";
import { money, previewPayouts, type PreviewRow } from "../lib/logic";
import { exportCsv, mk, MP, PREVIEW_VENDOR_CAP, todayIST, useMarketplaceSettings, usePayoutPreviewData, useRunPayouts, useSellerOptions } from "../lib/queries";
import { PAYOUT_STATUSES, type Payout, type PayoutRunResult } from "../lib/types";
import { PayoutActions } from "./payout-actions";

export default function PayoutsPage() {
  const { t } = useI18n();
  return (
    <Page width="full">
      <PageHeading icon={WalletIcon} title={t("marketplace.payouts.title")} description={t("marketplace.payouts.subtitle")} />
      <div className="grid gap-6">
        <RunPanel />
        {/* useServerTable reads the search params, which needs a Suspense boundary. */}
        <React.Suspense fallback={null}>
          <History />
        </React.Suspense>
      </div>
    </Page>
  );
}

function RunPanel() {
  const { t, formatDate } = useI18n();
  const [until, setUntil] = React.useState(todayIST());
  const settings = useMarketplaceSettings();
  const data = usePayoutPreviewData(until);
  const run = useRunPayouts();
  const [confirming, setConfirming] = React.useState(false);
  const [result, setResult] = React.useState<PayoutRunResult | null>(null);

  const preview = React.useMemo(
    () => (data.data && settings.data ? previewPayouts(data.data.vendors.map((v) => ({ ...v, balance: v.balance.balance })), data.data.orders, settings.data, data.data.until) : null),
    [data.data, settings.data],
  );
  const s = settings.data;

  const doRun = async () => {
    try {
      const r = await run.mutateAsync({ until });
      setResult(r);
      toast.success(t("marketplace.payouts.runDone", { count: r.created.length }));
    } catch (err) {
      toast.error(describeError(err, t));
      throw err;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="icon-chip size-8 text-primary">
            <PlayIcon className="size-4" />
          </span>
          {t("marketplace.payouts.runTitle")}
        </CardTitle>
        <CardDescription>
          {s ? t("marketplace.payouts.runBody", { min: money(s.minPayoutPaise), provider: t(`marketplace.settings.provider.${s.payoutProvider}`) }) : <Skeleton className="h-4 w-64" />}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid items-start gap-4 sm:grid-cols-[14rem_minmax(0,1fr)]">
          <Field>
            <FieldLabel>{t("marketplace.payouts.until")}</FieldLabel>
            <FieldControl>
              <Input type="date" value={until} max={todayIST()} onChange={(e) => e.target.value && setUntil(e.target.value)} />
            </FieldControl>
            <FieldHint>{t("marketplace.payouts.untilHint")}</FieldHint>
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Figure label={t("marketplace.payouts.previewTotal")} loading={!preview}>
              {preview && <AnimatedNumber value={preview.total} format={money} />}
            </Figure>
            <Figure label={t("marketplace.payouts.previewSellers")} loading={!preview}>
              {preview?.pay.length}
            </Figure>
            <Figure label={t("marketplace.payouts.previewSkipped")} loading={!preview} className="hidden sm:flex">
              {preview?.skip.length}
            </Figure>
          </div>
        </div>

        {data.isError || settings.isError ? (
          <QueryError compact error={data.error ?? settings.error} onRetry={() => void (data.refetch(), settings.refetch())} />
        ) : !preview ? (
          <RowsSkeleton rows={3} />
        ) : (
          <>
            {data.data?.capped && (
              <Alert variant="warning">
                <AlertTriangleIcon />
                <AlertTitle>{t("marketplace.payouts.cappedTitle")}</AlertTitle>
                <AlertDescription>{t("marketplace.payouts.cappedBody", { count: PREVIEW_VENDOR_CAP })}</AlertDescription>
              </Alert>
            )}
            <PreviewTable rows={[...preview.pay, ...preview.skip]} />
            <p className="flex items-start gap-2 text-meta text-muted-foreground">
              <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
              {t("marketplace.payouts.previewNote", { date: formatDate(data.data!.until, { day: "numeric", month: "short", year: "numeric" }) })}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="lg" disabled={preview.pay.length === 0 || run.isPending} onClick={() => setConfirming(true)}>
                <PlayIcon /> {t("marketplace.payouts.runNow", { count: preview.pay.length })}
              </Button>
            </div>
          </>
        )}

        <AnimatePresence>
          {result && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-start gap-3 rounded-2xl border border-success/40 bg-success/10 p-4">
              <SuccessCheck size={36} className="shrink-0" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">
                  {t("marketplace.payouts.resultTitle", { count: result.created.length, amount: money(result.created.reduce((n, p) => n + p.amount, 0)) })}
                </p>
                <p className="text-muted-foreground">{t("marketplace.payouts.resultBody", { released: result.released, skipped: result.skipped.length })}</p>
                {result.created.some((p) => p.status === "failed") && <p className="text-danger-ink">{t("marketplace.payouts.resultFailed")}</p>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setResult(null)}>
                {t("marketplace.common.close")}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        destructive={false}
        title={t("marketplace.payouts.confirmTitle", { amount: money(preview?.total ?? 0), count: preview?.pay.length ?? 0 })}
        description={t(s?.payoutProvider === "manual" ? "marketplace.payouts.confirmManual" : "marketplace.payouts.confirmAuto")}
        confirmLabel={t("marketplace.payouts.run")}
        onConfirm={doRun}
      />
    </Card>
  );
}

function Figure({ label, loading, className, children }: { label: string; loading: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-xl border bg-muted/30 p-3", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {loading ? <Skeleton className="h-6 w-20" /> : <span className="font-heading text-xl font-semibold tabular-nums">{children}</span>}
    </div>
  );
}

function PreviewTable({ rows }: { rows: PreviewRow[] }) {
  const { t } = useI18n();
  if (rows.length === 0) return <p className="rounded-xl bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">{t("marketplace.payouts.previewEmpty")}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="pl-4">{t("marketplace.payouts.col.seller")}</TableHead>
            <TableHead className="text-right">{t("marketplace.payouts.col.balance")}</TableHead>
            <TableHead className="text-right">{t("marketplace.payouts.col.releasing")}</TableHead>
            <TableHead className="text-right">{t("marketplace.payouts.col.amount")}</TableHead>
            <TableHead className="pr-4">{t("marketplace.payouts.col.outcome")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.vendorId} className={cn(r.reason && "text-muted-foreground")}>
              <TableCell className="pl-4 font-medium">
                <ModuleLink to={`vendors/${r.vendorId}`} className="hover:text-primary">
                  {r.vendorName}
                </ModuleLink>
              </TableCell>
              <TableCell className="text-right tabular-nums">{money(r.balance)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {r.releasing ? `+${money(r.releasing)}` : "—"}
                {r.orders > 0 && <span className="block text-xs text-muted-foreground">{t("marketplace.payouts.ordersCount", { count: r.orders })}</span>}
              </TableCell>
              <TableCell className={cn("text-right font-semibold tabular-nums", !r.reason && "text-success-ink")}>{money(r.amount)}</TableCell>
              <TableCell className="pr-4 text-sm">{r.reason ? t(`marketplace.payouts.skip.${r.reason}`) : t("marketplace.payouts.willPay")}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const payoutActions = (p: Payout) => <PayoutActions payout={p} />;

function History() {
  const { t } = useI18n();
  const sellers = useSellerOptions();
  const sellerOptions = sellers.data;
  const filters = React.useMemo(
    () =>
      ({
        status: {
          kind: "options",
          label: t("marketplace.payouts.filterStatus"),
          options: PAYOUT_STATUSES.map((s) => ({ value: s, label: t(`marketplace.payout.status.${s}`) })),
        },
        vendorId: { kind: "options", label: t("marketplace.payouts.filterSeller"), options: sellerOptions ?? [], dynamic: true },
        date: { kind: "dateRange", label: t("marketplace.payouts.filterDate") },
      }) satisfies ServerFilterDefs,
    [t, sellerOptions],
  );
  const columns = usePayoutColumns({ showVendor: true, actions: payoutActions });
  const st = useServerTable<Payout, typeof filters>({
    queryKey: [...mk.all, "payouts", "table"],
    path: `${MP}/payouts`,
    columns,
    filters,
    defaultSort: "-date",
    search: t("marketplace.payouts.search"),
    storageKey: "marketplace-payouts",
  });
  const status = st.filters.status;
  const counts = st.facets?.status;
  const all = counts ? Object.values(counts).reduce((n, c) => n + c, 0) : undefined;
  const pill = status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : "";
  const filtered = st.table.activeFilterCount > 0;
  const { limit: _l, offset: _o, ...exportParams } = st.apiParams;

  return (
    <section className="grid gap-3">
      <h2 className="flex items-center gap-2 font-heading text-lg font-semibold">
        <CalendarIcon className="size-4 text-muted-foreground" /> {t("marketplace.payouts.history")}
      </h2>
      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("marketplace.payouts.filter")}
            value={pill}
            onChange={(v) => status.set(v === "all" ? [] : [v])}
            options={[
              { value: "all", label: t("marketplace.vendors.tabAll"), meta: all || undefined },
              ...PAYOUT_STATUSES.map((s) => ({ value: s, label: t(`marketplace.payout.status.${s}`), meta: counts ? counts[s] || undefined : undefined })),
            ]}
          />
        }
      >
        <Button variant="outline" onClick={() => void exportCsv("payouts", exportParams).catch((e) => toast.error(describeError(e, t)))}>
          <DownloadIcon /> <span className="hidden sm:inline">{t("marketplace.common.exportCsv")}</span>
        </Button>
      </DataTableToolbar>
      <DataTable
        table={st.table}
        empty={
          filtered ? undefined : (
            <EmptyState className="border-0 bg-transparent" icon={WalletIcon} title={t("marketplace.payouts.emptyTitle")} description={t("marketplace.payouts.emptyBody")} />
          )
        }
      />
    </section>
  );
}
