"use client";

import * as React from "react";
import { ArrowLeftIcon, BanIcon, PrinterIcon, ReceiptIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@srirealtime/ui";
import { ConfirmDialog, DetailRow, describeError, ModuleLink, Page, PageHeading, useI18n, useRouteParams } from "@srirealtime/web";
import { ApplyDialog } from "../components/apply-dialog";
import { ExchangeStatusPill, InlineError, useMetalLabel } from "../components/bits";
import { jewelleryConfig } from "../lib/config";
import { grams, money } from "../lib/format";
import { useExchange, useExchangeActions } from "../lib/queries";

/** One old-gold exchange: lines, total, apply to a bill, cancel, print the receipt. */
export default function ExchangePage() {
  const { id } = useRouteParams<{ id: string }>();
  const { t, formatDate } = useI18n();
  const metalLabel = useMetalLabel();
  const x = useExchange(id);
  const { cancel } = useExchangeActions(id);
  const [applying, setApplying] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const d = x.data;

  return (
    <Page>
      <div data-print-hide>
        <Button asChild variant="ghost" size="sm" className="mb-2">
          <ModuleLink to="exchange">
            <ArrowLeftIcon /> {t("jewellery.exchanges.title")}
          </ModuleLink>
        </Button>
      </div>
      {x.isError ? (
        <InlineError title={describeError(x.error, t)} />
      ) : !d ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <div data-print-hide>
            <PageHeading
              title={t("jewellery.exchange.detailTitle", { code: d.code })}
              description={`${d.customerName} · ${formatDate(d.date)}`}
              actions={
                <div className="flex flex-wrap gap-2">
                  {d.status === "open" && (
                    <Button onClick={() => setApplying(true)}>
                      <ReceiptIcon /> {t("jewellery.apply.cta")}
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => window.print()}>
                    <PrinterIcon /> {t("jewellery.exchange.print")}
                  </Button>
                  {d.status === "open" && (
                    <Button variant="ghost" className="text-destructive" onClick={() => setCancelling(true)}>
                      <BanIcon /> {t("jewellery.exchange.cancel")}
                    </Button>
                  )}
                </div>
              }
            />
          </div>
          <div data-print-area className="grid gap-section">
            <Card>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                  <span>{t("jewellery.exchange.receiptTitle", { code: d.code })}</span>
                  <ExchangeStatusPill status={d.status} />
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="divide-y">
                  <DetailRow label={t("jewellery.exchange.customer")}>{d.customerName}</DetailRow>
                  {d.customerPhone && <DetailRow label={t("jewellery.exchange.phone")}>{d.customerPhone}</DetailRow>}
                  <DetailRow label={t("jewellery.exchanges.col.date")}>{formatDate(d.date)}</DetailRow>
                  {d.invoiceId && (
                    <DetailRow label={t("jewellery.exchange.appliedTo")}>
                      <ModuleLink href={jewelleryConfig().invoiceHref(d.invoiceId)} className="hover:underline">
                        {t("jewellery.exchange.openBill")}
                      </ModuleLink>
                      {d.appliedAt ? ` · ${formatDate(d.appliedAt)}` : ""}
                    </DetailRow>
                  )}
                  {d.note && <DetailRow label={t("jewellery.exchange.note")}>{d.note}</DetailRow>}
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("jewellery.exchange.description")}</TableHead>
                        <TableHead>{t("jewellery.piece.purity")}</TableHead>
                        <TableHead className="text-right">{t("jewellery.piece.gross")}</TableHead>
                        <TableHead className="text-right">{t("jewellery.exchange.deduction")}</TableHead>
                        <TableHead className="text-right">{t("jewellery.piece.net")}</TableHead>
                        <TableHead className="text-right">{t("jewellery.exchange.rate")}</TableHead>
                        <TableHead className="text-right">{t("jewellery.exchange.value")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.lines.map((l, i) => (
                        <TableRow key={i}>
                          <TableCell>{l.description}</TableCell>
                          <TableCell>{metalLabel(l.metal, l.purity)}</TableCell>
                          <TableCell className="text-right tabular-nums">{grams(l.grossWeight)}</TableCell>
                          <TableCell className="text-right tabular-nums">{l.deductionPct}%</TableCell>
                          <TableCell className="text-right tabular-nums">{grams(l.netWeight)}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(l.ratePerGram)}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(l.value)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={6} className="font-semibold">
                          {t("jewellery.exchange.total")}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{money(d.total)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
                <p className="text-meta text-muted-foreground">{t("jewellery.exchange.receiptNote")}</p>
              </CardContent>
            </Card>
          </div>
          <ApplyDialog open={applying} onOpenChange={setApplying} exchange={d} />
          <ConfirmDialog
            open={cancelling}
            onOpenChange={setCancelling}
            destructive
            title={t("jewellery.exchange.cancelTitle", { code: d.code })}
            description={t("jewellery.exchange.cancelBody")}
            confirmLabel={t("jewellery.exchange.cancel")}
            onConfirm={async () => {
              try {
                await cancel.mutateAsync();
                toast.success(t("jewellery.exchange.cancelled"));
                setCancelling(false);
              } catch (err) {
                toast.error(describeError(err, t));
              }
            }}
          />
        </>
      )}
    </Page>
  );
}
