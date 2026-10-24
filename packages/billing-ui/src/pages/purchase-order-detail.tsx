"use client";

import * as React from "react";
import { ConfirmDialog, describeError, DetailRow, ModuleLink, Page, PageHeading, QueryError, useI18n, useRouteParams } from "@srirealtime/web";
import { BanIcon, ClipboardListIcon, DownloadIcon, Loader2Icon, PackageCheckIcon, PrinterIcon, ReceiptTextIcon, SendIcon, TruckIcon } from "lucide-react";
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
  Input,
  Label,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@srirealtime/ui";
import { ReceiveDialog } from "../components/inventory/payables-dialogs";
import { PoStatusPill } from "../components/inventory/po-status";
import { formatQty, money } from "../lib/format";
import { PDF_PATHS, usePdf } from "../lib/pdf";
import { useBillReceipt, useCancelReceipt, usePurchaseOrder, usePurchaseOrderAction } from "../lib/queries-payables";
import type { GoodsReceipt } from "../lib/types-payables";

export default function PurchaseOrderDetailPage() {
  const { id } = useRouteParams<{ id: string }>();
  const { t, formatDate } = useI18n();
  const q = usePurchaseOrder(id);
  const action = usePurchaseOrderAction();
  const cancelReceipt = useCancelReceipt();
  const pdf = usePdf();
  const [cancelling, setCancelling] = React.useState<GoodsReceipt | null>(null);
  const [receiving, setReceiving] = React.useState<"receive" | "convert" | null>(null);
  const [confirm, setConfirm] = React.useState<"cancel" | "close" | null>(null);
  const [billing, setBilling] = React.useState<GoodsReceipt | null>(null);
  const back = { href: "purchase-orders", label: t("billing.po.title") };

  if (q.isError) {
    return (
      <Page>
        <PageHeading title={t("billing.po.detailTitle")} back={back} />
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      </Page>
    );
  }
  if (q.isPending) {
    return (
      <Page>
        <PageHeading title={<Skeleton className="h-8 w-48" />} back={back} />
        <Skeleton className="h-72 rounded-2xl" />
      </Page>
    );
  }

  const po = q.data;
  const open = po.status === "draft" || po.status === "sent" || po.status === "partially_received";
  const canEditState = po.status === "draft" || po.status === "sent";
  const nothingReceived = po.lines.every((l) => l.received === 0);
  const run = async (kind: "send" | "cancel" | "close") => {
    try {
      await action.mutateAsync({ id: po.id, kind });
      toast.success(t(`billing.po.done.${kind}`));
    } catch (err) {
      toast.error(describeError(err, t));
      throw err;
    }
  };

  return (
    <Page>
      <PageHeading
        icon={ClipboardListIcon}
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{po.number}</span>
            <PoStatusPill status={po.status} />
          </span>
        }
        description={`${po.supplier.name} · ${formatDate(po.date)}`}
        actions={
          <>
            <Button
              variant="outline"
              size="lg"
              disabled={!!pdf.busy}
              aria-busy={pdf.busy === "po-print"}
              onClick={() => void pdf.run("po-print", PDF_PATHS.purchaseOrder(po.id), { mode: "open", fallbackName: `${po.number}.pdf` })}
            >
              {pdf.busy === "po-print" ? <Loader2Icon className="animate-spin" /> : <PrinterIcon />} {t("billing.po.print")}
            </Button>
            <Button
              variant="outline"
              size="lg"
              disabled={!!pdf.busy}
              aria-busy={pdf.busy === "po-pdf"}
              onClick={() => void pdf.run("po-pdf", PDF_PATHS.purchaseOrder(po.id), { mode: "download", fallbackName: `${po.number}.pdf` })}
            >
              {pdf.busy === "po-pdf" ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} {t("billing.po.pdf")}
            </Button>
            {po.status === "draft" && (
              <Button variant="outline" size="lg" disabled={action.isPending} onClick={() => void run("send").catch(() => undefined)}>
                {action.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />} {t("billing.po.markSent")}
              </Button>
            )}
            {open && (
              <>
                <Button variant="outline" size="lg" onClick={() => setReceiving("receive")}>
                  <TruckIcon /> {t("billing.po.receive")}
                </Button>
                <Button size="lg" onClick={() => setReceiving("convert")}>
                  <ReceiptTextIcon /> {t("billing.po.convert")}
                </Button>
              </>
            )}
            {po.status === "partially_received" && (
              <Button variant="outline" size="lg" onClick={() => setConfirm("close")}>
                <PackageCheckIcon /> {t("billing.po.close")}
              </Button>
            )}
            {canEditState && nothingReceived && (
              <Button variant="outline" size="lg" className="text-danger-ink" onClick={() => setConfirm("cancel")}>
                <BanIcon /> {t("billing.po.cancel")}
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-section md:grid-cols-[minmax(0,1fr)_19rem] md:items-start">
        <div className="grid min-w-0 gap-section">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("billing.form.items")}</CardTitle>
            </CardHeader>
            <CardContent className="px-0 sm:px-2">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("billing.form.description")}</TableHead>
                      <TableHead className="text-right">{t("billing.po.ordered")}</TableHead>
                      <TableHead className="text-right">{t("billing.po.received")}</TableHead>
                      <TableHead className="text-right">{t("billing.po.pending")}</TableHead>
                      <TableHead className="text-right">{t("billing.purchaseForm.costPrice")}</TableHead>
                      <TableHead className="text-right">{t("billing.purchases.lineTotal")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {po.lines.map((l, i) => {
                      const pending = Math.max(0, Math.round((l.qty - l.received) * 1000) / 1000);
                      return (
                        <TableRow key={i}>
                          <TableCell className="max-w-64 truncate font-medium">{l.description}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatQty(l.qty)} <span className="text-xs text-muted-foreground">{l.unit}</span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatQty(l.received)}</TableCell>
                          <TableCell className={`text-right tabular-nums ${pending > 0 && po.status !== "received" ? "text-warning-ink" : "text-muted-foreground"}`}>{formatQty(pending)}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(l.rate)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{money(l.total)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("billing.po.receipts")}</CardTitle>
            </CardHeader>
            <CardContent className="px-0 sm:px-2">
              {po.receipts.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("billing.po.noReceipts")}</p>
              ) : (
                <ul className="divide-y px-4">
                  {po.receipts.map((g) => (
                    <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                      <div className="min-w-0">
                        <p className={`font-mono font-medium ${g.cancelledAt ? "text-muted-foreground line-through" : ""}`}>
                          {g.number}
                          {g.cancelledAt && <span className="ml-2 font-sans text-xs no-underline">{t("billing.po.receiptCancelledTag")}</span>}
                        </p>
                        <p className="text-meta text-muted-foreground">
                          {formatDate(g.date)} · {g.lines.map((l) => `${l.description} × ${formatQty(l.qty)}`).join(", ")}
                        </p>
                        {g.freight + g.otherCharges > 0 && (
                          <p className="text-meta text-muted-foreground">{t("billing.po.charges", { amount: money(g.freight + g.otherCharges) })}</p>
                        )}
                      </div>
                      {g.cancelledAt ? null : g.purchaseId ? (
                        <Button asChild size="sm" variant="outline">
                          <ModuleLink to={`purchases/${g.purchaseId}`}>{t("billing.po.viewBill")}</ModuleLink>
                        </Button>
                      ) : (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className="text-danger-ink" onClick={() => setCancelling(g)}>
                            {t("billing.po.cancelReceipt")}
                          </Button>
                          <Button size="sm" onClick={() => setBilling(g)}>
                            {t("billing.po.makeBill")}
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          {po.notes && (
            <Card className="gap-2">
              <CardContent className="text-sm">
                <p className="mb-1 text-meta font-medium text-muted-foreground">{t("billing.form.notes")}</p>
                <p className="whitespace-pre-wrap">{po.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="md:sticky md:top-20">
          <CardHeader>
            <CardTitle className="text-sm">{t("billing.po.summary")}</CardTitle>
          </CardHeader>
          <CardContent className="grid">
            <DetailRow label={t("billing.purchaseForm.supplier")}>{po.supplier.name}</DetailRow>
            <DetailRow label={t("billing.po.col.date")}>{formatDate(po.date)}</DetailRow>
            <DetailRow label={t("billing.po.col.expected")}>{po.expectedDate ? formatDate(po.expectedDate) : "—"}</DetailRow>
            <div className="mt-1 flex items-baseline justify-between border-t pt-3">
              <span className="font-semibold">{t("billing.po.orderValue")}</span>
              <span className="font-heading text-2xl font-bold text-primary tabular-nums">{money(po.total)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <ReceiveDialog open={receiving !== null} onOpenChange={(o) => !o && setReceiving(null)} order={po} convert={receiving === "convert"} />
      <BillReceiptDialog receipt={billing} onClose={() => setBilling(null)} />
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={t("billing.po.confirm.cancelReceiptTitle", { number: cancelling?.number ?? "" })}
        description={t("billing.po.confirm.cancelReceiptBody")}
        confirmLabel={t("billing.po.cancelReceipt")}
        onConfirm={async () => {
          try {
            await cancelReceipt.mutateAsync({ id: cancelling!.id });
            toast.success(t("billing.po.receiptCancelled"));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t(`billing.po.confirm.${confirm ?? "cancel"}Title`, { number: po.number })}
        description={t(`billing.po.confirm.${confirm ?? "cancel"}Body`)}
        confirmLabel={t(confirm === "close" ? "billing.po.close" : "billing.po.cancel")}
        onConfirm={() => run(confirm ?? "cancel")}
      />
    </Page>
  );
}

/** Makes the purchase bill of a goods receipt: the supplier's bill number and an optional due date. */
function BillReceiptDialog({ receipt, onClose }: { receipt: GoodsReceipt | null; onClose: () => void }) {
  const { t } = useI18n();
  const bill = useBillReceipt();
  const [billNumber, setBillNumber] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    setBillNumber("");
    setDueDate("");
    setTouched(false);
  }, [receipt?.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!receipt || !billNumber.trim()) return;
    try {
      const p = await bill.mutateAsync({ id: receipt.id, body: { billNumber: billNumber.trim(), ...(dueDate ? { dueDate } : {}) } });
      toast.success(t("billing.purchaseForm.saved", { number: p.billNumber }));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={!!receipt} onOpenChange={(o) => !bill.isPending && !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.po.makeBill")}</DialogTitle>
          <DialogDescription>{receipt?.number}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="gb-bill">{t("billing.purchaseForm.billNumber")}</Label>
            <Input id="gb-bill" autoFocus className="font-mono" autoComplete="off" maxLength={40} value={billNumber} aria-invalid={touched && !billNumber.trim()} onChange={(e) => setBillNumber(e.target.value)} />
            {touched && !billNumber.trim() && <p className="text-xs text-destructive">{t("billing.purchaseForm.errors.billNumber")}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="gb-due">
              {t("billing.payables.dueDate")} ({t("billing.common.optional")})
            </Label>
            <Input id="gb-due" type="date" value={dueDate} min={receipt?.date} max={undefined} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="lg" onClick={onClose} disabled={bill.isPending}>
              {t("billing.common.cancel")}
            </Button>
            <Button type="submit" size="lg" disabled={bill.isPending}>
              {bill.isPending && <Loader2Icon className="animate-spin" />}
              {t("billing.po.makeBill")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


