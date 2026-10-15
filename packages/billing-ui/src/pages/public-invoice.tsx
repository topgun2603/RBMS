"use client";

import * as React from "react";
import { absoluteUrl, api, ApiError, BrandingStyle, BrandMark, fontsInCss, LocaleSwitcher, QueryError, ThemeToggle, useDocumentBranding, useFeature, useI18n, useRouteParams, useWebFonts } from "@srirealtime/web";
import { useQuery } from "@tanstack/react-query";
import { BanIcon, CheckCircle2Icon, CreditCardIcon, FileXIcon, Loader2Icon, PrinterIcon, ShieldCheckIcon, SmartphoneIcon } from "lucide-react";
import { upiLink } from "@srirealtime/gst";
import { AnimatedNumber, AnimatePresence, Button, EmptyState, FadeIn, motion, Skeleton, SuccessCheck, useReducedMotionSafe } from "@srirealtime/ui";
import { InvoiceDocument } from "../components/invoice-document";
import { MockPaymentSheet, useOnlineCheckout } from "../components/payments/online-checkout";
import { QrImage } from "../components/upi-qr";
import { money } from "../lib/format";
import type { PublicInvoiceResponse } from "../lib/types";

/** Public invoice link sent to the shop's customer: no sign-in, branded from the response. */
export default function PublicInvoicePage() {
  const { t, formatDate } = useI18n();
  const reduced = useReducedMotionSafe();
  const { token } = useRouteParams<{ token: string }>();
  const paymentsOn = useFeature("payments");
  const q = useQuery({
    queryKey: ["public-invoice", token],
    // No tenant header and no token: the share token identifies the shop.
    queryFn: () => api<PublicInvoiceResponse>(`/invoices/public/${encodeURIComponent(token)}`, { tenant: null, anonymous: true }),
    enabled: !!token,
  });

  const data = q.data;
  const inv = data?.invoice;
  const shopName = data?.branding.appName || inv?.seller.legalName || "";
  const logoUrl = absoluteUrl(data?.branding.logoUrl);
  useDocumentBranding({ title: inv ? `${shopName} · ${inv.number ?? ""}` : shopName || null, icon: logoUrl, suffix: "" });
  useWebFonts(fontsInCss(data?.branding.css));

  // Amount of an online payment made in this visit: drives the celebration panel.
  const [justPaid, setJustPaid] = React.useState<number | null>(null);
  const refetch = React.useCallback(() => void q.refetch(), [q]);
  const checkout = useOnlineCheckout({
    token,
    logoUrl,
    onPaid: (amount) => {
      setJustPaid(amount);
      refetch();
      // The webhook/verify may land a moment later; refresh again shortly.
      window.setTimeout(refetch, 2500);
    },
    onStale: refetch,
  });

  if (q.isError) {
    const notFound = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400);
    return (
      <div className="flex min-h-dvh items-center justify-center bg-page p-4">
        <div className="w-full max-w-md">
          {notFound ? (
            <EmptyState icon={FileXIcon} title={t("billing.public.notFoundTitle")} description={t("billing.public.notFound")} />
          ) : (
            <QueryError error={q.error} onRetry={() => void q.refetch()} />
          )}
        </div>
      </div>
    );
  }

  const payable = !!inv && inv.balance > 0 && inv.status !== "draft" && inv.status !== "cancelled";
  // Online pay needs the shop's payments feature (the API refuses checkout without it) and a configured account.
  const online = payable && paymentsOn && !!data?.onlinePayment?.enabled;
  const upi =
    payable && inv.seller.upiId
      ? upiLink({ vpa: inv.seller.upiId, name: inv.seller.legalName || shopName, amountPaise: inv.balance, note: inv.number ?? undefined })
      : null;
  const celebrate = justPaid !== null;

  return (
    <div className="min-h-dvh bg-page print:bg-white">
      {data?.branding.css ? <BrandingStyle css={data.branding.css} /> : null}
      <header data-print-hide className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-2 px-4">
          {inv ? <BrandMark name={shopName} logoUrl={logoUrl} /> : <Skeleton className="h-8 w-40" />}
          <div className="ml-auto flex items-center gap-1">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-4xl gap-4 px-3 py-4 sm:px-4 sm:py-6" data-print-root>
        {!inv ? (
          <>
            <div data-print-hide className="overflow-hidden rounded-2xl bg-card shadow-elevated ring-1 ring-card-ring">
              <Skeleton className="h-36 rounded-none" />
              <div className="grid gap-2 p-4">
                <Skeleton className="h-12 rounded-lg" />
                <Skeleton className="h-11 rounded-lg" />
              </div>
            </div>
            <Skeleton className="h-[60vh] rounded-2xl" />
          </>
        ) : (
          <>
            <FadeIn data-print-hide className="overflow-hidden rounded-2xl bg-card shadow-elevated ring-1 ring-card-ring">
              {/* Hero band: who it's from and what's due */}
              <div className="hero-band relative overflow-hidden px-5 pt-5 pb-6 sm:px-6">
                <div className="hero-dots pointer-events-none absolute inset-0" aria-hidden />
                <div className="relative flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm opacity-90">{t("billing.public.greeting", { name: inv.customer.name || "", shop: shopName })}</p>
                    {payable && !celebrate ? (
                      <>
                        <p className="mt-3 text-xs font-medium tracking-wide uppercase opacity-80">{t("billing.public.amountDue")}</p>
                        <p className="font-heading text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">
                          <AnimatedNumber value={inv.balance} from={0} duration={0.8} format={money} />
                        </p>
                        <p className="mt-1 text-sm tabular-nums opacity-85">
                          {inv.number}
                          {inv.dueDate ? ` · ${t("billing.invoices.due", { date: formatDate(inv.dueDate) })}` : ""}
                        </p>
                      </>
                    ) : inv.status === "paid" || celebrate ? (
                      <p className="mt-3 flex items-center gap-2 font-heading text-2xl font-bold">
                        <CheckCircle2Icon className="size-6" /> {t("billing.public.paid")}
                      </p>
                    ) : inv.status === "cancelled" ? (
                      <p className="mt-3 flex items-center gap-2 font-heading text-2xl font-bold">
                        <BanIcon className="size-6" /> {t("billing.public.cancelled")}
                      </p>
                    ) : null}
                  </div>
                  {upi && !celebrate && (
                    <div className="hidden shrink-0 rounded-xl bg-white p-2 shadow-raised sm:block">
                      <QrImage value={upi} size={112} alt={t("billing.doc.upiQrAlt", { amount: money(inv.balance) })} />
                    </div>
                  )}
                </div>
              </div>

              <AnimatePresence mode="wait" initial={false}>
                {celebrate ? (
                  <motion.div
                    key="paid"
                    initial={reduced ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col items-center gap-2 px-5 py-6 text-center"
                    role="status"
                    aria-live="polite"
                  >
                    <SuccessCheck size={72} />
                    <p className="mt-1 font-heading text-xl font-semibold">{t("billing.checkout.received")}</p>
                    <p className="font-heading text-3xl font-bold text-success-ink tabular-nums">
                      <AnimatedNumber value={justPaid ?? 0} from={0} format={money} />
                    </p>
                    <p className="max-w-xs text-sm text-muted-foreground">{t("billing.checkout.receivedBody", { shop: shopName })}</p>
                    <Button variant="outline" size="lg" className="mt-2 h-11" onClick={() => window.print()}>
                      <PrinterIcon /> {t("billing.public.download")}
                    </Button>
                  </motion.div>
                ) : (
                  <motion.div key="actions" exit={reduced ? undefined : { opacity: 0 }} className="grid gap-3 p-4 sm:p-5">
                    {online && (
                      <div className="grid gap-1.5">
                        <Button size="lg" className="h-12 w-full text-base" disabled={checkout.busy} onClick={() => void checkout.start()}>
                          {checkout.busy ? <Loader2Icon className="animate-spin" /> : <CreditCardIcon />}
                          {checkout.phase === "verifying"
                            ? t("billing.checkout.verifying")
                            : t("billing.checkout.payOnline", { amount: money(inv.balance) })}
                        </Button>
                        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                          <ShieldCheckIcon className="size-3.5 text-success-ink" />
                          {data?.onlinePayment?.provider === "mock" ? t("billing.checkout.testModeHint") : t("billing.checkout.secureHint")}
                        </p>
                      </div>
                    )}
                    <div className={online ? "grid gap-2 sm:grid-cols-2" : "grid gap-2 sm:flex sm:justify-end"}>
                      {upi && (
                        <Button asChild size="lg" variant={online ? "outline" : "default"} className="h-12 text-base sm:h-11">
                          <a href={upi}>
                            <SmartphoneIcon /> {online ? t("billing.checkout.payAnyUpi") : t("billing.public.payUpi", { amount: money(inv.balance) })}
                          </a>
                        </Button>
                      )}
                      <Button variant="outline" size="lg" className={upi || !online ? "h-12 sm:h-11" : "h-12 sm:col-span-2 sm:h-11"} onClick={() => window.print()}>
                        <PrinterIcon /> {t("billing.public.download")}
                      </Button>
                    </div>
                    {upi && (
                      <div className="flex flex-col items-center gap-2 border-t pt-4 sm:hidden">
                        <QrImage value={upi} size={176} alt={t("billing.doc.upiQrAlt", { amount: money(inv.balance) })} className="rounded-lg border bg-white p-1" />
                        <p className="text-center text-xs text-muted-foreground">{t("billing.public.scanHint")}</p>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </FadeIn>
            <FadeIn delay={0.05}>
              <InvoiceDocument invoice={inv} shopName={shopName} logoUrl={logoUrl} />
            </FadeIn>
            <p data-print-hide className="pb-6 text-center text-xs text-muted-foreground">
              {t("billing.public.footer", { shop: shopName })}
            </p>
          </>
        )}
      </main>
      <MockPaymentSheet checkout={checkout.mock} onClose={checkout.closeMock} onComplete={checkout.completeMock} />
    </div>
  );
}
