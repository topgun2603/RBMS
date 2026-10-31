"use client";

import * as React from "react";
import { TrendingUpIcon } from "lucide-react";
import { Card, CardContent, ChipGroup, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@rbms/ui";
import { QueryError, useI18n } from "@rbms/web";
import { AccountingPage, BranchSelect, Panel, ReportBar, TableSkeleton, useHasBranches } from "../components/accounting/parts";
import { useProfitLoss, useProfitLossByBranch, type ProfitLoss, type ProfitLossByBranch } from "../lib/accounting";
import { money, rangeFor, todayIST } from "../lib/format";

/** Profit and loss for a period, optionally beside the period before it, for one branch, or branch by branch. */
export default function AccountingProfitLossPage() {
  const { t, formatDate } = useI18n();
  const fy = React.useMemo(() => rangeFor("thisFY"), []);
  const [from, setFrom] = React.useState(fy.from);
  const [to, setTo] = React.useState(todayIST());
  const [compare, setCompare] = React.useState<"none" | "previous">("none");
  const [branchId, setBranchId] = React.useState("");
  const [view, setView] = React.useState<"single" | "branches">("single");
  const hasBranches = useHasBranches();
  const byBranch = hasBranches && view === "branches";
  const pl = useProfitLoss({ from, to, compare: compare === "previous" ? "previous" : undefined, branchId: branchId || undefined });
  const plb = useProfitLossByBranch({ from, to }, byBranch);
  const d = (s: string) => formatDate(s, { day: "numeric", month: "short", year: "2-digit" });

  return (
    <AccountingPage title={t("billing.accounting.nav.profitLoss")} description={t("billing.accounting.pnl.subtitle")} icon={TrendingUpIcon}>
      <ReportBar
        report={byBranch ? "profit-loss-branches" : "profit-loss"}
        params={byBranch ? { from, to } : { from, to, compare: compare === "previous" ? "previous" : undefined, branchId }}
        from={from}
        to={to}
        onFrom={setFrom}
        onTo={setTo}
      >
        {hasBranches && (
          <ChipGroup
            size="sm"
            aria-label={t("billing.accounting.pnl.view")}
            value={view}
            onChange={setView}
            options={[
              { value: "single", label: t("billing.accounting.pnl.viewSingle") },
              { value: "branches", label: t("billing.accounting.pnl.viewBranches") },
            ]}
          />
        )}
        {!byBranch && <BranchSelect value={branchId} onChange={setBranchId} />}
        {!byBranch && (
          <ChipGroup
            size="sm"
            aria-label={t("billing.accounting.pnl.compare")}
            value={compare}
            onChange={setCompare}
            options={[
              { value: "none", label: t("billing.accounting.pnl.noCompare") },
              { value: "previous", label: t("billing.accounting.pnl.comparePrevious") },
            ]}
          />
        )}
      </ReportBar>
      {byBranch ? (
        plb.isError && !plb.data ? (
          <QueryError error={plb.error} onRetry={() => void plb.refetch()} />
        ) : plb.isPending ? (
          <TableSkeleton />
        ) : (
          <BranchPnl r={plb.data} />
        )
      ) : pl.isError && !pl.data ? (
        <QueryError error={pl.error} onRetry={() => void pl.refetch()} />
      ) : pl.isPending ? (
        <TableSkeleton />
      ) : (
        <PnlBody pl={pl.data} d={d} />
      )}
      <p className="mt-3 text-meta text-muted-foreground">{t("billing.accounting.pnl.basis")}</p>
      {hasBranches && <p className="mt-1 text-meta text-muted-foreground">{t("billing.accounting.branch.note")}</p>}
    </AccountingPage>
  );
}

/** One column per branch, head office / unassigned, and the whole shop; the branches add up to the whole shop. */
function BranchPnl({ r }: { r: ProfitLossByBranch }) {
  const { t } = useI18n();
  const cols = [...r.columns.map((c) => ({ key: c.branch.id ?? "none", label: c.branch.id === null ? t("billing.accounting.branch.unassigned") : c.branch.name, pl: c.pl })), { key: "total", label: t("billing.accounting.pnl.wholeShop"), pl: r.consolidated }];
  const sec = (pl: ProfitLoss, k: string) => pl.sections.find((s) => s.key === k)!;
  // Accounts with an amount in any column, in code order.
  const linesOf = (k: string) => {
    const seen = new Map<string, { code: string | null; name: string }>();
    for (const c of cols) for (const l of sec(c.pl, k).lines) seen.set(l.accountId ?? l.name, { code: l.code, name: l.name });
    return [...seen].sort((a, b) => (a[1].code ?? "").localeCompare(b[1].code ?? "", undefined, { numeric: true }));
  };
  const amountIn = (pl: ProfitLoss, k: string, id: string) => sec(pl, k).lines.find((l) => (l.accountId ?? l.name) === id)?.amount ?? 0;
  const Row = ({ label, f, bold, indent, tone }: { label: string; f: (pl: ProfitLoss) => number; bold?: boolean; indent?: boolean; tone?: boolean }) => (
    <TableRow className={bold ? "bg-muted/40 hover:bg-muted/40" : undefined}>
      <TableCell className={`${indent ? "pl-8" : ""} ${bold ? "font-semibold" : ""}`}>{label}</TableCell>
      {cols.map((c) => {
        const v = f(c.pl);
        return (
          <TableCell key={c.key} className={`text-right tabular-nums ${bold || c.key === "total" ? "font-semibold" : ""} ${c.key === "total" ? "border-l" : ""} ${tone && v < 0 ? "text-danger-ink" : ""}`}>
            {money(v)}
          </TableCell>
        );
      })}
    </TableRow>
  );
  const section = (k: string, label: string) => (
    <>
      <Row label={label} f={(pl) => sec(pl, k).total} bold />
      {k === "cogs" && <Row label={t("billing.accounting.pnl.openingStock")} f={(pl) => pl.stock.opening} indent />}
      {linesOf(k).map(([id, l]) => (
        <Row key={id} label={l.name} f={(pl) => amountIn(pl, k, id)} indent />
      ))}
      {k === "cogs" && <Row label={t("billing.accounting.pnl.closingStock")} f={(pl) => -pl.stock.closing} indent />}
    </>
  );
  return (
    <>
      <Panel>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("billing.accounting.particulars")}</TableHead>
                {cols.map((c) => (
                  <TableHead key={c.key} className={`text-right ${c.key === "total" ? "border-l" : ""}`}>
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {section("sales", t("billing.accounting.pnl.netSales"))}
              {section("cogs", t("billing.accounting.pnl.cogs"))}
              <Row label={t("billing.accounting.pnl.grossProfit")} f={(pl) => pl.grossProfit} bold tone />
              {linesOf("otherIncome").length > 0 && section("otherIncome", t("billing.accounting.pnl.otherIncome"))}
              {section("expenses", t("billing.accounting.pnl.expenses"))}
              <Row label={t("billing.accounting.pnl.netProfit")} f={(pl) => pl.netProfit} bold tone />
            </TableBody>
          </Table>
        </div>
      </Panel>
      <p className={`mt-3 text-meta ${r.check.ok ? "text-muted-foreground" : "text-danger-ink"}`}>
        {r.check.ok ? t("billing.accounting.pnl.branchesAddUp") : t("billing.accounting.pnl.branchesDiffer", { amount: money(Math.abs(r.check.difference)) })}
      </p>
    </>
  );
}

function PnlBody({ pl, d }: { pl: ProfitLoss; d: (s: string) => string }) {
  const { t } = useI18n();
  const cmp = !!pl.compare;
  const sec = (k: string) => pl.sections.find((s) => s.key === k)!;
  const sales = sec("sales");
  const cogs = sec("cogs");
  const other = sec("otherIncome");
  const exp = sec("expenses");
  if (pl.sections.every((s) => s.lines.length === 0) && pl.stock.opening === 0 && pl.stock.closing === 0) {
    return <EmptyState className="border-0 bg-transparent" title={t("billing.accounting.pnl.emptyTitle")} description={t("billing.accounting.pnl.emptyBody")} />;
  }
  const num = (n: number | undefined) => (n === undefined ? "" : money(n));
  const Row = ({ label, a, b, bold, indent, tone }: { label: string; a: number; b?: number; bold?: boolean; indent?: boolean; tone?: boolean }) => (
    <TableRow className={bold ? "bg-muted/40 hover:bg-muted/40" : undefined}>
      <TableCell className={`${indent ? "pl-8" : ""} ${bold ? "font-semibold" : ""}`}>{label}</TableCell>
      <TableCell className={`text-right tabular-nums ${bold ? "font-semibold" : ""} ${tone && a < 0 ? "text-danger-ink" : ""}`}>{money(a)}</TableCell>
      {cmp && <TableCell className={`text-right tabular-nums ${bold ? "font-semibold" : ""} text-muted-foreground`}>{num(b)}</TableCell>}
    </TableRow>
  );
  return (
    <>
      <div className="mb-section grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[
          { label: t("billing.accounting.pnl.netSales"), v: sales.total },
          { label: t("billing.accounting.pnl.grossProfit"), v: pl.grossProfit },
          { label: t("billing.accounting.pnl.expenses"), v: exp.total },
          { label: t("billing.accounting.pnl.netProfit"), v: pl.netProfit },
        ].map((x) => (
          <Card key={x.label} className="min-w-0">
            <CardContent>
              <p className="text-meta text-muted-foreground">{x.label}</p>
              <p className={`font-heading text-xl font-semibold tabular-nums ${x.v < 0 ? "text-danger-ink" : ""}`}>{money(x.v)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Panel>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("billing.accounting.particulars")}</TableHead>
                <TableHead className="text-right">{`${d(pl.from)} - ${d(pl.to)}`}</TableHead>
                {cmp && <TableHead className="text-right">{`${d(pl.compare!.from)} - ${d(pl.compare!.to)}`}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              <Row label={t("billing.accounting.pnl.netSales")} a={sales.total} b={sales.compareTotal} bold />
              {sales.lines.map((l) => (
                <Row key={l.name} label={l.name} a={l.amount} b={l.compare} indent />
              ))}
              <Row label={t("billing.accounting.pnl.cogs")} a={cogs.total} b={cogs.compareTotal} bold />
              <Row label={t("billing.accounting.pnl.openingStock")} a={pl.stock.opening} b={pl.stock.compareOpening} indent />
              {cogs.lines.map((l) => (
                <Row key={l.name} label={l.name} a={l.amount} b={l.compare} indent />
              ))}
              <Row label={t("billing.accounting.pnl.closingStock")} a={-pl.stock.closing} b={pl.stock.compareClosing === undefined ? undefined : -pl.stock.compareClosing} indent />
              <Row label={t("billing.accounting.pnl.grossProfit")} a={pl.grossProfit} b={pl.compareGrossProfit} bold tone />
              {other.lines.length > 0 && (
                <>
                  <Row label={t("billing.accounting.pnl.otherIncome")} a={other.total} b={other.compareTotal} bold />
                  {other.lines.map((l) => (
                    <Row key={l.name} label={l.name} a={l.amount} b={l.compare} indent />
                  ))}
                </>
              )}
              <Row label={t("billing.accounting.pnl.expenses")} a={exp.total} b={exp.compareTotal} bold />
              {exp.lines.map((l) => (
                <Row key={l.name} label={l.name} a={l.amount} b={l.compare} indent />
              ))}
              <Row label={t("billing.accounting.pnl.netProfit")} a={pl.netProfit} b={pl.compareNetProfit} bold tone />
            </TableBody>
          </Table>
        </div>
      </Panel>
    </>
  );
}
