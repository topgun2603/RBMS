"use client";

import * as React from "react";
import { PercentIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@rbms/ui";
import { QueryError, useI18n } from "@rbms/web";
import { AccountingPage, Amt, Panel, ReportBar, TableSkeleton } from "../components/accounting/parts";
import { useGstLedger } from "../lib/accounting";
import { money, rangeFor, todayIST } from "../lib/format";

/** GST collected on sales against GST paid on purchases and expenses, from the books. */
export default function AccountingGstPage() {
  const { t } = useI18n();
  const fy = React.useMemo(() => rangeFor("thisFY"), []);
  const [from, setFrom] = React.useState(fy.from);
  const [to, setTo] = React.useState(todayIST());
  const gst = useGstLedger({ from, to });
  const heads = ["cgst", "sgst", "igst", "cess"] as const;

  return (
    <AccountingPage title={t("billing.accounting.nav.gst")} description={t("billing.accounting.gst.subtitle")} icon={PercentIcon}>
      <ReportBar report="gst-ledger" params={{ from, to }} from={from} to={to} onFrom={setFrom} onTo={setTo} />
      {gst.isError && !gst.data ? (
        <QueryError error={gst.error} onRetry={() => void gst.refetch()} />
      ) : gst.isPending ? (
        <TableSkeleton />
      ) : (
        <Panel>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("billing.accounting.gst.tax")}</TableHead>
                  <TableHead className="text-right">{t("billing.accounting.gst.output")}</TableHead>
                  <TableHead className="text-right">{t("billing.accounting.gst.input")}</TableHead>
                  <TableHead className="text-right">{t("billing.accounting.gst.net")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {heads.map((h) => (
                  <TableRow key={h}>
                    <TableCell className="font-medium uppercase">{h}</TableCell>
                    <TableCell className="text-right">
                      <Amt v={gst.data.output[h]} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Amt v={gst.data.input[h]} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Amt v={gst.data.output[h] - gst.data.input[h]} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">{t("billing.reports.total")}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{money(gst.data.output.total)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{money(gst.data.input.total)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{money(gst.data.net)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </Panel>
      )}
      <p className="mt-3 text-meta text-muted-foreground">{t("billing.accounting.gst.note")}</p>
    </AccountingPage>
  );
}
