"use client";

import * as React from "react";
import { CalendarDaysIcon } from "lucide-react";
import { ChipGroup, EmptyState, Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@rbms/ui";
import { QueryError, useI18n } from "@rbms/web";
import { EntryDialog, useKindLabel } from "../components/accounting/entry-dialog";
import { AccountingPage, Amt, Panel, ReportBar, TableSkeleton } from "../components/accounting/parts";
import { useEntries, type Entry } from "../lib/accounting";
import { addDays, money, todayIST } from "../lib/format";

type Kind = "all" | "manual" | "auto";

/** Day book: every entry of the days you pick, in order, with its debit and credit lines. */
export default function AccountingDayBookPage() {
  const { t, formatDate } = useI18n();
  const kind = useKindLabel();
  const [to, setTo] = React.useState(todayIST());
  const [from, setFrom] = React.useState(addDays(todayIST(), -6));
  const [origin, setOrigin] = React.useState<Kind>("all");
  const [open, setOpen] = React.useState<Entry | null>(null);
  const list = useEntries({ from, to, origin: origin === "all" ? undefined : origin, sort: "date", limit: 100, offset: 0 });
  const items = list.data?.items ?? [];

  const byDate = React.useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of items) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return [...m];
  }, [items]);

  return (
    <AccountingPage title={t("billing.accounting.nav.dayBook")} description={t("billing.accounting.dayBook.subtitle")} icon={CalendarDaysIcon}>
      <ReportBar report="day-book" params={{ from, to, origin: origin === "all" ? undefined : origin }} from={from} to={to} onFrom={setFrom} onTo={setTo}>
        <ChipGroup
          size="sm"
          aria-label={t("billing.accounting.journal.show")}
          value={origin}
          onChange={setOrigin}
          options={[
            { value: "all", label: t("billing.accounting.all") },
            { value: "manual", label: t("billing.accounting.journal.mine") },
            { value: "auto", label: t("billing.accounting.journal.automatic") },
          ]}
        />
      </ReportBar>
      {list.isError && !list.data ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <TableSkeleton />
      ) : items.length === 0 ? (
        <EmptyState className="border-0 bg-transparent" title={t("billing.accounting.journal.emptyTitle")} description={t("billing.accounting.dayBook.emptyBody")} />
      ) : (
        <Panel>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("billing.accounting.particulars")}</TableHead>
                  <TableHead className="text-right">{t("billing.accounting.debit")}</TableHead>
                  <TableHead className="text-right">{t("billing.accounting.credit")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byDate.map(([date, entries]) => (
                  <React.Fragment key={date}>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={3} className="py-2 font-semibold">
                        {formatDate(date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                      </TableCell>
                    </TableRow>
                    {entries.map((e) => (
                      <React.Fragment key={e.id}>
                        <TableRow className="cursor-pointer" onClick={() => setOpen(e)}>
                          <TableCell colSpan={3} className="pb-0">
                            <span className="font-mono text-xs text-muted-foreground">{e.number}</span> <span className="font-medium">{e.narration}</span>
                            <span className="ml-2 text-meta text-muted-foreground">{kind(e)}</span>
                            {e.status === "reversed" && <span className="ml-2 text-meta text-muted-foreground">({t("billing.accounting.entry.reversed")})</span>}
                          </TableCell>
                        </TableRow>
                        {e.lines.map((l) => (
                          <TableRow key={l.id} className="border-0 hover:bg-transparent">
                            <TableCell className={l.credit > 0 ? "py-1 pl-10" : "py-1 pl-4"}>
                              {l.credit > 0 ? `${t("billing.accounting.to")} ` : ""}
                              {l.accountName}
                            </TableCell>
                            <TableCell className="py-1 text-right">
                              <Amt v={l.debit} />
                            </TableCell>
                            <TableCell className="py-1 text-right">
                              <Amt v={l.credit} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </React.Fragment>
                    ))}
                  </React.Fragment>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">{t("billing.accounting.dayBook.total", { count: list.data?.total ?? 0 })}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{money(items.reduce((s, e) => s + e.lines.reduce((a, l) => a + l.debit, 0), 0))}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{money(items.reduce((s, e) => s + e.lines.reduce((a, l) => a + l.credit, 0), 0))}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
          {(list.data?.total ?? 0) > items.length && <p className="p-4 text-meta text-muted-foreground">{t("billing.accounting.dayBook.more", { shown: items.length, total: list.data?.total ?? 0 })}</p>}
        </Panel>
      )}
      <EntryDialog entry={open} onClose={() => setOpen(null)} />
    </AccountingPage>
  );
}
