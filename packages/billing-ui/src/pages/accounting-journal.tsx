"use client";

import * as React from "react";
import { BookTextIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, SearchIcon } from "lucide-react";
import { Button, ChipGroup, EmptyState, Input, StatusPill, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@rbms/ui";
import { ModuleLink, QueryError, useI18n } from "@rbms/web";
import { EntryDialog, useKindLabel } from "../components/accounting/entry-dialog";
import { AccountingPage, Panel, TableSkeleton } from "../components/accounting/parts";
import { DateRangePicker, initialRange, type DateRangeValue } from "../components/date-range-picker";
import { ACC_POST, useEntries, type Entry } from "../lib/accounting";
import { useHasPermission } from "../lib/access";
import { money } from "../lib/format";

type Kind = "all" | "manual" | "auto";
const PAGE = 25;

/** Journal entries: the ones you post by hand and the ones made from your bills, purchases, payments and expenses. */
export default function AccountingJournalPage() {
  const { t, formatDate } = useI18n();
  const canPost = useHasPermission(ACC_POST);
  const kind = useKindLabel();
  const [range, setRange] = React.useState<DateRangeValue>(() => initialRange("thisFY"));
  const [origin, setOrigin] = React.useState<Kind>("all");
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [offset, setOffset] = React.useState(0);
  const [open, setOpen] = React.useState<Entry | null>(null);

  React.useEffect(() => {
    const h = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(h);
  }, [q]);
  React.useEffect(() => setOffset(0), [range.from, range.to, origin, debounced]);

  const list = useEntries({ from: range.from, to: range.to, origin: origin === "all" ? undefined : origin, q: debounced || undefined, sort: "-date", limit: PAGE, offset });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  return (
    <AccountingPage
      title={t("billing.accounting.nav.journal")}
      description={t("billing.accounting.journal.subtitle")}
      icon={BookTextIcon}
      actions={
        canPost ? (
          <Button asChild size="lg">
            <ModuleLink to="accounting/journal/new">
              <PlusIcon /> {t("billing.accounting.nav.newEntry")}
            </ModuleLink>
          </Button>
        ) : undefined
      }
    >
      <div className="mb-4 grid gap-3">
        <DateRangePicker value={range} onChange={setRange} />
        <div className="flex flex-wrap items-center gap-3">
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
          <div className="relative ml-auto w-full sm:w-64">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input className="pl-9" placeholder={t("billing.accounting.journal.search")} aria-label={t("billing.accounting.journal.search")} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </div>

      {list.isError && !list.data ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <TableSkeleton />
      ) : items.length === 0 ? (
        <EmptyState className="border-0 bg-transparent" title={t("billing.accounting.journal.emptyTitle")} description={t("billing.accounting.journal.emptyBody")} />
      ) : (
        <Panel>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("billing.accounting.date")}</TableHead>
                  <TableHead>{t("billing.accounting.entryNo")}</TableHead>
                  <TableHead>{t("billing.accounting.what")}</TableHead>
                  <TableHead className="text-right">{t("billing.accounting.amount")}</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((e) => (
                  <TableRow key={e.id} className="cursor-pointer" onClick={() => setOpen(e)}>
                    <TableCell className="whitespace-nowrap">{formatDate(e.date, { day: "numeric", month: "short" })}</TableCell>
                    <TableCell className="font-mono text-xs">
                      <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => setOpen(e)}>
                        {e.number}
                      </button>
                    </TableCell>
                    <TableCell className="max-w-96">
                      <span className="block truncate font-medium">{e.narration}</span>
                      <span className="block text-meta text-muted-foreground">{kind(e)}</span>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{money(e.total)}</TableCell>
                    <TableCell className="text-right">
                      {e.status === "reversed" && <StatusPill tone="neutral">{t("billing.accounting.entry.reversed")}</StatusPill>}
                      {e.voucherType === "reversal" && <StatusPill tone="warning">{t("billing.accounting.voucher.reversal")}</StatusPill>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-meta text-muted-foreground">
            <span>{t("billing.accounting.pageOf", { from: offset + 1, to: Math.min(offset + PAGE, total), total })}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} aria-label={t("billing.accounting.prev")}>
                <ChevronLeftIcon />
              </Button>
              <Button size="sm" variant="outline" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)} aria-label={t("billing.accounting.next")}>
                <ChevronRightIcon />
              </Button>
            </div>
          </div>
        </Panel>
      )}
      <EntryDialog entry={open} onClose={() => setOpen(null)} />
    </AccountingPage>
  );
}
