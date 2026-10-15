"use client";

import * as React from "react";
import { ConfirmDialog, describeError, DetailRow, ModuleLink, Page, PageHeading, QueryError, useFeature, useI18n, useRouteParams } from "@srirealtime/web";
import { BanIcon, CheckCircle2Icon, ClockIcon, FileDownIcon, Link2Icon, Loader2Icon, ReceiptTextIcon, StoreIcon, TruckIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FadeIn,
  InitialsAvatar,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@srirealtime/ui";
import { PurchaseStatusPill } from "../components/inventory/stock-meta";
import { formatQty, money, stateLabel } from "../lib/format";
import { usePurchase, usePurchaseAction } from "../lib/queries-v2";
import { PDF_PATHS, usePdf } from "../lib/pdf";

export default function PurchaseDetailPage() {
  const { id } = useRouteParams<{ id: string }>();
  const { t, formatDate } = useI18n();
  const q = usePurchase(id);
  const action = usePurchaseAction();
  const [cancelling, setCancelling] = React.useState(false);
  const documents = useFeature("documents");
  const pdf = usePdf();
  const back = { href: "purchases", label: t("billing.nav.purchases") };

  if (q.isError) {
    return (
      <Page className="max-w-4xl">
        <PageHeading title={t("billing.purchases.detailTitle")} back={back} />
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      </Page>
    );
  }
  if (q.isPending) {
    return (
      <Page className="max-w-4xl">
        <PageHeading title={<Skeleton className="h-8 w-48" />} back={back} />
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
      </Page>
    );
  }

  const p = q.data;
  const totals = p.totals ?? { subtotal: 0, discount: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, roundOff: 0, total: p.total, taxBreakup: [] };
  const itc = totals.cgst + totals.sgst + totals.igst;
  const inter = totals.igst > 0;
  const cancelled = p.status === "cancelled";
  const busy = action.isPending;

  const togglePaid = async () => {
    try {
      await action.mutateAsync({ kind: "paid", id: p.id, paid: !p.paid });
      toast.success(!p.paid ? t("billing.purchases.markedPaid") : t("billing.purchases.markedUnpaid"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Page className="max-w-5xl">
      <PageHeading
        icon={TruckIcon}
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{p.billNumber}</span>
            <PurchaseStatusPill paid={p.paid} status={p.status} />
          </span>
        }
        description={`${p.supplier?.name ?? "—"} · ${formatDate(p.date)}`}
        actions={
          <>
            {documents && (
              <Button
                variant="outline"
                size="lg"
                disabled={!!pdf.busy}
                aria-busy={!!pdf.busy}
                onClick={() => void pdf.run("purchase", PDF_PATHS.purchase(p.id), { mode: "download", fallbackName: `${p.billNumber || "purchase"}.pdf` })}
              >
                {pdf.busy ? <Loader2Icon className="animate-spin" /> : <FileDownIcon />} {t("billing.pdf.purchase")}
              </Button>
            )}
            {!cancelled && (
            <>
              <Button variant={p.paid ? "outline" : "default"} size="lg" disabled={busy} onClick={() => void togglePaid()}>
                {p.paid ? <ClockIcon /> : <CheckCircle2Icon />}
                {p.paid ? t("billing.purchases.markUnpaid") : t("billing.purchases.markPaid")}
              </Button>
              <Button variant="outline" size="lg" className="text-danger-ink" disabled={busy} onClick={() => setCancelling(true)}>
                <BanIcon /> {t("billing.purchases.cancel")}
              </Button>
            </>
            )}
          </>
        }
      />

      {cancelled && (
        <Alert className="mb-4">
          <BanIcon />
          <AlertTitle>{t("billing.purchases.cancelledTitle")}</AlertTitle>
          <AlertDescription>{t("billing.purchases.cancelledBody")}</AlertDescription>
        </Alert>
      )}

      <FadeIn className="grid gap-4 md:grid-cols-[minmax(0,1fr)_19rem] md:items-start">
        <div className="grid min-w-0 gap-4">
          {/* Supplier */}
          <Card className="gap-3 py-4">
            <CardHeader className="flex flex-row items-center gap-2 px-4">
              <span className="icon-chip size-8 text-primary">
                <StoreIcon className="size-4" />
              </span>
              <CardTitle className="text-sm">{t("billing.purchaseForm.supplier")}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-start gap-3 px-4">
              <InitialsAvatar name={p.supplier?.name} size="lg" />
              <div className="min-w-0 flex-1 text-sm">
                {p.supplier?.id ? (
                  <ModuleLink to={`purchases?supplier=${p.supplier.id}`} className="font-semibold hover:underline">
                    {p.supplier.name}
                  </ModuleLink>
                ) : (
                  <p className="font-semibold">{p.supplier?.name ?? "—"}</p>
                )}
                {p.supplier?.gstin && <p className="font-mono text-xs">GSTIN {p.supplier.gstin}</p>}
                <p className="text-xs text-muted-foreground">
                  {[p.supplier?.phone, p.supplier?.stateCode && stateLabel(p.supplier.stateCode)].filter(Boolean).join(" · ") ||
                    t("billing.picker.noDetails")}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Lines */}
          <Card className="gap-3 py-4">
            <CardHeader className="flex flex-row items-center gap-2 px-4">
              <span className="icon-chip size-8 text-primary">
                <ReceiptTextIcon className="size-4" />
              </span>
              <CardTitle className="text-sm">{t("billing.form.items")}</CardTitle>
            </CardHeader>
            <CardContent className="px-0 sm:px-2">
              {/* Desktop table */}
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("billing.form.description")}</TableHead>
                      <TableHead className="text-right">{t("billing.form.qty")}</TableHead>
                      <TableHead className="text-right">{t("billing.purchaseForm.costPrice")}</TableHead>
                      <TableHead className="text-right">{t("billing.form.gst")}</TableHead>
                      <TableHead className="text-right">{t("billing.purchases.lineTotal")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {p.lines.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell className="max-w-64">
                          <p className="truncate font-medium">{l.description}</p>
                          <p className="flex items-center gap-1 text-xs text-muted-foreground">
                            {l.hsn && <span>HSN {l.hsn}</span>}
                            {l.itemId && (
                              <span className="inline-flex items-center gap-0.5 text-success-ink">
                                <Link2Icon className="size-3" aria-hidden /> {t("billing.purchaseForm.linkedShort")}
                              </span>
                            )}
                          </p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatQty(l.qty)} <span className="text-xs text-muted-foreground">{l.unit}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{money(l.rate)}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.gstRate}%</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{money(l.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* Phone list */}
              <ul className="divide-y px-4 sm:hidden">
                {p.lines.map((l, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{l.description}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {formatQty(l.qty)} {l.unit} × {money(l.rate)} · GST {l.gstRate}%
                      </p>
                    </div>
                    <span className="shrink-0 font-medium tabular-nums">{money(l.total)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {p.notes && (
            <Card className="gap-2 py-4">
              <CardContent className="px-4 text-sm">
                <p className="mb-1 text-xs font-medium text-muted-foreground">{t("billing.form.notes")}</p>
                <p className="whitespace-pre-wrap">{p.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Totals */}
        <div className="grid gap-4 md:sticky md:top-20">
          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">{t("billing.purchaseForm.summary")}</CardTitle>
            </CardHeader>
            <CardContent className="grid px-4">
              <DetailRow label={t("billing.purchaseForm.billNumber")}>
                <span className="font-mono">{p.billNumber}</span>
              </DetailRow>
              <DetailRow label={t("billing.purchaseForm.date")}>{formatDate(p.date)}</DetailRow>
              <div className="my-1 border-t" />
              <DetailRow label={t("billing.totals.taxable")}>
                <span className="tabular-nums">{money(totals.taxable)}</span>
              </DetailRow>
              {inter ? (
                <DetailRow label="IGST">
                  <span className="tabular-nums">{money(totals.igst)}</span>
                </DetailRow>
              ) : (
                <>
                  <DetailRow label="CGST">
                    <span className="tabular-nums">{money(totals.cgst)}</span>
                  </DetailRow>
                  <DetailRow label="SGST">
                    <span className="tabular-nums">{money(totals.sgst)}</span>
                  </DetailRow>
                </>
              )}
              {totals.roundOff !== 0 && (
                <DetailRow label={t("billing.totals.roundOff")}>
                  <span className="tabular-nums">
                    {totals.roundOff > 0 ? "+" : "−"}
                    {money(Math.abs(totals.roundOff))}
                  </span>
                </DetailRow>
              )}
              <div className="mt-1 flex items-baseline justify-between border-t pt-3">
                <span className="font-semibold">{t("billing.totals.grandTotal")}</span>
                <span className="font-heading text-2xl font-bold text-primary tabular-nums">{money(p.total)}</span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-success/14 px-3 py-2.5">
                <span className="text-sm font-medium text-success-ink">{t("billing.purchases.itc")}</span>
                <span className="font-semibold text-success-ink tabular-nums">{cancelled ? money(0) : money(itc)}</span>
              </div>
              {totals.taxBreakup && totals.taxBreakup.length > 0 && (
                <div className="mt-3 grid gap-1 rounded-lg bg-muted/50 p-2 text-xs">
                  {totals.taxBreakup.map((b) => (
                    <div key={b.gstRate} className="flex justify-between gap-2 tabular-nums">
                      <span className="text-muted-foreground">
                        GST {b.gstRate}% · {money(b.taxable)}
                      </span>
                      <span>{money(b.cgst + b.sgst + b.igst)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </FadeIn>

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t("billing.purchases.cancelTitle", { number: p.billNumber })}
        description={t("billing.purchases.cancelBody")}
        confirmLabel={t("billing.purchases.cancel")}
        onConfirm={async () => {
          try {
            await action.mutateAsync({ kind: "cancel", id: p.id });
            toast.success(t("billing.purchases.cancelled"));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </Page>
  );
}
