"use client";

import { absoluteUrl, api, ApiError, BrandingStyle, BrandMark, fontsInCss, LocaleSwitcher, QueryError, ThemeToggle, useDocumentBranding, useI18n, useRouteParams, useWebFonts } from "@srirealtime/web";
import { useQuery } from "@tanstack/react-query";
import { CalendarClockIcon, FileXIcon, NotebookTabsIcon, PrinterIcon, SmartphoneIcon } from "lucide-react";
import { upiLink } from "@srirealtime/gst";
import { AnimatedNumber, Button, Card, cn, EmptyState, FadeIn, Skeleton } from "@srirealtime/ui";
import { BalancePill, balanceInk } from "../components/credit-book/credit-book-ui";
import { LedgerSkeleton, LedgerTable, LedgerTimeline, normalizeLedger } from "../components/credit-book/ledger-view";
import { QrImage } from "../components/upi-qr";
import { addDays, money, todayIST } from "../lib/format";
import type { PublicStatementResponse } from "../lib/types";

/** Public customer statement (credit book) link: no sign-in, branded from the response, print-friendly. */
export default function PublicStatementPage() {
  const { t, formatDate } = useI18n();
  const { token } = useRouteParams<{ token: string }>();
  const q = useQuery({
    queryKey: ["public-statement", token],
    // No tenant header and no token: the share token identifies the shop.
    queryFn: () =>
      api<PublicStatementResponse>(`/invoices/public/statement/${encodeURIComponent(token)}`, { tenant: null, anonymous: true }),
    enabled: !!token,
    retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
  });

  const data = q.data;
  const shopName = data?.branding?.appName || data?.seller?.legalName || "";
  const logoUrl = absoluteUrl(data?.branding?.logoUrl);
  useDocumentBranding({ title: shopName ? `${shopName} · ${t("billing.creditBook.public.title")}` : null, icon: logoUrl, suffix: "" });
  useWebFonts(fontsInCss(data?.branding?.css));

  if (q.isError) {
    const notFound = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400);
    return (
      <div className="flex min-h-dvh items-center justify-center bg-page p-4">
        <div className="w-full max-w-md">
          {notFound ? (
            <EmptyState
              icon={FileXIcon}
              title={t("billing.creditBook.public.notFoundTitle")}
              description={t("billing.creditBook.public.notFound")}
            />
          ) : (
            <QueryError error={q.error} onRetry={() => void q.refetch()} />
          )}
        </div>
      </div>
    );
  }

  const ledger = normalizeLedger(data?.ledger);
  const balance = typeof data?.balance === "number" ? data.balance : (ledger.closingBalance ?? 0);
  const today = todayIST();
  // The statement covers the last 90 days; the brought-forward row only shows when the API sends openingBalance.
  const from = ledger.openingBalance !== null ? addDays(today, -90) : undefined;
  const upiId = data?.seller?.upiId;
  const upi =
    balance > 0 && upiId
      ? upiLink({ vpa: upiId, name: data?.seller?.legalName || shopName, amountPaise: balance, note: t("billing.creditBook.public.title") })
      : null;
  const customerName = data?.customer?.name ?? "";
  const aria = t("billing.creditBook.ledger.aria", { name: customerName });

  return (
    <div className="min-h-dvh bg-page print:bg-white">
      {data?.branding?.css ? <BrandingStyle css={data.branding.css} /> : null}
      <header data-print-hide className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-2 px-4">
          {data ? <BrandMark name={shopName} logoUrl={logoUrl} /> : <Skeleton className="h-8 w-40" />}
          <div className="ml-auto flex items-center gap-1">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-4xl gap-4 px-3 py-4 sm:px-4 sm:py-6" data-print-root>
        {!data ? (
          <>
            <Skeleton className="h-56 rounded-2xl" />
            <Card className="px-card">
              <LedgerSkeleton rows={6} />
            </Card>
          </>
        ) : (
          <>
            <FadeIn className="overflow-hidden rounded-2xl border border-card-ring bg-card shadow-elevated print:border-border print:shadow-none">
              {/* Branded band (plain in print) */}
              <div className="hero-band relative p-5 print:bg-none print:bg-transparent print:p-0 print:pb-3 print:text-foreground">
                <div aria-hidden className="hero-dots pointer-events-none absolute inset-0 print:hidden" />
                <div className="relative flex items-center gap-3">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- tenant-hosted logos are arbitrary URLs
                    <img src={logoUrl} alt="" className="size-12 shrink-0 rounded-xl bg-white/90 object-contain p-1 print:bg-transparent" />
                  ) : (
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 print:hidden">
                      <NotebookTabsIcon className="size-6" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-heading text-lg font-bold tracking-tight">{shopName}</p>
                    <p className="text-xs opacity-85">{t("billing.creditBook.public.title")}</p>
                  </div>
                </div>
                <p className="relative mt-4 text-sm opacity-90">{t("billing.creditBook.public.greeting", { name: customerName, shop: shopName })}</p>
              </div>

              <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center print:px-0">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {balance > 0
                        ? t("billing.creditBook.public.balanceDue")
                        : balance < 0
                          ? t("billing.creditBook.public.advance")
                          : t("billing.creditBook.public.settled")}
                    </p>
                    <BalancePill balance={balance} />
                  </div>
                  <p className={cn("font-heading text-4xl font-bold tracking-tight tabular-nums", balanceInk(balance))}>
                    <AnimatedNumber value={Math.abs(balance)} from={0} duration={0.9} format={(n) => money(Math.round(n))} aria-hidden />
                    <span className="sr-only">{money(Math.abs(balance))}</span>
                  </p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarClockIcon className="size-3.5" /> {t("billing.creditBook.public.asOf", { date: formatDate(today) })}
                  </p>
                </div>
                {upi && (
                  <QrImage
                    value={upi}
                    size={128}
                    alt={t("billing.doc.upiQrAlt", { amount: money(balance) })}
                    className="hidden border sm:block print:hidden"
                  />
                )}
              </div>
              <div data-print-hide className="grid gap-2 border-t bg-muted/30 p-3 sm:flex sm:justify-end">
                {upi && (
                  <Button asChild size="lg" className="h-12 text-base sm:h-10">
                    <a href={upi}>
                      <SmartphoneIcon /> {t("billing.public.payUpi", { amount: money(balance) })}
                    </a>
                  </Button>
                )}
                <Button variant="outline" size="lg" className="h-12 sm:h-10" onClick={() => window.print()}>
                  <PrinterIcon /> {t("billing.creditBook.public.print")}
                </Button>
              </div>
            </FadeIn>

            <FadeIn delay={0.05}>
              <Card className="print:border-0 print:py-0">
                <div className="flex items-center gap-2 px-4 sm:px-5 print:px-0">
                  <span className="icon-chip size-8 text-primary print:hidden">
                    <NotebookTabsIcon className="size-4" />
                  </span>
                  <h2 className="font-heading text-base font-semibold">{t("billing.creditBook.public.recent")}</h2>
                </div>
                <div className="px-2 sm:px-3 print:px-0">
                  {ledger.entries.length === 0 ? (
                    <EmptyState compact icon={NotebookTabsIcon} title={t("billing.creditBook.public.empty")} />
                  ) : (
                    <>
                      <LedgerTable data={ledger} from={from} linkInvoices={false} ariaLabel={aria} className="hidden sm:block print:block" />
                      <LedgerTimeline
                        data={ledger}
                        from={from}
                        linkInvoices={false}
                        ariaLabel={aria}
                        className="px-1 sm:hidden print:hidden"
                      />
                    </>
                  )}
                </div>
              </Card>
            </FadeIn>
            <p data-print-hide className="pb-6 text-center text-xs text-muted-foreground">
              {t("billing.creditBook.public.footer", { shop: shopName })}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
