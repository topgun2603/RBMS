"use client";

import * as React from "react";
import { ConfirmDialog, describeError, ModuleLink, Page, QueryError, useFeature, useI18n, useModuleNavigate, useRouteParams } from "@srirealtime/web";
import {
  BellRingIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  FileDownIcon,
  FileTextIcon,
  Loader2Icon,
  MailIcon,
  MapPinIcon,
  MessageCircleIcon,
  NotebookTabsIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  Share2Icon,
  Trash2Icon,
  UsersRoundIcon,
  WalletIcon,
} from "lucide-react";
import {
  AnimatedNumber,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  InitialsAvatar,
  Meter,
  Skeleton,
  Stagger,
  StaggerItem,
  toast,
} from "@srirealtime/ui";
import { CustomerDialog } from "../components/customer-dialog";
import { DateRangePicker, initialRange, type DateRangeValue } from "../components/date-range-picker";
import { InvoiceRow, InvoiceRowSkeleton } from "../components/invoice-row";
import { BalancePill, balanceInk, useRemind } from "../components/credit-book/credit-book-ui";
import { LedgerSkeleton, LedgerTable, LedgerTimeline, normalizeLedger } from "../components/credit-book/ledger-view";
import { ReceiveDialog } from "../components/credit-book/receive-dialog";
import { ShareStatementDialog } from "../components/credit-book/share-statement-dialog";
import { money, stateLabel, whatsappNumber } from "../lib/format";
import { useCustomer, useDeleteCustomer, useInvoiceList } from "../lib/queries";
import { downloadCsv, REPORT_PATHS, useLedger } from "../lib/queries-v2";
import { PDF_PATHS, usePdf } from "../lib/pdf";
import type { Customer } from "../lib/types";

export default function CustomerDetailPage() {
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const { id } = useRouteParams<{ id: string }>();
  const customer = useCustomer(id);
  const invoices = useInvoiceList({ customerId: id });
  const del = useDeleteCustomer();
  const remind = useRemind();
  // Ledger, receipts, statements and credit limits belong to the credit book; reminders go out on WhatsApp/SMS.
  const creditBook = useFeature("invoices.credit-book");
  const whatsapp = useFeature("invoices.whatsapp");
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [receiving, setReceiving] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);
  const c = customer.data;
  const items = invoices.data?.pages.flatMap((p) => p.items) ?? [];
  const wa = whatsappNumber(c?.phone);

  return (
    <Page>
      <ModuleLink
        to={creditBook ? "credit-book" : "customers"}
        data-print-hide
        className="-ml-1 mb-3 inline-flex items-center gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {creditBook ? <NotebookTabsIcon className="size-3.5" /> : <UsersRoundIcon className="size-3.5" />}{" "}
        {t(creditBook ? "billing.creditBook.title" : "billing.nav.customers")}
      </ModuleLink>

      {customer.isError ? (
        <QueryError error={customer.error} onRetry={() => void customer.refetch()} />
      ) : !c ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-44 rounded-2xl lg:col-span-2" />
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl lg:col-span-3" />
        </div>
      ) : (
        <div className="grid gap-section">
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Header: who, how to reach them, what to do */}
            <Card className="lg:col-span-2">
              <CardContent className="flex items-start gap-4">
                <InitialsAvatar name={c.name} size="lg" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <h1 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">{c.name}</h1>
                  <div className="grid gap-1 text-sm text-muted-foreground">
                    {c.phone && (
                      <a href={`tel:${c.phone}`} className="flex w-fit items-center gap-2 hover:text-foreground">
                        <PhoneIcon className="size-3.5" /> <span className="tabular-nums">{c.phone}</span>
                      </a>
                    )}
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="flex w-fit items-center gap-2 break-all hover:text-foreground">
                        <MailIcon className="size-3.5 shrink-0" /> {c.email}
                      </a>
                    )}
                    {(c.address || c.stateCode) && (
                      <p className="flex items-start gap-2">
                        <MapPinIcon className="mt-0.5 size-3.5 shrink-0" />
                        <span>{[c.address, c.stateCode && stateLabel(c.stateCode)].filter(Boolean).join(", ")}</span>
                      </p>
                    )}
                    {c.gstin && <p className="font-mono text-xs text-foreground">GSTIN {c.gstin}</p>}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-lg" className="size-11 shrink-0" aria-label={t("billing.creditBook.detail.more")}>
                      <EllipsisVerticalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    <DropdownMenuItem onSelect={() => setEditing(true)}>
                      <PencilIcon /> {t("billing.common.edit")}
                    </DropdownMenuItem>
                    {wa && (
                      <DropdownMenuItem asChild>
                        <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">
                          <MessageCircleIcon /> WhatsApp
                        </a>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                      <Trash2Icon /> {t("billing.common.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardContent>
              <CardContent className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" data-print-hide>
                <Button asChild size="lg" className="h-11">
                  <ModuleLink to={`invoices/new?customer=${c.id}`}>
                    <PlusIcon /> {t("billing.customers.newBill")}
                  </ModuleLink>
                </Button>
                {creditBook && (
                  <>
                    <Button variant="outline" size="lg" className="h-11" onClick={() => setReceiving(true)}>
                      <WalletIcon /> {t("billing.creditBook.detail.receivePayment")}
                    </Button>
                    <Button variant="outline" size="lg" className="h-11" onClick={() => setSharing(true)}>
                      <Share2Icon /> {t("billing.creditBook.detail.shareStatement")}
                    </Button>
                  </>
                )}
                {whatsapp && c.outstanding > 0 && (
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-11"
                    disabled={remind.pendingId === c.id}
                    onClick={() => remind.send(c, c.outstanding)}
                  >
                    {remind.pendingId === c.id ? <Loader2Icon className="animate-spin" /> : <BellRingIcon />}
                    {t("billing.creditBook.detail.remind")}
                  </Button>
                )}
              </CardContent>
            </Card>

            <BalanceCard customer={c} onReceive={creditBook ? () => setReceiving(true) : undefined} />
          </div>

          {creditBook && <LedgerCard customer={c} />}

          <Card className="gap-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="icon-chip size-8 text-primary">
                  <FileTextIcon className="size-4" />
                </span>
                {t("billing.customers.invoices")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-1 sm:px-2">
              {invoices.isError ? (
                <QueryError compact error={invoices.error} onRetry={() => void invoices.refetch()} />
              ) : invoices.isPending ? (
                Array.from({ length: 3 }, (_, i) => <InvoiceRowSkeleton key={i} />)
              ) : items.length === 0 ? (
                <EmptyState compact icon={FileTextIcon} title={t("billing.customers.noInvoices")} />
              ) : (
                <>
                  <Stagger className="divide-y">
                    {items.map((inv) => (
                      <StaggerItem key={inv.id}>
                        <InvoiceRow inv={inv} hideCustomer />
                      </StaggerItem>
                    ))}
                  </Stagger>
                  {invoices.hasNextPage && (
                    <div className="flex justify-center p-2">
                      <Button variant="ghost" onClick={() => void invoices.fetchNextPage()} disabled={invoices.isFetchingNextPage}>
                        {t("billing.common.loadMore")}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <CustomerDialog open={editing} onOpenChange={setEditing} customer={c} />
          {creditBook && (
            <>
              <ReceiveDialog customer={c} open={receiving} onOpenChange={setReceiving} />
              <ShareStatementDialog customer={c} open={sharing} onOpenChange={setSharing} />
            </>
          )}
          <ConfirmDialog
            open={deleting}
            onOpenChange={setDeleting}
            title={t("billing.customers.deleteTitle", { name: c.name })}
            description={t("billing.customers.deleteBody")}
            confirmLabel={t("billing.common.delete")}
            onConfirm={async () => {
              try {
                await del.mutateAsync(c.id);
                toast.success(t("billing.customers.deleted"));
                navigate("customers", { replace: true });
              } catch (err) {
                toast.error(describeError(err, t));
                throw err;
              }
            }}
          />
        </div>
      )}
    </Page>
  );
}

/** Balance due vs advance (count-up), plus the credit-limit meter when a limit is set. */
/** Without the credit book (`onReceive` undefined) it shows the unpaid-bills balance only: no credit limit, no receipts. */
function BalanceCard({ customer: c, onReceive }: { customer: Customer; onReceive?: () => void }) {
  const { t } = useI18n();
  const bal = c.outstanding;
  const limit = onReceive && typeof c.creditLimit === "number" && c.creditLimit > 0 ? c.creditLimit : null;
  const used = Math.max(0, bal);
  const label = bal > 0 ? t("billing.creditBook.balance.due") : bal < 0 ? t("billing.creditBook.balance.advance") : t("billing.creditBook.balance.settled");
  const hint =
    bal > 0
      ? t("billing.creditBook.balance.dueHint", { name: c.name })
      : bal < 0
        ? t("billing.creditBook.balance.advanceHint", { name: c.name })
        : t("billing.creditBook.balance.settledHint", { name: c.name });

  return (
    <Card className="relative overflow-hidden">
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-1",
          bal > 0 ? "bg-warning" : bal < 0 ? "bg-success" : "bg-border",
        )}
      />
      <CardContent className="grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <BalancePill balance={bal} />
        </div>
        <p className={cn("font-heading text-3xl font-bold tracking-tight tabular-nums", balanceInk(bal))}>
          <AnimatedNumber value={Math.abs(bal)} from={0} duration={0.9} format={(n) => money(Math.round(n))} aria-hidden />
          <span className="sr-only">{money(Math.abs(bal))}</span>
        </p>
        <p className="text-meta text-muted-foreground">{hint}</p>
        {limit !== null && (
          <div className="grid gap-1.5 rounded-xl border bg-muted/30 p-3">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium">{t("billing.creditBook.credit.label")}</span>
              <span className="text-muted-foreground tabular-nums">
                {t("billing.creditBook.credit.used", { used: money(used), limit: money(limit) })}
              </span>
            </div>
            <Meter
              value={used}
              max={limit}
              label={t("billing.creditBook.credit.label")}
              valueText={t("billing.creditBook.credit.used", { used: money(used), limit: money(limit) })}
            />
            <p className={cn("text-xs tabular-nums", used > limit ? "font-medium text-danger-ink" : used / limit > 0.8 ? "text-warning-ink" : "text-muted-foreground")}>
              {used > limit
                ? t("billing.creditBook.credit.over", { amount: money(used - limit) })
                : t("billing.creditBook.credit.available", { amount: money(limit - used) })}
            </p>
          </div>
        )}
        {bal > 0 && onReceive && (
          <Button size="lg" className="h-11 w-full" onClick={onReceive} data-print-hide>
            <WalletIcon /> {t("billing.creditBook.detail.receivePayment")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** Ledger for a date range (default: this FY) — table on desktop, timeline on phones, CSV download. */
function LedgerCard({ customer: c }: { customer: Customer }) {
  const { t, formatDate } = useI18n();
  const [range, setRange] = React.useState<DateRangeValue>(() => initialRange("thisFY"));
  const ledger = useLedger(c.id, range.from, range.to);
  const [downloading, setDownloading] = React.useState(false);
  const documents = useFeature("documents");
  const pdf = usePdf();
  const data = normalizeLedger(ledger.data);
  const aria = t("billing.creditBook.ledger.aria", { name: c.name });

  const download = async () => {
    setDownloading(true);
    try {
      await downloadCsv(REPORT_PATHS.ledger(c.id), { from: range.from, to: range.to }, t("billing.creditBook.ledger.csvName"));
      toast.success(t("billing.common.downloaded"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="icon-chip size-8 text-primary">
              <NotebookTabsIcon className="size-4" />
            </span>
            {t("billing.creditBook.ledger.title")}
          </CardTitle>
          <div className="flex items-center gap-2" data-print-hide>
            {documents && (
              <Button
                variant="outline"
                size="lg"
                className="h-10"
                disabled={!!pdf.busy}
                aria-busy={!!pdf.busy}
                onClick={() =>
                  void pdf.run("statement", PDF_PATHS.statement(c.id), {
                    mode: "download",
                    query: { from: range.from, to: range.to },
                    fallbackName: `${t("billing.pdf.statementName")}-${range.to}.pdf`,
                  })
                }
              >
                {pdf.busy ? <Loader2Icon className="animate-spin" /> : <FileDownIcon />}
                <span className="hidden sm:inline">{t("billing.pdf.statement")}</span>
                <span className="sm:hidden">PDF</span>
              </Button>
            )}
            <Button variant="outline" size="lg" className="h-10" onClick={() => void download()} disabled={downloading}>
              {downloading ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
              <span className="hidden sm:inline">{downloading ? t("billing.common.downloading") : t("billing.common.download")}</span>
              <span className="sm:hidden">CSV</span>
            </Button>
          </div>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
      </CardHeader>
      <CardContent className={cn("px-2 transition-opacity sm:px-3", ledger.isPlaceholderData && "opacity-60")}>
        {ledger.isError ? (
          <QueryError compact error={ledger.error} onRetry={() => void ledger.refetch()} />
        ) : ledger.isPending ? (
          <div className="px-2">
            <LedgerSkeleton />
          </div>
        ) : data.entries.length === 0 ? (
          <EmptyState
            compact
            icon={NotebookTabsIcon}
            title={t("billing.creditBook.ledger.empty")}
            description={
              data.openingBalance ? (
                <>
                  {t("billing.creditBook.ledger.broughtForward", { date: formatDate(range.from) })}:{" "}
                  <span className={cn("font-semibold tabular-nums", balanceInk(data.openingBalance))}>{money(Math.abs(data.openingBalance))}</span>
                </>
              ) : (
                t("billing.creditBook.ledger.emptyBody")
              )
            }
          />
        ) : (
          <>
            <LedgerTable data={data} from={range.from} ariaLabel={aria} className="hidden sm:block" />
            <LedgerTimeline key={`${range.from}-${range.to}`} data={data} from={range.from} ariaLabel={aria} className="px-1 sm:hidden" />
          </>
        )}
      </CardContent>
    </Card>
  );
}
