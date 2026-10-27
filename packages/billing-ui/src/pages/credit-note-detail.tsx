"use client";

import * as React from "react";
import { describeError, ModuleLink, Page, QueryError, useFeature, useI18n, useRouteParams } from "@srirealtime/web";
import { ArrowLeftIcon, BanIcon, FileDownIcon, FileTextIcon, Loader2Icon, PackageCheckIcon, ReceiptIcon, Undo2Icon, WalletIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FadeIn,
  InitialsAvatar,
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
  Textarea,
  toast,
} from "@srirealtime/ui";
import { CreditNoteStatusPill } from "../components/credit-notes/credit-note-ui";
import { formatQty, money } from "../lib/format";
import { PDF_PATHS, usePdf } from "../lib/pdf";
import { useCancelCreditNote, useCreditNote } from "../lib/queries-credit-notes";
import type { CreditNote } from "../lib/types";

export default function CreditNoteDetailPage() {
  return (
    <React.Suspense fallback={null}>
      <Detail />
    </React.Suspense>
  );
}

function Detail() {
  const { t } = useI18n();
  const { id } = useRouteParams<{ id: string }>();
  const cn = useCreditNote(id);
  return (
    <Page>
      <div className="mb-3 flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <ModuleLink to="credit-notes">
            <ArrowLeftIcon /> {t("billing.cn.detail.back")}
          </ModuleLink>
        </Button>
      </div>
      {cn.isError ? (
        <QueryError error={cn.error} onRetry={() => void cn.refetch()} />
      ) : cn.isPending ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-section lg:grid-cols-[minmax(0,1fr)_21rem]">
          <Skeleton className="h-[60vh] rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : (
        <View note={cn.data} />
      )}
    </Page>
  );
}

function View({ note: n }: { note: CreditNote }) {
  const { t, formatDate } = useI18n();
  const documents = useFeature("documents");
  const pdf = usePdf();
  const cancel = useCancelCreditNote();
  const [confirm, setConfirm] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const name = `${n.number.replace(/[/\\]/g, "-")}.pdf`;
  const cancelled = n.status === "cancelled";
  const tax = (l: { cgst: number; sgst: number; igst: number }) => l.cgst + l.sgst + l.igst;
  const modeLabel = t(`billing.cn.modes.${n.refundMode}`);

  return (
    <>
      <div className="mb-section flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <InitialsAvatar name={n.customerName} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-semibold tracking-tight tabular-nums">{n.number}</h1>
              <CreditNoteStatusPill status={n.status} size="md" />
            </div>
            <p className="truncate text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{n.customerName}</span> · {formatDate(n.date)} · {t("billing.cn.against", { number: n.invoiceNumber })}
            </p>
          </div>
          <p className="ml-auto pl-2 text-right font-heading text-xl font-bold whitespace-nowrap tabular-nums sm:text-2xl xl:hidden">−{money(n.total)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-2 hidden text-right font-heading text-2xl font-bold tabular-nums xl:block">−{money(n.total)}</p>
          <Button asChild variant="outline" size="lg" className="h-11">
            <ModuleLink to={`invoices/${n.invoiceId}`}>
              <FileTextIcon /> {n.invoiceNumber}
            </ModuleLink>
          </Button>
          {documents && (
            <>
              <Button variant="outline" size="lg" className="h-11" disabled={!!pdf.busy} aria-busy={pdf.busy === "a4"} onClick={() => void pdf.run("a4", PDF_PATHS.creditNote(n.id), { mode: "download", fallbackName: name })}>
                {pdf.busy === "a4" ? <Loader2Icon className="animate-spin" /> : <FileDownIcon />}
                <span className="hidden sm:inline">{t("billing.pdf.download")}</span>
                <span className="sr-only sm:hidden">{t("billing.pdf.download")}</span>
              </Button>
              <Button variant="outline" size="lg" className="h-11" disabled={!!pdf.busy} aria-busy={pdf.busy === "thermal"} onClick={() => void pdf.run("thermal", PDF_PATHS.creditNoteThermal(n.id), { mode: "open", fallbackName: name })}>
                {pdf.busy === "thermal" ? <Loader2Icon className="animate-spin" /> : <ReceiptIcon />}
                <span className="hidden sm:inline">{t("billing.pdf.receipt")}</span>
                <span className="sr-only sm:hidden">{t("billing.pdf.receipt")}</span>
              </Button>
            </>
          )}
          {n.canCancel && (
            <Button variant="outline" size="lg" className="h-11 text-destructive hover:text-destructive" onClick={() => setConfirm(true)}>
              <BanIcon /> {t("billing.cn.detail.cancel")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-section lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <FadeIn className="min-w-0">
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-sm">{t("billing.cn.detail.lines")}</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("billing.reports.cols.item")}</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">{t("billing.cn.detail.qty")}</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">{t("billing.cn.taxable")}</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">{t("billing.cn.detail.taxSplit")}</TableHead>
                  <TableHead className="text-right">{t("billing.reports.cols.total")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {n.lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <p className="font-medium">{l.description}</p>
                      <p className="text-meta tabular-nums sm:hidden">{l.kind === "qty" ? `${formatQty(l.qty)} ${l.unit ?? ""}` : t("billing.cn.detail.valueOnly")}</p>
                      <p className="text-meta text-muted-foreground">
                        {l.hsn ? `HSN ${l.hsn} · ` : ""}
                        {l.gstRate}% GST
                        {l.restock && (
                          <span className="ml-1.5 inline-flex items-center gap-1 text-success-ink">
                            <PackageCheckIcon className="size-3.5" /> {t("billing.cn.detail.restocked")}
                          </span>
                        )}
                      </p>
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{l.kind === "qty" ? `${formatQty(l.qty)} ${l.unit ?? ""}` : t("billing.cn.detail.valueOnly")}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{money(l.taxable)}</TableCell>
                    <TableCell className="hidden text-right text-meta tabular-nums sm:table-cell">
                      {n.interState ? `IGST ${money(l.igst)}` : `CGST ${money(l.cgst)} · SGST ${money(l.sgst)}`}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{money(l.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="sm:hidden">{t("billing.cn.total")}</TableCell>
                  <TableCell colSpan={2} className="hidden sm:table-cell">
                    {t("billing.cn.total")}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{money(n.totals.taxable)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{money(tax(n.totals))}</TableCell>
                  <TableCell className="text-right font-heading text-base font-bold tabular-nums">{money(n.total)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
            <CardContent className="border-t py-3 text-sm text-muted-foreground">
              {n.totals.roundOff !== 0 && (
                <p className="tabular-nums">
                  {t("billing.cn.roundOff")}: {money(n.totals.roundOff)}
                </p>
              )}
              <p className="font-medium text-foreground">{n.amountInWords}</p>
            </CardContent>
          </Card>
        </FadeIn>

        <div className="grid min-w-0 gap-4 lg:sticky lg:top-20">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <span className="icon-chip size-8 text-primary">
                  <Undo2Icon className="size-4" />
                </span>
                {t("billing.cn.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-sm">
                <Row label={t("billing.cn.detail.against")}>
                  <ModuleLink to={`invoices/${n.invoiceId}`} className="font-medium text-primary underline-offset-4 hover:underline">
                    {n.invoiceNumber}
                  </ModuleLink>
                </Row>
                <Row label={t("billing.cn.detail.billDate")}>{formatDate(n.invoiceDate)}</Row>
                <Row label={t("billing.cn.detail.reason")}>{t(`billing.cn.reasons.${n.reason}`)}</Row>
                {n.note && <Row label={t("billing.cn.note")}>{n.note}</Row>}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <span className="icon-chip size-8 text-warning-ink">
                  <WalletIcon className="size-4" />
                </span>
                {t("billing.cn.detail.refund")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {n.refundAmount > 0 ? (
                <p className="font-semibold">{t("billing.cn.detail.refunded", { amount: money(n.refundAmount), mode: modeLabel })}</p>
              ) : n.refundMode === "credit_book" ? (
                <p>{t("billing.cn.detail.creditBook")}</p>
              ) : (
                <p className="text-muted-foreground">{t("billing.cn.detail.noRefund")}</p>
              )}
              {!n.canCancel && !cancelled && <p className="mt-2 text-meta text-muted-foreground">{t("billing.cn.detail.cantCancel")}</p>}
            </CardContent>
          </Card>
          {cancelled && (
            <Card className="gap-1 ring-destructive/30">
              <CardContent className="flex items-start gap-3 text-sm">
                <span className="icon-chip size-9 text-danger-ink">
                  <BanIcon className="size-4" />
                </span>
                <div>
                  <p className="font-medium text-danger-ink">{t("billing.cn.detail.cancelledOn", { date: n.cancelledAt ? formatDate(n.cancelledAt) : "" })}</p>
                  {n.cancelReason && <p className="text-muted-foreground">{n.cancelReason}</p>}
                </div>
              </CardContent>
            </Card>
          )}
          {n.tillSessionId && (
            <StatusPill tone="info" icon={ReceiptIcon}>
              POS
            </StatusPill>
          )}
        </div>
      </div>

      <Dialog open={confirm} onOpenChange={(o) => !cancel.isPending && (setConfirm(o), o && setReason(""))}>
        <DialogContent className="sm:max-w-md" closeLabel={t("billing.common.close")}>
          <DialogHeader>
            <DialogTitle>{t("billing.cn.detail.cancelTitle", { number: n.number })}</DialogTitle>
            <DialogDescription>{t("billing.cn.detail.cancelBody")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="cn-cancel-reason">{t("billing.cn.detail.cancelReason")}</Label>
            <Textarea id="cn-cancel-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="lg" onClick={() => setConfirm(false)} disabled={cancel.isPending}>
              {t("billing.common.close")}
            </Button>
            <Button
              variant="destructive"
              size="lg"
              disabled={cancel.isPending}
              onClick={async () => {
                try {
                  await cancel.mutateAsync({ id: n.id, reason: reason.trim() || undefined });
                  toast.success(t("billing.cn.detail.cancelled"));
                  setConfirm(false);
                } catch (err) {
                  toast.error(describeError(err, t));
                }
              }}
            >
              {cancel.isPending && <Loader2Icon className="animate-spin" />}
              {t("billing.cn.detail.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
