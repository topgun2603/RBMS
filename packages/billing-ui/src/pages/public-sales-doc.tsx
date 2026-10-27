"use client";

import * as React from "react";
import { absoluteUrl, apiUrl, ApiError, BrandingStyle, BrandMark, describeError, fontsInCss, LocaleSwitcher, QueryError, ThemeToggle, useDocumentBranding, useI18n, useRouteParams, useWebFonts } from "@srirealtime/web";
import { FileDownIcon, FileXIcon, Loader2Icon, PrinterIcon } from "lucide-react";
import { AnimatedNumber, Button, EmptyState, FadeIn, Skeleton, toast } from "@srirealtime/ui";
import { InvoiceDocument } from "../components/invoice-document";
import { useSalesDocMeta } from "../components/sales-docs/sd-ui";
import { money } from "../lib/format";
import { usePublicSalesDoc } from "../lib/queries-sales-docs";
import { salesDocAsInvoice } from "../lib/types-sales-docs";

/**
 * The link a shop sends with a proforma invoice, sale order or delivery challan: no sign-in, branded from the response,
 * bilingual and phone friendly. The customer reads the document and downloads the PDF.
 */
export default function PublicSalesDocPage() {
  const { t, formatDate, locale } = useI18n();
  const { token } = useRouteParams<{ token: string }>();
  const q = usePublicSalesDoc(token);
  const metaOf = useSalesDocMeta();
  const [downloading, setDownloading] = React.useState(false);

  const data = q.data;
  const doc = data?.doc;
  const shopName = data?.branding.appName || doc?.seller.legalName || "";
  const logoUrl = absoluteUrl(data?.branding.logoUrl);
  useDocumentBranding({ title: doc ? `${shopName} · ${doc.number}` : shopName || null, icon: logoUrl, suffix: "" });
  useWebFonts(fontsInCss(data?.branding.css));
  const meta = React.useMemo(() => (doc ? metaOf(doc) : null), [doc, metaOf]);

  if (q.isError) {
    const notFound = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400);
    return (
      <div className="flex min-h-dvh items-center justify-center bg-page p-4">
        <div className="w-full max-w-md">
          {notFound ? <EmptyState icon={FileXIcon} title={t("billing.sd.public.notFoundTitle")} description={t("billing.sd.public.notFound")} /> : <QueryError error={q.error} onRetry={() => void q.refetch()} />}
        </div>
      </div>
    );
  }

  const downloadPdf = async () => {
    if (!doc) return;
    setDownloading(true);
    try {
      const res = await fetch(apiUrl(`/documents/public/sales-doc/${encodeURIComponent(token)}.pdf`, { locale: locale === "ta" ? "ta" : undefined }));
      if (!res.ok) throw new ApiError(res.status, "download_failed", t("billing.pdf.forbidden"));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${t(`billing.sd.file.${doc.kind}`)}-${doc.number.replace(/[/\\]/g, "-")}.pdf`;
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
          {doc ? <BrandMark name={shopName} logoUrl={logoUrl} /> : <Skeleton className="h-8 w-40" />}
          <div className="ml-auto flex items-center gap-1">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-4xl grid-cols-[minmax(0,1fr)] gap-4 px-3 py-4 sm:px-4 sm:py-6" data-print-root>
        {!doc || !meta ? (
          <>
            <Skeleton className="h-36 rounded-2xl" />
            <Skeleton className="h-[60vh] rounded-2xl" />
          </>
        ) : (
          <>
            <FadeIn data-print-hide className="overflow-hidden rounded-2xl bg-card shadow-elevated ring-1 ring-card-ring">
              <div className="hero-band relative overflow-hidden px-5 pt-5 pb-6 sm:px-6">
                <div className="hero-dots pointer-events-none absolute inset-0" aria-hidden />
                <div className="relative">
                  <p className="text-sm opacity-90">{t("billing.sd.public.greeting", { name: doc.customer.name || "", shop: shopName })}</p>
                  <p className="mt-3 text-xs font-medium tracking-wide uppercase opacity-80">
                    {meta.title} {doc.number}
                  </p>
                  <p className="font-heading text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">
                    <AnimatedNumber value={doc.totals.total} from={0} duration={0.8} format={money} />
                  </p>
                  <p className="mt-1 text-sm tabular-nums opacity-90">
                    {doc.kind === "proforma" && doc.validUntil
                      ? t("billing.sd.public.validUntil", { date: formatDate(doc.validUntil) })
                      : doc.kind === "sale_order" && doc.promisedDate
                        ? t("billing.sd.public.deliveryBy", { date: formatDate(doc.promisedDate) })
                        : t("billing.sd.public.dated", { date: formatDate(doc.date) })}
                  </p>
                  {(doc.advanceReceived ?? 0) > 0 && <p className="mt-1 text-sm opacity-90">{t("billing.sd.public.advanceReceived", { amount: money(doc.advanceReceived!) })}</p>}
                </div>
              </div>
              <div className="grid gap-2 p-4 sm:flex sm:justify-end sm:p-5">
                <Button variant="outline" size="lg" className="h-12 sm:h-11" disabled={downloading} onClick={() => void downloadPdf()}>
                  {downloading ? <Loader2Icon className="animate-spin" /> : <FileDownIcon />} {t("billing.sd.public.pdf")}
                </Button>
                <Button variant="outline" size="lg" className="h-12 sm:h-11" onClick={() => window.print()}>
                  <PrinterIcon /> {t("billing.public.download")}
                </Button>
              </div>
            </FadeIn>
            <FadeIn delay={0.05}>
              <InvoiceDocument invoice={salesDocAsInvoice(doc)} doc={meta} shopName={shopName} logoUrl={logoUrl} />
            </FadeIn>
            <p data-print-hide className="pb-6 text-center text-xs text-muted-foreground">
              {t("billing.sd.public.footer", { shop: shopName })}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
