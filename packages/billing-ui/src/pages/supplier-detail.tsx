"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ConfirmDialog, describeError, ModuleLink, Page, PageHeading, QueryError, useI18n, useRouteParams } from "@rbms/web";
import { HandCoinsIcon, PencilIcon, ScrollTextIcon, StoreIcon, Undo2Icon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Skeleton,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@rbms/ui";
import { PaySupplierDialog } from "../components/inventory/payables-dialogs";
import { SupplierDialog } from "../components/inventory/supplier-dialog";
import { DownloadCsvButton } from "../components/reports/report-ui";
import { useHasPermission } from "../lib/access";
import { money } from "../lib/format";
import { useReversePayment, useSupplierStatement } from "../lib/queries-payables";
import type { Supplier } from "../lib/types";
import type { PurchasePayment, SupplierPayables } from "../lib/types-payables";

/** Supplier page: what we owe, the date-wise statement with a running balance, and the payments made. */
export default function SupplierDetailPage() {
  const { id } = useRouteParams<{ id: string }>();
  const { t, formatDate } = useI18n();
  const canPay = useHasPermission("inventory.purchases.pay");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [paying, setPaying] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [reversing, setReversing] = React.useState<PurchasePayment | null>(null);
  const reverse = useReversePayment();
  const back = { href: "suppliers", label: t("billing.nav.suppliers") };

  const sup = useQuery({ queryKey: ["suppliers", "one", id], queryFn: () => api.get<Supplier & SupplierPayables>(`/inventory/suppliers/${id}`), enabled: !!id });
  const st = useSupplierStatement(id, from, to);
  const pays = useQuery({ queryKey: ["suppliers", "payments", id], queryFn: () => api.get<{ items: PurchasePayment[] }>(`/inventory/suppliers/${id}/payments`), enabled: !!id });

  if (sup.isError) {
    return (
      <Page>
        <PageHeading title={t("billing.suppliers.title")} back={back} />
        <QueryError error={sup.error} onRetry={() => void sup.refetch()} />
      </Page>
    );
  }
  if (sup.isPending) {
    return (
      <Page>
        <PageHeading title={<Skeleton className="h-8 w-48" />} back={back} />
        <Skeleton className="h-64 rounded-2xl" />
      </Page>
    );
  }
  const s = sup.data;
  const statement = st.data;
  const payments = (pays.data?.items ?? []).filter((p) => !p.debitNoteId);
  const groupTotal = reversing ? payments.filter((p) => p.groupId === reversing.groupId && !p.reversedAt).reduce((sum, p) => sum + p.amount, 0) : 0;
  const typeLabel = (type: string) => t(`billing.payables.rowType.${type}`);

  return (
    <Page>
      <PageHeading
        icon={StoreIcon}
        back={back}
        title={s.name}
        description={[s.phone, s.gstin].filter(Boolean).join(" · ") || t("billing.suppliers.subtitle")}
        actions={
          <>
            <Button variant="outline" size="lg" onClick={() => setEditing(true)}>
              <PencilIcon /> {t("billing.common.edit")}
            </Button>
            <Button asChild variant="outline" size="lg">
              <ModuleLink to={`purchases?supplierId=${s.id}`}>{t("billing.suppliers.viewPurchases")}</ModuleLink>
            </Button>
            {canPay && (
              <Button size="lg" onClick={() => setPaying(true)}>
                <HandCoinsIcon /> {t("billing.payables.paySupplier")}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-section grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <Card>
          <CardContent>
            <p className="text-meta text-muted-foreground">{s.payable < 0 ? t("billing.payables.advancePaid") : t("billing.payables.weOwe")}</p>
            <p className={`font-heading text-2xl font-bold tabular-nums ${s.payable > 0 ? "text-warning-ink" : s.payable < 0 ? "text-success-ink" : ""}`}>{money(Math.abs(s.payable))}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-meta text-muted-foreground">{t("billing.payables.opening")}</p>
            <p className="font-heading text-2xl font-bold tabular-nums">{money(s.openingBalance ?? 0)}</p>
            {s.openingDate && <p className="text-meta text-muted-foreground">{formatDate(s.openingDate)}</p>}
          </CardContent>
        </Card>
      </div>

      <Card className="mb-section">
        <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ScrollTextIcon className="size-4 text-primary" /> {t("billing.payables.statement")}
          </CardTitle>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label htmlFor="st-from">{t("billing.payables.from")}</Label>
              <Input id="st-from" type="date" className="w-40" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="st-to">{t("billing.payables.to")}</Label>
              <Input id="st-to" type="date" className="w-40" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </div>
            <DownloadCsvButton path={`/inventory/suppliers/${s.id}/statement`} params={{ from: from || undefined, to: to || undefined }} fileName={`statement-${s.name}.csv`} />
          </div>
        </CardHeader>
        <CardContent className="px-0 sm:px-2">
          {st.isError && !statement ? (
            <QueryError error={st.error} onRetry={() => void st.refetch()} />
          ) : !statement ? (
            <Skeleton className="mx-4 h-40 rounded-xl" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("billing.payables.date")}</TableHead>
                    <TableHead>{t("billing.payables.details")}</TableHead>
                    <TableHead className="text-right">{t("billing.payables.billsCol")}</TableHead>
                    <TableHead className="text-right">{t("billing.payables.paymentsCol")}</TableHead>
                    <TableHead className="text-right">{t("billing.payables.balance")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {from && (
                    <TableRow className="bg-muted/30">
                      <TableCell colSpan={4} className="text-muted-foreground">
                        {t("billing.payables.balanceBefore", { date: formatDate(from) })}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{money(statement.openingBalance)}</TableCell>
                    </TableRow>
                  )}
                  {statement.rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        {t("billing.payables.statementEmpty")}
                      </TableCell>
                    </TableRow>
                  )}
                  {statement.rows.map((r, i) => (
                    <TableRow key={`${r.id ?? r.type}-${i}`}>
                      <TableCell className="whitespace-nowrap tabular-nums">{formatDate(r.date)}</TableCell>
                      <TableCell className="max-w-72">
                        <p className="truncate">
                          <span className="font-medium">{typeLabel(r.type)}</span>
                          {r.ref && <span className="font-mono"> {r.ref}</span>}
                        </p>
                        <p className="truncate text-meta text-muted-foreground">{r.description}</p>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.credit ? money(r.credit) : ""}</TableCell>
                      <TableCell className="text-right tabular-nums text-success-ink">{r.debit ? money(r.debit) : ""}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{money(r.balance)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={2} className="font-semibold">
                      {t("billing.reports.total")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(statement.totalCredit)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(statement.totalDebit)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{money(statement.closingBalance)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("billing.payables.paymentsMade")}</CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-2">
          {payments.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("billing.payables.noPayments")}</p>
          ) : (
            <ul className="divide-y px-4">
              {payments.slice(0, 50).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className={p.reversedAt ? "text-muted-foreground line-through" : "font-medium"}>
                      {money(p.amount)} · {t(`billing.payables.modes.${p.mode}`)}
                      {p.billNumber ? ` · ${p.billNumber}` : ` · ${t("billing.payables.onAccount")}`}
                    </p>
                    <p className="text-meta text-muted-foreground">
                      {formatDate(p.date)}
                      {p.reference ? ` · ${p.reference}` : ""}
                    </p>
                  </div>
                  {p.reversedAt ? (
                    <StatusPill tone="neutral">{t("billing.payables.reversed")}</StatusPill>
                  ) : (
                    canPay && (
                      <Button size="sm" variant="ghost" onClick={() => setReversing(p)}>
                        <Undo2Icon /> {t("billing.payables.reverse")}
                      </Button>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <PaySupplierDialog open={paying} onOpenChange={setPaying} supplier={{ id: s.id, name: s.name, payable: s.payable }} />
      <SupplierDialog open={editing} supplier={s} onOpenChange={setEditing} />
      <ConfirmDialog
        open={!!reversing}
        onOpenChange={(o) => !o && setReversing(null)}
        title={t("billing.payables.reverseTitle", { amount: money(groupTotal) })}
        description={t("billing.payables.reverseBody")}
        confirmLabel={t("billing.payables.reverse")}
        onConfirm={async () => {
          if (!reversing) return;
          try {
            await reverse.mutateAsync({ id: reversing.groupId, group: true });
            toast.success(t("billing.payables.reversedToast"));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </Page>
  );
}
