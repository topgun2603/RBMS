"use client";

import * as React from "react";
import { ConfirmDialog, describeError, ModuleLink, Page, QueryError, useFeature, useI18n, useModuleNavigate, useQueryParams, useRouteParams, useShop } from "@srirealtime/web";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  BanIcon,
  CheckCircle2Icon,
  FileDownIcon,
  GlobeIcon,
  Loader2Icon,
  IndianRupeeIcon,
  MessagesSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  PrinterIcon,
  ReceiptIcon,
  SendIcon,
  Share2Icon,
  Trash2Icon,
  WalletIcon,
  XIcon,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  AnimatedNumber,
  AnimatePresence,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FadeIn,
  InitialsAvatar,
  motion,
  Progress,
  Skeleton,
  StatusPill,
  SuccessCheck,
  toast,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import { EINVOICE_FEATURE, EInvoiceCard } from "../components/einvoice/einvoice-card";
import { InvoiceDocument } from "../components/invoice-document";
import { CancelDialog, PaymentDialog, ShareDialog } from "../components/invoice-dialogs";
import { isOnlinePayment, MessagesTimeline, SendInvoiceButton } from "../components/payments/send-invoice";
import { StatusBadge } from "../components/status-badge";
import { money } from "../lib/format";
import { useDeleteInvoice, useInvoice, useInvoiceAction } from "../lib/queries";
import { invoiceWarnings } from "../lib/queries-v2";
import { PDF_PATHS, usePdf } from "../lib/pdf";
import type { Invoice } from "../lib/types";

export default function InvoiceDetailPage() {
  return (
    <React.Suspense fallback={null}>
      <InvoiceDetail />
    </React.Suspense>
  );
}

function InvoiceDetail() {
  const { t } = useI18n();
  const { id } = useRouteParams<{ id: string }>();
  const inv = useInvoice(id);

  return (
    <Page>
      <div className="mb-3 flex items-center gap-2" data-print-hide>
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <ModuleLink to="invoices">
            <ArrowLeftIcon /> {t("billing.nav.invoices")}
          </ModuleLink>
        </Button>
      </div>
      {inv.isError ? (
        <QueryError error={inv.error} onRetry={() => void inv.refetch()} />
      ) : inv.isPending ? (
        <DetailSkeleton />
      ) : (
        <InvoiceView invoice={inv.data} />
      )}
    </Page>
  );
}

function DetailSkeleton() {
  return (
    <div data-print-hide>
      <div className="mb-5 flex items-center gap-3">
        <Skeleton className="size-14 rounded-full" />
        <div className="grid flex-1 gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_21rem]">
        <Skeleton className="h-[70vh] rounded-2xl" />
        <div className="grid content-start gap-section">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

type DialogKind = null | "pay" | "cancel" | "share" | "issue" | "delete";

/** Reads ?issued=1 / ?warning=… once, then strips them from the URL. */
function useArrivalFlags() {
  const params = useQueryParams();
  const navigate = useModuleNavigate();
  const [flags] = React.useState(() => ({
    issued: params.get("issued") === "1",
    creditWarning: params.get("warning") === "credit_limit_exceeded",
  }));
  React.useEffect(() => {
    if (params.has("issued") || params.has("warning")) {
      const next = new URLSearchParams(params.toString());
      next.delete("issued");
      next.delete("warning");
      const qs = next.toString();
      navigate(qs ? `?${qs}` : "?", { replace: true, scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on arrival
  }, []);
  return flags;
}

function InvoiceView({ invoice: inv }: { invoice: Invoice }) {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const reduced = useReducedMotionSafe();
  const { shopName, logoUrl } = useShop();
  const action = useInvoiceAction();
  const del = useDeleteInvoice();
  const flags = useArrivalFlags();
  const whatsapp = useFeature("invoices.whatsapp");
  const documents = useFeature("documents");
  const einvoice = useFeature(EINVOICE_FEATURE);
  const pdf = usePdf();
  const pdfName = `${(inv.number ?? t("billing.status.draft")).replace(/[/\\]/g, "-")}.pdf`;
  const downloadPdf = () => void pdf.run("a4", PDF_PATHS.invoice(inv.id), { mode: "download", fallbackName: pdfName });
  const printReceipt = () => void pdf.run("thermal", PDF_PATHS.invoiceThermal(inv.id), { mode: "open", fallbackName: pdfName });
  const [dialog, setDialog] = React.useState<DialogKind>(null);
  const [unpay, setUnpay] = React.useState<string | null>(null);
  const [celebrate, setCelebrate] = React.useState(flags.issued);
  const [creditWarning, setCreditWarning] = React.useState(flags.creditWarning || invoiceWarnings(inv).includes("credit_limit_exceeded"));

  // The celebration card is brief: it tucks itself away after a few seconds.
  React.useEffect(() => {
    if (!celebrate) return;
    const id = window.setTimeout(() => setCelebrate(false), 9000);
    return () => window.clearTimeout(id);
  }, [celebrate]);

  const draft = inv.status === "draft";
  const open = inv.status === "issued" || inv.status === "partially_paid";
  const cancelled = inv.status === "cancelled";
  const sendable = !draft && !cancelled;
  const paidPct = inv.total > 0 ? Math.min(100, Math.round((inv.paid / inv.total) * 100)) : 0;

  const print = () => {
    const prev = document.title;
    document.title = `${shopName} ${inv.number ?? t("billing.status.draft")}`.replace(/[/\\]/g, "-");
    window.print();
    window.setTimeout(() => (document.title = prev), 500);
  };

  const setDialogOpen = (d: DialogKind) => (o: boolean) => setDialog(o ? d : null);
  const openShare = () => setDialog("share");

  return (
    <>
      {/* Arrival: bill just issued */}
      <AnimatePresence initial={!reduced}>
        {celebrate && sendable && (
          <motion.div
            key="issued"
            data-print-hide
            initial={reduced ? false : { opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="mb-4"
          >
            <Card className="relative gap-0 overflow-hidden py-0">
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5" role="status" aria-live="polite">
                <div className="flex items-center gap-4">
                  <SuccessCheck size={56} />
                  <div className="min-w-0">
                    <p className="font-heading text-lg font-semibold">{t("billing.form.issued", { number: inv.number ?? "" })}</p>
                    <p className="text-sm text-muted-foreground">{t("billing.billDetail.issuedNext")}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 sm:ml-auto sm:pr-8">
                  <SendInvoiceButton invoice={inv} onManual={openShare} />
                  <Button asChild variant="outline" size="lg" className="h-11">
                    <ModuleLink to="invoices/new">
                      <PlusIcon /> {t("billing.billDetail.newBill")}
                    </ModuleLink>
                  </Button>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 text-muted-foreground"
                aria-label={t("billing.common.close")}
                onClick={() => setCelebrate(false)}
              >
                <XIcon />
              </Button>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {creditWarning && (
        <Alert data-print-hide className="mb-4 border-warning/40 bg-warning/10 text-warning-ink">
          <AlertTriangleIcon />
          <AlertTitle>{t("billing.form.creditWarningTitle")}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-warning-ink/90">
            <span>{t("billing.form.creditWarning", { name: inv.customer.name })}</span>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setCreditWarning(false)}>
              {t("billing.billDetail.dismiss")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Title + actions */}
      <div className="mb-section flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between" data-print-hide>
        <div className="flex min-w-0 items-center gap-3">
          <InitialsAvatar name={inv.customer.name} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-semibold tracking-tight tabular-nums">{inv.number ?? t("billing.detail.draftTitle")}</h1>
              <StatusBadge status={inv.status} overdue={inv.isOverdue} size="md" />
            </div>
            <p className="truncate text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{inv.customer.name}</span> · {formatDate(inv.date)}
              {inv.dueDate && open ? ` · ${t("billing.invoices.due", { date: formatDate(inv.dueDate) })}` : ""}
            </p>
          </div>
          <p className="ml-auto pl-2 text-right font-heading text-xl font-bold tabular-nums sm:text-2xl 2xl:hidden">{money(inv.total)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-2 hidden text-right font-heading text-2xl font-bold tabular-nums 2xl:block">{money(inv.total)}</p>
          {draft && (
            <>
              <Button size="lg" className="h-11" onClick={() => setDialog("issue")}>
                <SendIcon /> {t("billing.detail.issue")}
              </Button>
              <Button asChild variant="outline" size="lg" className="h-11">
                <ModuleLink to={`invoices/${inv.id}/edit`}>
                  <PencilIcon /> {t("billing.detail.edit")}
                </ModuleLink>
              </Button>
            </>
          )}
          {sendable && <SendInvoiceButton invoice={inv} onManual={openShare} />}
          {open && (
            <Button variant="outline" size="lg" className="h-11" onClick={() => setDialog("pay")}>
              <IndianRupeeIcon /> {t("billing.detail.recordPayment")}
            </Button>
          )}
          <Button variant="outline" size="lg" className="h-11" onClick={print}>
            <PrinterIcon /> <span className="hidden sm:inline">{t("billing.detail.print")}</span>
            <span className="sr-only sm:hidden">{t("billing.detail.print")}</span>
          </Button>
          {documents && (
            <>
              <Button variant="outline" size="lg" className="h-11" onClick={downloadPdf} disabled={!!pdf.busy} aria-busy={pdf.busy === "a4"}>
                {pdf.busy === "a4" ? <Loader2Icon className="animate-spin" /> : <FileDownIcon />}
                <span className="hidden sm:inline">{t("billing.pdf.download")}</span>
                <span className="sr-only sm:hidden">{t("billing.pdf.download")}</span>
              </Button>
              <Button variant="outline" size="lg" className="h-11" onClick={printReceipt} disabled={!!pdf.busy} aria-busy={pdf.busy === "thermal"}>
                {pdf.busy === "thermal" ? <Loader2Icon className="animate-spin" /> : <ReceiptIcon />}
                <span className="hidden sm:inline">{t("billing.pdf.receipt")}</span>
                <span className="sr-only sm:hidden">{t("billing.pdf.receipt")}</span>
              </Button>
            </>
          )}
          {(draft || !cancelled) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-lg" className="size-11" aria-label={t("billing.detail.more")}>
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {sendable && whatsapp && (
                  <DropdownMenuItem className="h-10" onSelect={openShare}>
                    <Share2Icon /> {t("billing.billDetail.shareLink")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="h-10" onSelect={print}>
                  <PrinterIcon /> {t("billing.detail.savePdf")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {draft ? (
                  <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => setDialog("delete")}>
                    <Trash2Icon /> {t("billing.detail.delete")}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => setDialog("cancel")}>
                    <BanIcon /> {t("billing.detail.cancel")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <FadeIn>
          <InvoiceDocument invoice={inv} shopName={shopName} logoUrl={logoUrl} />
        </FadeIn>

        <div className="grid gap-4 lg:sticky lg:top-20" data-print-hide>
          {!draft && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <span className="icon-chip size-8 text-primary">
                    <WalletIcon className="size-4" />
                  </span>
                  {t("billing.detail.paymentStatus")}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-muted-foreground">{t("billing.totals.paid")}</span>
                  <span className="text-right">
                    <AnimatedNumber value={inv.paid} from={0} format={money} className="font-heading text-xl font-bold tabular-nums" />
                    <span className="text-xs text-muted-foreground tabular-nums"> / {money(inv.total)}</span>
                  </span>
                </div>
                <Progress
                  value={paidPct}
                  className="h-2.5"
                  aria-label={t("billing.detail.paidPct", { pct: paidPct })}
                  aria-valuetext={t("billing.detail.paidPct", { pct: paidPct })}
                />
                <div className="flex items-baseline justify-between text-xs text-muted-foreground tabular-nums">
                  <span>{t("billing.detail.paidPct", { pct: paidPct })}</span>
                  {inv.balance > 0 && !cancelled && (
                    <span>
                      {t("billing.totals.balance")}{" "}
                      <span className={inv.isOverdue ? "text-sm font-semibold text-danger-ink" : "text-sm font-semibold text-foreground"}>
                        {money(inv.balance)}
                      </span>
                    </span>
                  )}
                </div>
                {inv.status === "paid" && (
                  <StatusPill tone="success" icon={CheckCircle2Icon} size="md">
                    {t("billing.detail.fullyPaid")}
                  </StatusPill>
                )}
                {inv.payments.length > 0 && (
                  <ul className="grid gap-1 border-t pt-2">
                    <AnimatePresence initial={false}>
                      {inv.payments.map((p, i) => {
                        const online = isOnlinePayment(p);
                        return (
                          <motion.li
                            key={p.id ?? `${p.date}-${i}`}
                            layout={!reduced}
                            initial={reduced ? false : { opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                            className="flex items-center gap-2 py-1 text-sm"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="flex flex-wrap items-center gap-1.5">
                                <span className="font-semibold tabular-nums">{money(p.amount)}</span>
                                {online && (
                                  <StatusPill tone="brand" icon={GlobeIcon}>
                                    {t("billing.billDetail.online")}
                                  </StatusPill>
                                )}
                              </p>
                              <p className="mt-0.5 truncate text-meta text-muted-foreground">
                                {t(`billing.payment.methods.${p.method}`)} · {formatDate(p.date)}
                                {p.reference ? ` · ${p.reference}` : ""}
                              </p>
                            </div>
                            {p.id && !cancelled && !online && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground hover:text-destructive"
                                aria-label={t("billing.payment.remove")}
                                onClick={() => setUnpay(p.id!)}
                              >
                                <XIcon />
                              </Button>
                            )}
                          </motion.li>
                        );
                      })}
                    </AnimatePresence>
                  </ul>
                )}
                {open && (
                  <Button className="h-11" onClick={() => setDialog("pay")}>
                    <IndianRupeeIcon /> {t("billing.detail.recordPayment")}
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {einvoice && !draft && !!inv.customer.gstin?.trim() && <EInvoiceCard invoice={inv} />}

          {sendable && whatsapp && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <span className="icon-chip size-8 text-success-ink">
                    <MessagesSquareIcon className="size-4" />
                  </span>
                  {t("billing.timeline.title")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <MessagesTimeline messages={inv.messages} />
              </CardContent>
            </Card>
          )}

          {draft && (
            <Card className="gap-2 border-dashed">
              <CardContent className="grid gap-3 text-sm text-muted-foreground">
                <div className="flex items-start gap-3">
                  <span className="icon-chip size-9 text-primary">
                    <PencilIcon className="size-4" />
                  </span>
                  <p>{t("billing.detail.draftHint")}</p>
                </div>
                <Button className="h-11" onClick={() => setDialog("issue")}>
                  <SendIcon /> {t("billing.detail.issue")}
                </Button>
              </CardContent>
            </Card>
          )}
          {cancelled && (
            <Card className="gap-1 ring-destructive/30">
              <CardContent className="flex items-start gap-3 text-sm">
                <span className="icon-chip size-9 text-danger-ink">
                  <BanIcon className="size-4" />
                </span>
                <div>
                  <p className="font-medium text-danger-ink">
                    {t("billing.detail.cancelledOn", { date: inv.cancelledAt ? formatDate(inv.cancelledAt) : "" })}
                  </p>
                  {inv.cancelReason && <p className="text-muted-foreground">{inv.cancelReason}</p>}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <PaymentDialog invoice={inv} open={dialog === "pay"} onOpenChange={setDialogOpen("pay")} />
      <CancelDialog invoice={inv} open={dialog === "cancel"} onOpenChange={setDialogOpen("cancel")} />
      <ShareDialog invoice={inv} shopName={shopName} open={dialog === "share"} onOpenChange={setDialogOpen("share")} />
      <ConfirmDialog
        open={dialog === "issue"}
        onOpenChange={setDialogOpen("issue")}
        destructive={false}
        title={t("billing.detail.issueTitle")}
        description={t("billing.detail.issueBody")}
        confirmLabel={t("billing.detail.issue")}
        onConfirm={async () => {
          try {
            const r = await action.mutateAsync({ kind: "issue", id: inv.id });
            if (invoiceWarnings(r).includes("credit_limit_exceeded")) setCreditWarning(true);
            if (reduced) toast.success(t("billing.form.issued", { number: r.number ?? "" }));
            setCelebrate(true);
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={setDialogOpen("delete")}
        title={t("billing.detail.deleteTitle")}
        description={t("billing.detail.deleteBody")}
        confirmLabel={t("billing.detail.delete")}
        onConfirm={async () => {
          try {
            await del.mutateAsync(inv.id);
            toast.success(t("billing.detail.deleted"));
            navigate("invoices", { replace: true });
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
      <ConfirmDialog
        open={!!unpay}
        onOpenChange={(o) => !o && setUnpay(null)}
        title={t("billing.payment.removeTitle")}
        description={t("billing.payment.removeBody")}
        confirmLabel={t("billing.payment.remove")}
        onConfirm={async () => {
          try {
            await action.mutateAsync({ kind: "unpay", id: inv.id, paymentId: unpay! });
            toast.success(t("billing.payment.removed"));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </>
  );
}
