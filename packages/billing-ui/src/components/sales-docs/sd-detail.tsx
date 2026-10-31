"use client";

import * as React from "react";
import { ModuleLink, Page, QueryError, useFeature, useI18n, useShop } from "@rbms/web";
import { ArrowLeftIcon, FileDownIcon, Loader2Icon, MoreHorizontalIcon, PrinterIcon } from "lucide-react";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, FadeIn, InitialsAvatar, Skeleton } from "@rbms/ui";
import { InvoiceDocument } from "../invoice-document";
import { money } from "../../lib/format";
import { usePdf } from "../../lib/pdf";
import { salesDocAsInvoice, type DocShape, type PublicSalesDocResponse, type SalesDocKind } from "../../lib/types-sales-docs";
import { SalesDocStatusPill, useSalesDocMeta } from "./sd-ui";

/** PDF paths of the three types (packages/documents builtins). */
export const SALES_DOC_PDF: Record<SalesDocKind, (id: string) => string> = {
  proforma: (id) => `/documents/proforma/${id}.pdf`,
  sale_order: (id) => `/documents/sale-order/${id}.pdf`,
  challan: (id) => `/documents/challan/${id}.pdf`,
};

const LIST: Record<SalesDocKind, { href: string; label: string }> = {
  proforma: { href: "proformas", label: "billing.nav.proformas" },
  sale_order: { href: "sale-orders", label: "billing.nav.saleOrders" },
  challan: { href: "challans", label: "billing.nav.challans" },
};

/** Page frame of a detail screen: back link, loading / error, then `children`. */
export function DetailFrame<T>({ kind, query, children }: { kind: SalesDocKind; query: { isError: boolean; isPending: boolean; error: unknown; data?: T; refetch: () => unknown }; children: (d: T) => React.ReactNode }) {
  const { t } = useI18n();
  return (
    <Page>
      <div className="mb-3 flex items-center gap-2" data-print-hide>
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <ModuleLink to={LIST[kind].href}>
            <ArrowLeftIcon /> {t(LIST[kind].label)}
          </ModuleLink>
        </Button>
      </div>
      {query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isPending || !query.data ? (
        <div data-print-hide className="grid grid-cols-[minmax(0,1fr)] gap-section lg:grid-cols-[minmax(0,1fr)_21rem]">
          <Skeleton className="h-[70vh] rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : (
        children(query.data)
      )}
    </Page>
  );
}

/**
 * Header of a detail screen (number, status, customer, total, actions with PDF / print), the printable document on the
 * left and `side` cards on the right.
 */
export function DetailLayout({
  kind,
  doc,
  status,
  subtitle,
  actions,
  menu,
  side,
  docData,
}: {
  kind: SalesDocKind;
  doc: DocShape & { id: string; total: number };
  status: string;
  subtitle: React.ReactNode;
  actions: React.ReactNode;
  menu?: React.ReactNode;
  side: React.ReactNode;
  docData: PublicSalesDocResponse["doc"];
}) {
  const { t } = useI18n();
  const { shopName, logoUrl } = useShop();
  const documents = useFeature("documents");
  const pdf = usePdf();
  const metaOf = useSalesDocMeta();
  const meta = React.useMemo(() => metaOf(docData), [metaOf, docData]);
  const inv = React.useMemo(() => salesDocAsInvoice(doc), [doc]);
  const fileName = `${t(`billing.sd.file.${kind}`)}-${doc.number.replace(/[/\\]/g, "-")}.pdf`;
  const print = () => {
    const prev = document.title;
    document.title = `${shopName} ${doc.number}`.replace(/[/\\]/g, "-");
    window.print();
    window.setTimeout(() => (document.title = prev), 500);
  };
  return (
    <>
      <div className="mb-section flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between" data-print-hide>
        <div className="flex min-w-0 items-center gap-3">
          <InitialsAvatar name={doc.customer.name} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-semibold tracking-tight tabular-nums">{doc.number}</h1>
              <SalesDocStatusPill kind={kind} status={status} size="md" />
            </div>
            <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <p className="ml-auto pl-2 text-right font-heading text-xl font-bold whitespace-nowrap tabular-nums sm:text-2xl 2xl:hidden">{money(doc.total)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-2 hidden text-right font-heading text-2xl font-bold tabular-nums 2xl:block">{money(doc.total)}</p>
          {actions}
          {documents && (
            <Button variant="outline" size="lg" className="h-11" disabled={!!pdf.busy} aria-busy={pdf.busy === "a4"} onClick={() => void pdf.run("a4", SALES_DOC_PDF[kind](doc.id), { mode: "download", fallbackName: fileName })}>
              {pdf.busy === "a4" ? <Loader2Icon className="animate-spin" /> : <FileDownIcon />}
              <span className="hidden sm:inline">{t("billing.pdf.download")}</span>
              <span className="sr-only sm:hidden">{t("billing.pdf.download")}</span>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-lg" className="size-11" aria-label={t("billing.detail.more")}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem className="h-10" onSelect={print}>
                <PrinterIcon /> {t("billing.detail.print")}
              </DropdownMenuItem>
              {menu}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-section lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <FadeIn className="min-w-0">
          <InvoiceDocument invoice={inv} doc={meta} shopName={shopName} logoUrl={logoUrl} />
        </FadeIn>
        <div className="grid min-w-0 gap-4 lg:sticky lg:top-20" data-print-hide>
          {side}
        </div>
      </div>
    </>
  );
}
