"use client";

import * as React from "react";
import {
  ModuleLink,
  Page,
  QueryError,
  useAppNavigate,
  useFeature,
  useI18n,
  useModuleNavigate,
  usePermission,
  useQueryParams,
  useRouteParams,
  useShop,
} from "@srirealtime/web";
import {
  ArrowLeftIcon,
  BanIcon,
  CheckCircle2Icon,
  CopyPlusIcon,
  EyeIcon,
  FileDownIcon,
  FilePenLineIcon,
  FileTextIcon,
  HistoryIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PackageIcon,
  PencilIcon,
  PrinterIcon,
  ReceiptIcon,
  RefreshCwIcon,
  SendIcon,
  XCircleIcon,
} from "lucide-react";
import {
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
  Skeleton,
  StatusPill,
  toast,
} from "@srirealtime/ui";
import { InvoiceDocument } from "../components/invoice-document";
import { CancelQuotationDialog, ConvertQuotationDialog, SendQuotationDialog, useOrderHref } from "../components/quotations/quotation-dialogs";
import { QuotationStatusPill, useDateTime, useValidityText } from "../components/quotations/quotation-ui";
import { money } from "../lib/format";
import { PDF_PATHS, usePdf } from "../lib/pdf";
import { useDuplicateQuotation, useQuotation } from "../lib/queries-quotations";
import { quotationAsInvoice, quotationDocMeta, type Quotation, type QuotationEvent } from "../lib/types-quotations";

export default function QuotationDetailPage() {
  return (
    <React.Suspense fallback={null}>
      <Detail />
    </React.Suspense>
  );
}

function Detail() {
  const { t } = useI18n();
  const { id } = useRouteParams<{ id: string }>();
  const q = useQuotation(id);
  return (
    <Page>
      <div className="mb-3 flex items-center gap-2" data-print-hide>
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <ModuleLink to="quotations">
            <ArrowLeftIcon /> {t("billing.nav.quotations")}
          </ModuleLink>
        </Button>
      </div>
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <div data-print-hide className="grid grid-cols-[minmax(0,1fr)] gap-section lg:grid-cols-[minmax(0,1fr)_21rem]">
          <Skeleton className="h-[70vh] rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : (
        <View quotation={q.data} />
      )}
    </Page>
  );
}

type DialogKind = null | "send" | "convert" | "cancel";

function View({ quotation: q }: { quotation: Quotation }) {
  const { t, formatDate } = useI18n();
  const formatDateTime = useDateTime();
  const navigate = useModuleNavigate();
  const appNavigate = useAppNavigate();
  const params = useQueryParams();
  const { shopName, logoUrl } = useShop();
  const documents = useFeature("documents");
  const ordersOn = useFeature("orders");
  const orderHref = useOrderHref();
  const canManage = usePermission("quotations.manage");
  const pdf = usePdf();
  const duplicate = useDuplicateQuotation();
  const validity = useValidityText();
  const [dialog, setDialog] = React.useState<DialogKind>(null);
  const [convertTo, setConvertTo] = React.useState<"invoice" | "order">("invoice");
  const pdfName = `${q.number.replace(/[/\\]/g, "-")}${q.rev > 1 ? `-rev${q.rev}` : ""}.pdf`;

  // ?send=1 (arriving from the form's "Save & send") opens the send dialog once.
  React.useEffect(() => {
    if (params.get("send") === "1" && q.canSend && canManage) {
      setDialog("send");
      navigate("?", { replace: true, scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on arrival
  }, []);

  const doc = React.useMemo(() => quotationAsInvoice(q), [q]);
  const meta = React.useMemo(() => quotationDocMeta(q), [q]);
  const accepted = q.status === "accepted";
  const draft = q.status === "draft";
  const live = q.latest && q.status !== "cancelled" && q.status !== "converted";
  const left = validity(q.daysLeft);
  const ordersAvailable = ordersOn && !!orderHref;

  const open = (kind: DialogKind, to?: "invoice" | "order") => {
    if (to) setConvertTo(to);
    setDialog(kind);
  };
  const print = () => {
    const prev = document.title;
    document.title = `${shopName} ${q.number}`.replace(/[/\\]/g, "-");
    window.print();
    window.setTimeout(() => (document.title = prev), 500);
  };

  const onConverted = (r: { invoice?: { id: string }; order?: { id: string } }) => {
    if (r.invoice) navigate(`invoices/${r.invoice.id}`);
    else if (r.order && orderHref) appNavigate(orderHref(r.order.id));
  };

  return (
    <>
      <div className="mb-section flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between" data-print-hide>
        <div className="flex min-w-0 items-center gap-3">
          <InitialsAvatar name={q.customer.name} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-semibold tracking-tight tabular-nums">{q.number}</h1>
              {q.rev > 1 && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{t("billing.q.rev", { rev: q.rev })}</span>}
              <QuotationStatusPill status={q.displayStatus} size="md" />
              {!q.latest && <StatusPill tone="neutral" size="md">{t("billing.q.superseded")}</StatusPill>}
            </div>
            <p className="truncate text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{q.customer.name}</span> · {formatDate(q.date)} · {t("billing.q.validUntilShort", { date: formatDate(q.validUntil) })}
            </p>
          </div>
          <p className="ml-auto pl-2 text-right font-heading text-xl font-bold whitespace-nowrap tabular-nums sm:text-2xl 2xl:hidden">{money(q.total)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-2 hidden text-right font-heading text-2xl font-bold tabular-nums 2xl:block">{money(q.total)}</p>
          {!q.latest && (
            <Button asChild size="lg" className="h-11">
              <ModuleLink to={`quotations/${q.revisions.find((r) => r.latest)?.id ?? q.id}`}>
                <RefreshCwIcon /> {t("billing.q.openLatest")}
              </ModuleLink>
            </Button>
          )}
          {canManage && q.canConvert && (
            <Button size="lg" variant={accepted ? "default" : "outline"} className="h-11" onClick={() => open("convert", "invoice")}>
              <ReceiptIcon /> {t("billing.q.makeBill")}
            </Button>
          )}
          {canManage && q.canConvert && ordersAvailable && (
            <Button size="lg" variant="outline" className="h-11" onClick={() => open("convert", "order")}>
              <PackageIcon /> {t("billing.q.makeOrder")}
            </Button>
          )}
          {canManage && q.canSend && (
            <Button size="lg" variant={draft || (!accepted && q.canConvert === false) ? "default" : "outline"} className="h-11" onClick={() => open("send")}>
              <SendIcon /> {draft ? t("billing.q.send.action") : t("billing.q.send.again")}
            </Button>
          )}
          {canManage && q.canEdit && (
            <Button asChild variant="outline" size="lg" className="h-11">
              <ModuleLink to={`quotations/${q.id}/edit`}>
                <PencilIcon /> {t("billing.detail.edit")}
              </ModuleLink>
            </Button>
          )}
          {canManage && q.canRevise && (
            <Button asChild variant="outline" size="lg" className="h-11">
              <ModuleLink to={`quotations/${q.id}/edit`}>
                <FilePenLineIcon /> {t("billing.q.revise")}
              </ModuleLink>
            </Button>
          )}
          {documents && (
            <>
              <Button variant="outline" size="lg" className="h-11" disabled={!!pdf.busy} aria-busy={pdf.busy === "a4"} onClick={() => void pdf.run("a4", PDF_PATHS.quotation(q.id), { mode: "download", fallbackName: pdfName })}>
                {pdf.busy === "a4" ? <Loader2Icon className="animate-spin" /> : <FileDownIcon />}
                <span className="hidden sm:inline">{t("billing.pdf.download")}</span>
                <span className="sr-only sm:hidden">{t("billing.pdf.download")}</span>
              </Button>
              <Button variant="outline" size="lg" className="h-11" disabled={!!pdf.busy} aria-busy={pdf.busy === "thermal"} onClick={() => void pdf.run("thermal", PDF_PATHS.quotationThermal(q.id), { mode: "open", fallbackName: pdfName })}>
                {pdf.busy === "thermal" ? <Loader2Icon className="animate-spin" /> : <ReceiptIcon />}
                <span className="hidden sm:inline">{t("billing.pdf.receipt")}</span>
                <span className="sr-only sm:hidden">{t("billing.pdf.receipt")}</span>
              </Button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-lg" className="size-11" aria-label={t("billing.detail.more")}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem className="h-10" onSelect={print}>
                <PrinterIcon /> {t("billing.detail.print")}
              </DropdownMenuItem>
              {canManage && (
                <DropdownMenuItem
                  className="h-10"
                  disabled={duplicate.isPending}
                  onSelect={async () => {
                    try {
                      const copy = await duplicate.mutateAsync(q.id);
                      toast.success(t("billing.q.duplicated", { number: copy.number }));
                      navigate(`quotations/${copy.id}`);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : String(err));
                    }
                  }}
                >
                  <CopyPlusIcon /> {t("billing.q.duplicate")}
                </DropdownMenuItem>
              )}
              {canManage && q.canCancel && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => open("cancel")}>
                    <BanIcon /> {t("billing.q.cancelAction")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-section lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <FadeIn className="min-w-0">
          <InvoiceDocument invoice={doc} quotation={meta} shopName={shopName} logoUrl={logoUrl} />
        </FadeIn>

        <div className="grid min-w-0 gap-4 lg:sticky lg:top-20" data-print-hide>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <span className="icon-chip size-8 text-primary">
                  <FileTextIcon className="size-4" />
                </span>
                {t("billing.q.statusCard")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <dl className="grid gap-2">
                <Row label={t("billing.q.doc.validUntil")}>
                  <span className="tabular-nums">{formatDate(q.validUntil)}</span>
                  {left && live && (q.status === "sent" || draft) && <span className={q.displayStatus === "expired" ? "block text-meta text-warning-ink" : "block text-meta text-muted-foreground"}>{left}</span>}
                </Row>
                {q.advanceAmount > 0 && (
                  <Row label={t("billing.q.advance")}>
                    <span className="tabular-nums">
                      {money(q.advanceAmount)} ({q.advancePercent}%)
                    </span>
                  </Row>
                )}
                {q.deliveryText && <Row label={t("billing.q.doc.delivery")}>{q.deliveryText}</Row>}
                {q.sentAt && <Row label={t("billing.q.sentOn")}>{formatDate(q.sentAt)}</Row>}
              </dl>

              {q.respondedAt && q.respondedBy && (q.status === "accepted" || q.status === "declined" || q.status === "converted") && (
                <div className="rounded-lg border bg-muted/40 p-3">
                  <p className="flex items-center gap-1.5 font-medium">
                    {q.status === "declined" ? <XCircleIcon className="size-4 text-danger-ink" /> : <CheckCircle2Icon className="size-4 text-success-ink" />}
                    {t(q.status === "declined" ? "billing.q.declinedBy" : "billing.q.acceptedByName", { name: q.respondedBy })}
                  </p>
                  <p className="text-meta text-muted-foreground">{formatDateTime(q.respondedAt)}</p>
                  {q.responseNote && <p className="mt-1 whitespace-pre-line">&ldquo;{q.responseNote}&rdquo;</p>}
                </div>
              )}

              {q.converted && (
                <div className="rounded-lg border bg-primary/5 p-3">
                  <p className="font-medium">{t(q.converted.kind === "invoice" ? "billing.q.billedAs" : "billing.q.orderedAs")}</p>
                  {q.converted.kind === "invoice" ? (
                    <Button asChild variant="link" className="h-auto p-0">
                      <ModuleLink to={`invoices/${q.converted.id}`}>{q.converted.number ?? t("billing.status.draft")}</ModuleLink>
                    </Button>
                  ) : orderHref ? (
                    <Button asChild variant="link" className="h-auto p-0">
                      <ModuleLink href={orderHref(q.converted.id)}>{q.converted.number}</ModuleLink>
                    </Button>
                  ) : (
                    <span className="tabular-nums">{q.converted.number}</span>
                  )}
                  {q.converted.missing && <p className="text-meta text-warning-ink">{t("billing.q.targetGone")}</p>}
                </div>
              )}

              {q.status === "cancelled" && (
                <div className="rounded-lg border bg-muted/40 p-3">
                  <p className="font-medium">{t("billing.q.cancelledOn", { date: q.cancelledAt ? formatDate(q.cancelledAt) : "" })}</p>
                  {q.cancelReason && <p className="text-muted-foreground">{q.cancelReason}</p>}
                </div>
              )}
            </CardContent>
          </Card>

          <Timeline events={q.events} />

          {q.revisions.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <span className="icon-chip size-8 text-primary">
                    <HistoryIcon className="size-4" />
                  </span>
                  {t("billing.q.revisions")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-1.5 text-sm">
                  {[...q.revisions].reverse().map((r) => (
                    <li key={r.id}>
                      <ModuleLink
                        to={`quotations/${r.id}`}
                        aria-current={r.id === q.id ? "page" : undefined}
                        className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-accent aria-[current=page]:bg-primary/5"
                      >
                        <span className="min-w-0">
                          <span className="font-medium">{t("billing.q.rev", { rev: r.rev })}</span>
                          {r.latest && <span className="ml-1.5 text-meta text-success-ink">{t("billing.q.latest")}</span>}
                          <span className="block text-meta text-muted-foreground">{formatDate(r.date)}</span>
                        </span>
                        <span className="text-right">
                          <span className="block font-semibold tabular-nums">{money(r.total)}</span>
                          <QuotationStatusPill status={r.displayStatus} size="sm" />
                        </span>
                      </ModuleLink>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <SendQuotationDialog quotation={q} shopName={shopName} open={dialog === "send"} onOpenChange={(o) => setDialog(o ? "send" : null)} />
      <ConvertQuotationDialog quotation={q} initialTo={convertTo} open={dialog === "convert"} onOpenChange={(o) => setDialog(o ? "convert" : null)} onDone={onConverted} />
      <CancelQuotationDialog quotation={q} open={dialog === "cancel"} onOpenChange={(o) => setDialog(o ? "cancel" : null)} />
    </>
  );
}

const EVENT_ICON: Record<QuotationEvent["type"], React.ComponentType<{ className?: string }>> = {
  created: FilePenLineIcon,
  revised: RefreshCwIcon,
  sent: SendIcon,
  viewed: EyeIcon,
  accepted: CheckCircle2Icon,
  declined: XCircleIcon,
  converted: ReceiptIcon,
  cancelled: BanIcon,
};

function Timeline({ events }: { events: Quotation["events"] }) {
  const { t } = useI18n();
  const formatDateTime = useDateTime();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="icon-chip size-8 text-primary">
            <HistoryIcon className="size-4" />
          </span>
          {t("billing.q.timeline")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3">
          {[...events].reverse().map((e, i) => {
            const Icon = EVENT_ICON[e.type];
            const bad = e.type === "declined" || e.type === "cancelled";
            return (
              <li key={`${e.at}-${i}`} className="flex gap-2.5 text-sm">
                <span className={bad ? "mt-0.5 text-danger-ink" : e.type === "accepted" ? "mt-0.5 text-success-ink" : "mt-0.5 text-muted-foreground"}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="font-medium">
                    {t(`billing.q.event.${e.type}`)}
                    {e.rev > 1 && <span className="ml-1.5 text-meta font-normal text-muted-foreground">{t("billing.q.rev", { rev: e.rev })}</span>}
                  </p>
                  <p className="text-meta text-muted-foreground">
                    {formatDateTime(e.at)}
                    {(e.type === "accepted" || e.type === "declined") && e.by ? ` · ${e.by}` : ""}
                  </p>
                  {e.note && e.type !== "created" && (
                    <p className="text-meta break-words text-muted-foreground">
                      {e.type === "sent" ? (e.note === "link" ? t("billing.q.event.viaLink") : e.note) : e.type === "revised" ? e.note : `“${e.note}”`}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
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
