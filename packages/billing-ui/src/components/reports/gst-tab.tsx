"use client";

import * as React from "react";
import { BadgePercentIcon, LandmarkIcon, PiggyBankIcon, ReceiptIndianRupeeIcon, ScrollTextIcon } from "lucide-react";
import { Card, cn, Skeleton } from "@rbms/ui";
import { BarList } from "../charts/bar-list";
import { ChartCard } from "../charts/chart-card";
import { StatTile } from "../charts/stat-tile";
import { Gstr1Card } from "./gstr1-card";
import { compactINR, formatQty, money, stateLabel } from "../../lib/format";
import { useI18n } from "@rbms/web";
import { REPORT_PATHS, useGstSummary, usePurchasesReport } from "../../lib/queries-v2";
import type { GstSummaryResponse } from "../../lib/types";
import {
  CollapsibleCard,
  DownloadCsvButton,
  PeriodEmpty,
  rateText,
  Refreshing,
  ReportTable,
  sum,
  TabError,
  TableSkeleton,
  TileGrid,
  type Column,
  type RangeProps,
} from "./report-ui";

type B2B = GstSummaryResponse["b2b"][number];
type B2CL = GstSummaryResponse["b2cl"][number];
type B2CS = GstSummaryResponse["b2cs"][number];
type HSN = GstSummaryResponse["hsn"][number];
type CDNR = NonNullable<GstSummaryResponse["cdnr"]>[number];
type CDNUR = NonNullable<GstSummaryResponse["cdnur"]>[number];

export function GstTab({ from, to }: RangeProps) {
  const { t } = useI18n();
  const gst = useGstSummary(from, to);
  const pur = usePurchasesReport(from, to);

  if (gst.isError && !gst.data) {
    return (
      <div className="grid gap-section">
        <Gstr1Card />
        <TabError error={gst.error} onRetry={() => void gst.refetch()} />
      </div>
    );
  }
  const loading = gst.isPending;
  const raw = gst.data;
  // Read defensively: any section may be missing while the API settles.
  const d: GstSummaryResponse | undefined = raw && {
    ...raw,
    b2b: raw.b2b ?? [],
    b2cl: raw.b2cl ?? [],
    b2cs: raw.b2cs ?? [],
    hsn: raw.hsn ?? [],
    byRate: raw.byRate ?? [],
  };
  const byRate = d?.byRate ?? [];

  const cgst = d?.totals?.cgst ?? sum(byRate, (r) => r.cgst);
  const sgst = d?.totals?.sgst ?? sum(byRate, (r) => r.sgst);
  const igst = d?.totals?.igst ?? sum(byRate, (r) => r.igst);
  const taxable = d?.totals?.taxable ?? sum(byRate, (r) => r.taxable);
  const output = cgst + sgst + igst;
  const itc = pur.data?.itc;
  const itcTotal = itc?.total ?? 0;
  const net = output - itcTotal;
  const purFailed = pur.isError && !pur.data;

  const empty = !loading && taxable === 0 && output === 0 && !(d?.b2b.length || d?.b2cs.length || d?.hsn.length);
  const rateItems = byRate
    .map((r) => ({ rate: Number(r.gstRate), tax: r.cgst + r.sgst + r.igst, taxable: r.taxable }))
    .filter((r) => r.tax > 0 || r.taxable > 0);
  const topRate = [...rateItems].sort((a, b) => b.tax - a.tax)[0];

  return (
    <Refreshing active={gst.isPlaceholderData}>
      <Gstr1Card />
      <TileGrid>
        {[
          <StatTile key="a" label={t("billing.reports.gst.taxable")} value={taxable} icon={ScrollTextIcon} loading={loading} />,
          <StatTile
            key="b"
            label={t("billing.reports.gst.outputTax")}
            value={output}
            hint={t("billing.reports.gst.outputHint")}
            icon={ReceiptIndianRupeeIcon}
            iconTone="text-warning"
            loading={loading}
          />,
          <StatTile
            key="c"
            label={t("billing.reports.gst.itc")}
            value={itcTotal}
            hint={purFailed ? t("billing.reports.gst.itcUnavailable") : t("billing.reports.gst.itcHint")}
            icon={PiggyBankIcon}
            iconTone="text-success"
            loading={pur.isPending && !purFailed}
          />,
          <StatTile
            key="d"
            label={net < 0 ? t("billing.reports.gst.netCredit") : t("billing.reports.gst.netPayable")}
            value={Math.abs(net)}
            hint={net < 0 ? t("billing.reports.gst.netCreditHint") : t("billing.reports.gst.netHint")}
            icon={LandmarkIcon}
            iconTone={net < 0 ? "text-success" : "text-primary"}
            loading={loading || (pur.isPending && !purFailed)}
          />,
        ]}
      </TileGrid>

      {empty ? (
        <PeriodEmpty title={t("billing.reports.gst.emptyTitle")} />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-5">
            <ChartCard
              className="lg:col-span-2"
              title={t("billing.reports.gst.byRateTitle")}
              loading={loading}
              height={200}
              ariaLabel={
                topRate
                  ? t("billing.reports.gst.byRateAria", { rate: rateText(t, topRate.rate), value: money(topRate.tax) })
                  : t("billing.reports.gst.byRateTitle")
              }
              empty={!loading && !rateItems.length ? <p className="text-sm text-muted-foreground">{t("billing.charts.noData")}</p> : undefined}
              table={{
                columns: [
                  { label: t("billing.reports.cols.rate") },
                  { label: t("billing.reports.cols.taxable"), numeric: true },
                  { label: t("billing.reports.cols.outputTax"), numeric: true },
                ],
                rows: rateItems.map((r) => [rateText(t, r.rate), money(r.taxable), money(r.tax)]),
              }}
            >
              <BarList
                formatValue={compactINR}
                items={rateItems.map((r) => ({
                  key: String(r.rate),
                  label: rateText(t, r.rate),
                  text: rateText(t, r.rate),
                  value: r.tax,
                  meta: t("billing.reports.gst.rateMeta", { taxable: money(r.taxable) }),
                }))}
              />
            </ChartCard>
            {loading ? (
              <Card className="lg:col-span-3">
                <Skeleton className="mx-4 h-60 rounded-xl" />
              </Card>
            ) : (
              <Gstr3b className="lg:col-span-3" data={d!} itc={itc} itcFailed={purFailed} itcLoading={pur.isPending && !purFailed} />
            )}
          </div>

          {loading ? <TableSkeleton rows={4} /> : <Gstr1 data={d!} from={from} to={to} />}
        </>
      )}
    </Refreshing>
  );
}

function Gstr3b({
  data,
  itc,
  itcFailed,
  itcLoading,
  className,
}: {
  data: GstSummaryResponse;
  itc: { taxable: number; cgst: number; sgst: number; igst: number; total: number } | undefined;
  itcFailed: boolean;
  itcLoading: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const g = data.gstr3b ?? { outwardTaxable: 0, igst: 0, cgst: 0, sgst: 0, nilRated: 0 };
  const i = itc ?? { igst: 0, cgst: 0, sgst: 0 };
  const net = { igst: g.igst - i.igst, cgst: g.cgst - i.cgst, sgst: g.sgst - i.sgst };
  const dash = <span className="text-muted-foreground">—</span>;
  const itcCell = (v: number) => (itcLoading ? <Skeleton className="ml-auto h-4 w-16" /> : itcFailed ? dash : money(v));
  const netCell = (v: number) =>
    itcLoading ? (
      <Skeleton className="ml-auto h-4 w-16" />
    ) : (
      <span className={cn(v < 0 && "text-success-ink")}>{v < 0 ? `−${money(-v)}` : money(v)}</span>
    );
  const rows: { label: string; taxable: React.ReactNode; igst: React.ReactNode; cgst: React.ReactNode; sgst: React.ReactNode; strong?: boolean }[] = [
    { label: t("billing.reports.gst.g3Outward"), taxable: money(g.outwardTaxable), igst: money(g.igst), cgst: money(g.cgst), sgst: money(g.sgst) },
    { label: t("billing.reports.gst.g3Nil"), taxable: money(g.nilRated), igst: dash, cgst: dash, sgst: dash },
    { label: t("billing.reports.gst.g3Itc"), taxable: dash, igst: itcCell(i.igst), cgst: itcCell(i.cgst), sgst: itcCell(i.sgst) },
    { label: t("billing.reports.gst.g3Net"), taxable: dash, igst: netCell(net.igst), cgst: netCell(net.cgst), sgst: netCell(net.sgst), strong: true },
  ];
  return (
    <Card className={cn("gap-0 overflow-hidden py-0", className)}>
      <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-5">
        <span className="icon-chip size-9 text-primary">
          <LandmarkIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="font-heading text-base font-semibold">{t("billing.reports.gst.gstr3bTitle")}</h2>
          <p className="text-meta text-muted-foreground">{t("billing.reports.gst.gstr3bDescription")}</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t("billing.reports.gst.gstr3bTitle")}</caption>
          <thead>
            <tr className="border-b text-left text-xs tracking-wide text-muted-foreground uppercase">
              <th scope="col" className="h-10 px-3 pl-4 font-medium sm:pl-5">
                {t("billing.reports.cols.particulars")}
              </th>
              <th scope="col" className="px-3 text-right font-medium whitespace-nowrap">
                {t("billing.reports.cols.taxable")}
              </th>
              <th scope="col" className="px-3 text-right font-medium">
                {t("billing.reports.cols.igst")}
              </th>
              <th scope="col" className="px-3 text-right font-medium">
                {t("billing.reports.cols.cgst")}
              </th>
              <th scope="col" className="px-3 pr-4 text-right font-medium sm:pr-5">
                {t("billing.reports.cols.sgst")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className={cn("border-b border-border/60 last:border-0", r.strong && "bg-primary/5 font-semibold")}>
                <th scope="row" className="min-w-48 px-3 py-2.5 pl-4 text-left font-medium sm:pl-5">
                  {r.label}
                </th>
                <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">{r.taxable}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">{r.igst}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">{r.cgst}</td>
                <td className="px-3 py-2.5 pr-4 text-right whitespace-nowrap tabular-nums sm:pr-5">{r.sgst}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t px-4 py-2.5 text-meta text-muted-foreground sm:px-5">{t("billing.reports.gst.g3NetHint")}</p>
    </Card>
  );
}

function Gstr1({ data, from, to }: { data: GstSummaryResponse; from: string; to: string }) {
  const { t } = useI18n();
  const rate = (r: number) => rateText(t, Number(r));
  const csv = (section: "b2b" | "b2cs" | "hsn" | "cdnr" | "cdnur") => (
    <DownloadCsvButton
      size="sm"
      path={REPORT_PATHS.gstSummary}
      params={{ from, to, section }}
      fileName={`gstr1-${section}-${from}-to-${to}.csv`}
    />
  );
  const badge = (n: number) => (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2 text-xs font-medium tabular-nums ring-1 ring-inset",
        n ? "bg-primary/10 text-primary ring-primary/20" : "bg-muted text-muted-foreground ring-border",
      )}
    >
      {t("billing.reports.rowsCount", { count: n })}
    </span>
  );
  const m = (v: number) => money(v);

  const b2bCols: Column<B2B>[] = [
    { key: "gstin", label: t("billing.reports.cols.gstin"), cell: (r) => <span className="font-mono text-xs">{r.gstin}</span>, footer: t("billing.reports.total") },
    { key: "name", label: t("billing.reports.cols.customer"), cell: (r) => <span className="block max-w-56 truncate">{r.name}</span> },
    { key: "inv", label: t("billing.reports.cols.invoices"), numeric: true, cell: (r) => r.invoices, footer: sum(data.b2b, (r) => r.invoices) },
    { key: "taxable", label: t("billing.reports.cols.taxable"), numeric: true, cell: (r) => m(r.taxable), footer: m(sum(data.b2b, (r) => r.taxable)) },
    { key: "cgst", label: t("billing.reports.cols.cgst"), numeric: true, cell: (r) => m(r.cgst), footer: m(sum(data.b2b, (r) => r.cgst)) },
    { key: "sgst", label: t("billing.reports.cols.sgst"), numeric: true, cell: (r) => m(r.sgst), footer: m(sum(data.b2b, (r) => r.sgst)) },
    { key: "igst", label: t("billing.reports.cols.igst"), numeric: true, cell: (r) => m(r.igst), footer: m(sum(data.b2b, (r) => r.igst)) },
    { key: "total", label: t("billing.reports.cols.total"), numeric: true, cell: (r) => <span className="font-semibold">{m(r.total)}</span>, footer: m(sum(data.b2b, (r) => r.total)) },
  ];
  const b2clCols: Column<B2CL>[] = [
    { key: "pos", label: t("billing.reports.cols.placeOfSupply"), cell: (r) => stateLabel(r.placeOfSupply), footer: t("billing.reports.total") },
    { key: "rate", label: t("billing.reports.cols.rate"), cell: (r) => rate(r.rate) },
    { key: "taxable", label: t("billing.reports.cols.taxable"), numeric: true, cell: (r) => m(r.taxable), footer: m(sum(data.b2cl, (r) => r.taxable)) },
    { key: "igst", label: t("billing.reports.cols.igst"), numeric: true, cell: (r) => m(r.igst), footer: m(sum(data.b2cl, (r) => r.igst)) },
  ];
  const b2csCols: Column<B2CS>[] = [
    { key: "pos", label: t("billing.reports.cols.placeOfSupply"), cell: (r) => stateLabel(r.placeOfSupply), footer: t("billing.reports.total") },
    { key: "rate", label: t("billing.reports.cols.rate"), cell: (r) => rate(r.rate) },
    { key: "taxable", label: t("billing.reports.cols.taxable"), numeric: true, cell: (r) => m(r.taxable), footer: m(sum(data.b2cs, (r) => r.taxable)) },
    { key: "cgst", label: t("billing.reports.cols.cgst"), numeric: true, cell: (r) => m(r.cgst), footer: m(sum(data.b2cs, (r) => r.cgst)) },
    { key: "sgst", label: t("billing.reports.cols.sgst"), numeric: true, cell: (r) => m(r.sgst), footer: m(sum(data.b2cs, (r) => r.sgst)) },
    { key: "igst", label: t("billing.reports.cols.igst"), numeric: true, cell: (r) => m(r.igst), footer: m(sum(data.b2cs, (r) => r.igst)) },
  ];
  const hsnCols: Column<HSN>[] = [
    { key: "hsn", label: t("billing.reports.cols.hsn"), cell: (r) => <span className="font-mono text-xs">{r.hsn || "—"}</span>, footer: t("billing.reports.total") },
    { key: "desc", label: t("billing.reports.cols.description"), cell: (r) => <span className="block max-w-56 truncate">{r.description}</span> },
    { key: "qty", label: t("billing.reports.cols.qty"), numeric: true, cell: (r) => `${formatQty(r.qty)} ${r.unit ?? ""}`.trim() },
    { key: "taxable", label: t("billing.reports.cols.taxable"), numeric: true, cell: (r) => m(r.taxable), footer: m(sum(data.hsn, (r) => r.taxable)) },
    { key: "cgst", label: t("billing.reports.cols.cgst"), numeric: true, cell: (r) => m(r.cgst), footer: m(sum(data.hsn, (r) => r.cgst)) },
    { key: "sgst", label: t("billing.reports.cols.sgst"), numeric: true, cell: (r) => m(r.sgst), footer: m(sum(data.hsn, (r) => r.sgst)) },
    { key: "igst", label: t("billing.reports.cols.igst"), numeric: true, cell: (r) => m(r.igst), footer: m(sum(data.hsn, (r) => r.igst)) },
    { key: "total", label: t("billing.reports.cols.total"), numeric: true, cell: (r) => <span className="font-semibold">{m(r.total)}</span>, footer: m(sum(data.hsn, (r) => r.total)) },
  ];

  const cdnr = data.cdnr ?? [];
  const cdnur = data.cdnur ?? [];
  const note = (r: { noteNumber: string; invoiceNumber: string; noteType?: "C" | "D" }) => (
    <span className="grid">
      <span className="font-medium tabular-nums">{r.noteNumber}</span>
      <span className="text-xs text-muted-foreground">
        {r.noteType === "D" ? `${t("billing.dn.create")} (D) · ${t("billing.dn.on", { number: r.invoiceNumber })}` : t("billing.cn.against", { number: r.invoiceNumber })}
      </span>
    </span>
  );
  const cdnrCols: Column<CDNR>[] = [
    { key: "gstin", label: t("billing.reports.cols.gstin"), cell: (r) => <span className="font-mono text-xs">{r.gstin}</span>, footer: t("billing.reports.total") },
    { key: "note", label: t("billing.reports.cols.number"), cell: note },
    { key: "rate", label: t("billing.reports.cols.rate"), cell: (r) => rate(r.rate) },
    { key: "taxable", label: t("billing.reports.cols.taxable"), numeric: true, cell: (r) => m(r.taxable), footer: m(sum(cdnr, (r) => r.taxable)) },
    { key: "tax", label: t("billing.reports.cols.tax"), numeric: true, cell: (r) => m(r.cgst + r.sgst + r.igst), footer: m(sum(cdnr, (r) => r.cgst + r.sgst + r.igst)) },
  ];
  const cdnurCols: Column<CDNUR>[] = [
    { key: "note", label: t("billing.reports.cols.number"), cell: note, footer: t("billing.reports.total") },
    { key: "pos", label: t("billing.reports.cols.placeOfSupply"), cell: (r) => stateLabel(r.placeOfSupply) },
    { key: "rate", label: t("billing.reports.cols.rate"), cell: (r) => rate(r.rate) },
    { key: "taxable", label: t("billing.reports.cols.taxable"), numeric: true, cell: (r) => m(r.taxable), footer: m(sum(cdnur, (r) => r.taxable)) },
    { key: "igst", label: t("billing.reports.cols.igst"), numeric: true, cell: (r) => m(r.igst), footer: m(sum(cdnur, (r) => r.igst)) },
  ];

  return (
    <section className="grid gap-3" aria-labelledby="gstr1-title">
      <div className="flex items-center gap-3 px-1">
        <span className="icon-chip size-9 text-primary">
          <BadgePercentIcon className="size-4" />
        </span>
        <div>
          <h2 id="gstr1-title" className="font-heading text-base font-semibold">
            {t("billing.reports.gst.gstr1Title")}
          </h2>
          <p className="text-meta text-muted-foreground">{t("billing.reports.gst.gstr1Description")}</p>
        </div>
      </div>
      <CollapsibleCard title={t("billing.reports.gst.b2b")} description={t("billing.reports.gst.b2bHint")} badge={badge(data.b2b.length)} actions={csv("b2b")} defaultOpen={data.b2b.length > 0}>
        <ReportTable columns={b2bCols} rows={data.b2b} rowKey={(r, i) => `${r.gstin}-${i}`} caption={t("billing.reports.gst.b2b")} />
      </CollapsibleCard>
      <CollapsibleCard title={t("billing.reports.gst.b2cl")} description={t("billing.reports.gst.b2clHint")} badge={badge(data.b2cl.length)}>
        <ReportTable columns={b2clCols} rows={data.b2cl} rowKey={(r, i) => `${r.placeOfSupply}-${r.rate}-${i}`} caption={t("billing.reports.gst.b2cl")} />
      </CollapsibleCard>
      <CollapsibleCard title={t("billing.reports.gst.b2cs")} description={t("billing.reports.gst.b2csHint")} badge={badge(data.b2cs.length)} actions={csv("b2cs")}>
        <ReportTable columns={b2csCols} rows={data.b2cs} rowKey={(r, i) => `${r.placeOfSupply}-${r.rate}-${i}`} caption={t("billing.reports.gst.b2cs")} />
      </CollapsibleCard>
      <CollapsibleCard title={t("billing.reports.gst.cdnr")} description={t("billing.reports.gst.cdnrHint")} badge={badge(cdnr.length)} actions={csv("cdnr")}>
        <ReportTable columns={cdnrCols} rows={cdnr} rowKey={(r, i) => `${r.noteNumber}-${r.rate}-${i}`} caption={t("billing.reports.gst.cdnr")} />
      </CollapsibleCard>
      {cdnur.length > 0 && (
        <CollapsibleCard title={t("billing.reports.gst.cdnur")} description={t("billing.reports.gst.cdnurHint")} badge={badge(cdnur.length)} actions={csv("cdnur")}>
          <ReportTable columns={cdnurCols} rows={cdnur} rowKey={(r, i) => `${r.noteNumber}-${r.rate}-${i}`} caption={t("billing.reports.gst.cdnur")} />
        </CollapsibleCard>
      )}
      <CollapsibleCard title={t("billing.reports.gst.hsn")} description={t("billing.reports.gst.hsnHint")} badge={badge(data.hsn.length)} actions={csv("hsn")}>
        <ReportTable columns={hsnCols} rows={data.hsn} rowKey={(r, i) => `${r.hsn}-${i}`} caption={t("billing.reports.gst.hsn")} />
      </CollapsibleCard>
    </section>
  );
}
