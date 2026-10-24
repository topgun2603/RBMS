"use client";

import * as React from "react";
import { absoluteUrl, apiUrl, ApiError, BrandingStyle, BrandMark, describeError, fontsInCss, LocaleSwitcher, QueryError, ThemeToggle, useDocumentBranding, useI18n, useRouteParams, useWebFonts } from "@srirealtime/web";
import { BanIcon, CheckCircle2Icon, FileDownIcon, FileXIcon, Loader2Icon, PrinterIcon, ReceiptIcon, ThumbsDownIcon, ThumbsUpIcon, TimerOffIcon } from "lucide-react";
import {
  AnimatedNumber,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FadeIn,
  Input,
  Label,
  Skeleton,
  SuccessCheck,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { InvoiceDocument } from "../components/invoice-document";
import { useValidityText } from "../components/quotations/quotation-ui";
import { money } from "../lib/format";
import { usePublicQuotation, useRespondQuotation } from "../lib/queries-quotations";
import { quotationAsInvoice, quotationDocMeta, type PublicQuotation } from "../lib/types-quotations";

/**
 * The link a shop sends with a quotation: no sign-in, branded from the response, bilingual and phone friendly. The customer
 * reads the quotation and taps Accept or Decline (typing their name and an optional note).
 */
export default function PublicQuotationPage() {
  const { t, formatDate, locale } = useI18n();
  const { token } = useRouteParams<{ token: string }>();
  const q = usePublicQuotation(token);
  const respond = useRespondQuotation(token);
  const validity = useValidityText();
  const [decision, setDecision] = React.useState<null | "accept" | "decline">(null);
  const [name, setName] = React.useState("");
  const [note, setNote] = React.useState("");
  const [justAnswered, setJustAnswered] = React.useState<null | "accept" | "decline">(null);
  const [downloading, setDownloading] = React.useState(false);

  const data = q.data;
  const quote = data?.quotation;
  const shopName = data?.branding.appName || quote?.seller.legalName || "";
  const logoUrl = absoluteUrl(data?.branding.logoUrl);
  useDocumentBranding({ title: quote ? `${shopName} · ${quote.number}` : shopName || null, icon: logoUrl, suffix: "" });
  useWebFonts(fontsInCss(data?.branding.css));

  if (q.isError) {
    const notFound = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400);
    return (
      <div className="flex min-h-dvh items-center justify-center bg-page p-4">
        <div className="w-full max-w-md">
          {notFound ? (
            <EmptyState icon={FileXIcon} title={t("billing.q.public.notFoundTitle")} description={t("billing.q.public.notFound")} />
          ) : (
            <QueryError error={q.error} onRetry={() => void q.refetch()} />
          )}
        </div>
      </div>
    );
  }

  const openDialog = (d: "accept" | "decline") => {
    setName((n) => n || quote?.customer.name || "");
    setNote("");
    setDecision(d);
  };

  const submit = async () => {
    if (!decision || !name.trim()) return;
    try {
      await respond.mutateAsync({ decision, name: name.trim(), ...(note.trim() ? { note: note.trim() } : {}) });
      setJustAnswered(decision);
      setDecision(null);
    } catch (err) {
      toast.error(describeError(err, t));
      void q.refetch();
    }
  };

  const downloadPdf = async () => {
    if (!quote) return;
    setDownloading(true);
    try {
      const res = await fetch(apiUrl(`/documents/public/quotation/${encodeURIComponent(token)}.pdf`, { locale: locale === "ta" ? "ta" : undefined }));
      if (!res.ok) throw new ApiError(res.status, "download_failed", t("billing.pdf.forbidden"));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `Quotation-${quote.number.replace(/[/\\]/g, "-")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-page print:bg-white">
      {data?.branding.css ? <BrandingStyle css={data.branding.css} /> : null}
      <header data-print-hide className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-2 px-4">
          {quote ? <BrandMark name={shopName} logoUrl={logoUrl} /> : <Skeleton className="h-8 w-40" />}
          <div className="ml-auto flex items-center gap-1">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-4xl grid-cols-[minmax(0,1fr)] gap-4 px-3 py-4 sm:px-4 sm:py-6" data-print-root>
        {!quote ? (
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
              <div className="hero-band relative overflow-hidden px-5 pt-5 pb-6 sm:px-6">
                <div className="hero-dots pointer-events-none absolute inset-0" aria-hidden />
                <div className="relative">
                  <p className="text-sm opacity-90">{t("billing.q.public.greeting", { name: quote.customer.name || "", shop: shopName })}</p>
                  <p className="mt-3 text-xs font-medium tracking-wide uppercase opacity-80">{t("billing.q.public.heading", { number: quote.number })}</p>
                  <p className="font-heading text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">
                    <AnimatedNumber value={quote.total} from={0} duration={0.8} format={money} />
                  </p>
                  <p className="mt-1 text-sm tabular-nums opacity-90" data-testid="quote-validity">
                    {quote.displayStatus === "sent" || quote.displayStatus === "expired"
                      ? t("billing.q.public.validUntil", { date: formatDate(quote.validUntil) })
                      : t("billing.q.public.dated", { date: formatDate(quote.date) })}
                    {quote.status === "sent" && validity(quote.daysLeft) ? ` · ${validity(quote.daysLeft)}` : ""}
                  </p>
                  {quote.advanceAmount > 0 && quote.status === "sent" && (
                    <p className="mt-1 text-sm opacity-90">{t("billing.q.public.advance", { amount: money(quote.advanceAmount), pct: quote.advancePercent ?? 0 })}</p>
                  )}
                </div>
              </div>

              <div className="grid gap-3 p-4 sm:p-5">
                <Outcome quote={quote} just={justAnswered} onLatest={() => {
                    const parts = window.location.pathname.replace(/\/+$/, "").split("/");
                    if (quote.latestToken) window.location.assign([...parts.slice(0, -1), quote.latestToken].join("/"));
                  }} />
                {quote.canRespond && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button size="lg" className="h-12 text-base" onClick={() => openDialog("accept")} data-testid="quote-accept">
                      <ThumbsUpIcon /> {t("billing.q.public.accept")}
                    </Button>
                    <Button size="lg" variant="outline" className="h-12 text-base" onClick={() => openDialog("decline")} data-testid="quote-decline">
                      <ThumbsDownIcon /> {t("billing.q.public.decline")}
                    </Button>
                  </div>
                )}
                <div className="grid gap-2 sm:flex sm:justify-end">
                  <Button variant="outline" size="lg" className="h-12 sm:h-11" disabled={downloading} onClick={() => void downloadPdf()}>
                    {downloading ? <Loader2Icon className="animate-spin" /> : <FileDownIcon />} {t("billing.q.public.pdf")}
                  </Button>
                  <Button variant="outline" size="lg" className="h-12 sm:h-11" onClick={() => window.print()}>
                    <PrinterIcon /> {t("billing.public.download")}
                  </Button>
                </div>
              </div>
            </FadeIn>

            <FadeIn delay={0.05}>
              <InvoiceDocument invoice={quotationAsInvoice({ ...quote, id: "" })} quotation={quotationDocMeta(quote)} shopName={shopName} logoUrl={logoUrl} />
            </FadeIn>
            <p data-print-hide className="pb-6 text-center text-xs text-muted-foreground">
              {t("billing.q.public.footer", { shop: shopName })}
            </p>
          </>
        )}
      </main>

      <Dialog open={!!decision} onOpenChange={(o) => !respond.isPending && !o && setDecision(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{decision === "accept" ? t("billing.q.public.acceptTitle") : t("billing.q.public.declineTitle")}</DialogTitle>
            <DialogDescription>{decision === "accept" ? t("billing.q.public.acceptBody", { shop: shopName }) : t("billing.q.public.declineBody", { shop: shopName })}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="pq-name">{t("billing.q.public.yourName")}</Label>
              <Input id="pq-name" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} aria-required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pq-note">{t("billing.q.public.note")}</Label>
              <Textarea id="pq-note" rows={3} maxLength={500} value={note} placeholder={decision === "accept" ? t("billing.q.public.notePlaceholderAccept") : t("billing.q.public.notePlaceholderDecline")} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="lg" onClick={() => setDecision(null)} disabled={respond.isPending}>
              {t("billing.common.cancel")}
            </Button>
            <Button size="lg" variant={decision === "decline" ? "destructive" : "default"} disabled={respond.isPending || !name.trim()} onClick={() => void submit()} data-testid="quote-confirm">
              {respond.isPending ? <Loader2Icon className="animate-spin" /> : decision === "accept" ? <ThumbsUpIcon /> : <ThumbsDownIcon />}
              {decision === "accept" ? t("billing.q.public.confirmAccept") : t("billing.q.public.confirmDecline")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The state of the quotation once it can't be answered: accepted, declined, expired, replaced, withdrawn or billed. */
function Outcome({ quote, just, onLatest }: { quote: PublicQuotation; just: null | "accept" | "decline"; onLatest: () => void }) {
  const { t, formatDate } = useI18n();
  const when = quote.respondedAt ? formatDate(quote.respondedAt, { day: "numeric", month: "short", year: "numeric" }) : "";
  if (quote.canRespond) return null;
  const box = "flex items-start gap-3 rounded-xl border p-3 text-sm";
  if (!quote.latest) {
    return (
      <div className={box} role="status">
        <ReceiptIcon className="mt-0.5 size-5 shrink-0 text-info-ink" />
        <div className="min-w-0">
          <p className="font-medium">{t("billing.q.public.revisedTitle")}</p>
          <p className="text-muted-foreground">{quote.latestToken ? t("billing.q.public.revisedBody") : t("billing.q.public.revisedPending")}</p>
          {quote.latestToken && (
            <Button size="sm" className="mt-2" onClick={onLatest}>
              {t("billing.q.public.openLatest")}
            </Button>
          )}
        </div>
      </div>
    );
  }
  if (quote.status === "accepted" || (quote.status === "converted" && quote.respondedAt)) {
    return (
      <div className={`${box} border-success/40 bg-success/10`} role="status" aria-live="polite" data-testid="quote-outcome">
        {just === "accept" ? <SuccessCheck size={44} /> : <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-success-ink" />}
        <div className="min-w-0">
          <p className="font-medium text-success-ink">{t("billing.q.public.acceptedTitle")}</p>
          <p className="text-muted-foreground">{t("billing.q.public.acceptedBody", { name: quote.respondedBy ?? "", date: when })}</p>
          {quote.responseNote && <p className="mt-1 whitespace-pre-line">&ldquo;{quote.responseNote}&rdquo;</p>}
        </div>
      </div>
    );
  }
  if (quote.status === "declined") {
    return (
      <div className={box} role="status" aria-live="polite" data-testid="quote-outcome">
        <ThumbsDownIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="font-medium">{t("billing.q.public.declinedTitle")}</p>
          <p className="text-muted-foreground">{t("billing.q.public.declinedBody", { name: quote.respondedBy ?? "", date: when })}</p>
          {quote.responseNote && <p className="mt-1 whitespace-pre-line">&ldquo;{quote.responseNote}&rdquo;</p>}
        </div>
      </div>
    );
  }
  if (quote.displayStatus === "expired") {
    return (
      <div className={`${box} border-warning/40 bg-warning/10`} role="status">
        <TimerOffIcon className="mt-0.5 size-5 shrink-0 text-warning-ink" />
        <div>
          <p className="font-medium text-warning-ink">{t("billing.q.public.expiredTitle")}</p>
          <p className="text-muted-foreground">{t("billing.q.public.expiredBody")}</p>
        </div>
      </div>
    );
  }
  if (quote.status === "cancelled") {
    return (
      <div className={box} role="status">
        <BanIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <p className="font-medium">{t("billing.q.public.cancelledTitle")}</p>
      </div>
    );
  }
  if (quote.status === "converted") {
    return (
      <div className={box} role="status">
        <ReceiptIcon className="mt-0.5 size-5 shrink-0 text-primary" />
        <p className="font-medium">{t("billing.q.public.billedTitle")}</p>
      </div>
    );
  }
  return null;
}
