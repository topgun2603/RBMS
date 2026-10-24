"use client";

import * as React from "react";
import { ModuleLink, Page, PageHeading, QueryError, useI18n } from "@srirealtime/web";
import { AlarmClockIcon, CalendarClockIcon, HandCoinsIcon, TruckIcon, WalletCardsIcon } from "lucide-react";
import { Button, Card, CardContent, EmptyState, Input, Label, Skeleton, Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@srirealtime/ui";
import { PaySupplierDialog } from "../components/inventory/payables-dialogs";
import { DownloadCsvButton } from "../components/reports/report-ui";
import { useHasPermission } from "../lib/access";
import { money, todayIST } from "../lib/format";
import { usePayablesAgeing, usePayablesSummary } from "../lib/queries-payables";
import type { AgeingSupplierRow } from "../lib/types-payables";

const PAY = "inventory.purchases.pay";

function Tile({ label, value, hint, icon: Icon, tone = "text-primary" }: { label: string; value: number | undefined; hint?: string; icon: React.ComponentType<{ className?: string }>; tone?: string }) {
  return (
    <Card className="min-w-0">
      <CardContent className="flex items-start gap-3">
        <span className={`icon-chip size-9 shrink-0 ${tone}`}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-meta text-muted-foreground">{label}</p>
          {value === undefined ? <Skeleton className="mt-1 h-6 w-24" /> : <p className="font-heading text-xl font-semibold tabular-nums">{money(value)}</p>}
          {hint && <p className="text-meta text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

/** Payables: what is owed to each supplier, aged 0-30 / 31-60 / 61-90 / 90+ days past the due date. */
export default function PayablesPage() {
  const { t, formatDate } = useI18n();
  const canPay = useHasPermission(PAY);
  const [asOf, setAsOf] = React.useState(todayIST());
  const ageing = usePayablesAgeing(asOf);
  const summary = usePayablesSummary();
  const [paying, setPaying] = React.useState<AgeingSupplierRow | null>(null);

  const rows = ageing.data?.rows ?? [];
  const totals = ageing.data?.totals;
  const num = (n: number) => (n === 0 ? <span className="text-muted-foreground">—</span> : <span className="tabular-nums">{money(n)}</span>);

  return (
    <Page>
      <PageHeading
        icon={WalletCardsIcon}
        title={t("billing.payables.title")}
        description={t("billing.payables.subtitle")}
        actions={
          <>
            <Button asChild variant="outline" size="lg">
              <ModuleLink to="suppliers">
                <TruckIcon /> {t("billing.nav.suppliers")}
              </ModuleLink>
            </Button>
            <DownloadCsvButton path="/inventory/reports/payables-ageing" params={{ asOf }} fileName={`payables-ageing-${asOf}.csv`} />
          </>
        }
      />

      <div className="mb-section grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Tile label={t("billing.payables.totalPayable")} value={summary.data?.payable} icon={WalletCardsIcon} hint={summary.data ? t("billing.payables.suppliersOwed", { count: summary.data.suppliers }) : undefined} />
        <Tile label={t("billing.payables.overdue")} value={summary.data?.overdue} icon={AlarmClockIcon} tone="text-danger-ink" hint={t("billing.payables.overdueHint")} />
        <Tile label={t("billing.payables.dueSoon")} value={summary.data?.dueSoon} icon={CalendarClockIcon} tone="text-warning-ink" hint={t("billing.payables.dueSoonHint")} />
        <Tile label={t("billing.payables.advances")} value={summary.data?.advance} icon={HandCoinsIcon} tone="text-success-ink" hint={t("billing.payables.advancesHint")} />
      </div>

      <div className="mb-3 flex items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="pay-asof">{t("billing.payables.asOf")}</Label>
          <Input id="pay-asof" type="date" className="w-44" value={asOf} onChange={(e) => setAsOf(e.target.value || todayIST())} />
        </div>
        <p className="pb-2 text-meta text-muted-foreground">{t("billing.payables.ageingNote")}</p>
      </div>

      {ageing.isError && !ageing.data ? (
        <QueryError error={ageing.error} onRetry={() => void ageing.refetch()} />
      ) : ageing.isPending ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : rows.length === 0 ? (
        <EmptyState className="border-0 bg-transparent" title={t("billing.payables.emptyTitle")} description={t("billing.payables.emptyBody")} />
      ) : (
        <Card>
          <CardContent className="px-0 sm:px-2">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("billing.purchases.col.supplier")}</TableHead>
                    <TableHead className="text-right">{t("billing.payables.b0")}</TableHead>
                    <TableHead className="text-right">{t("billing.payables.b31")}</TableHead>
                    <TableHead className="text-right">{t("billing.payables.b61")}</TableHead>
                    <TableHead className="text-right">{t("billing.payables.b90")}</TableHead>
                    <TableHead className="text-right">{t("billing.payables.opening")}</TableHead>
                    <TableHead className="text-right">{t("billing.payables.advance")}</TableHead>
                    <TableHead className="text-right">{t("billing.payables.total")}</TableHead>
                    {canPay && <TableHead className="w-24" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.supplierId ?? r.name}>
                      <TableCell className="max-w-56 font-medium">
                        {r.supplierId ? (
                          <ModuleLink to={`suppliers/${r.supplierId}`} className="truncate hover:text-primary hover:underline">
                            {r.name}
                          </ModuleLink>
                        ) : (
                          <span className="truncate">{r.name}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{num(r.b0_30)}</TableCell>
                      <TableCell className="text-right">{num(r.b31_60)}</TableCell>
                      <TableCell className="text-right">{num(r.b61_90)}</TableCell>
                      <TableCell className="text-right text-danger-ink">{num(r.b90plus)}</TableCell>
                      <TableCell className="text-right">{num(r.opening)}</TableCell>
                      <TableCell className="text-right text-success-ink">{num(r.advance)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{money(r.total)}</TableCell>
                      {canPay && (
                        <TableCell className="text-right">
                          {r.supplierId && r.total > 0 && (
                            <Button size="sm" variant="outline" onClick={() => setPaying(r)}>
                              {t("billing.payables.pay")}
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
                {totals && (
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold">{t("billing.reports.total")}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(totals.b0_30)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(totals.b31_60)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(totals.b61_90)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(totals.b90plus)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(totals.opening)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(totals.advance)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{money(totals.total)}</TableCell>
                      {canPay && <TableCell />}
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
      <p className="mt-3 text-meta text-muted-foreground">{t("billing.payables.asOfDay", { date: formatDate(asOf) })}</p>

      <PaySupplierDialog
        open={!!paying}
        onOpenChange={(o) => !o && setPaying(null)}
        supplier={paying?.supplierId ? { id: paying.supplierId, name: paying.name, payable: paying.total } : null}
      />
    </Page>
  );
}
