"use client";

import * as React from "react";
import { ModuleLink, Page, PageHeading, QueryError, SearchField, useDebounced, useFeature, useI18n } from "@srirealtime/web";
import { BellRingIcon, HandCoinsIcon, Loader2Icon, NotebookTabsIcon, PiggyBankIcon, PlusIcon, UsersRoundIcon, WalletIcon } from "lucide-react";
import { Button, Card, ChipGroup, cn, EmptyState, InitialsAvatar, Skeleton, Stagger, StaggerItem } from "@srirealtime/ui";
import { StatTile } from "../components/charts/stat-tile";
import { CustomerDialog } from "../components/customer-dialog";
import { CreditBookIllustration } from "../components/illustrations";
import { BalancePill, balanceInk, OverduePill, useRemind } from "../components/credit-book/credit-book-ui";
import { ReceiveDialog } from "../components/credit-book/receive-dialog";
import { money } from "../lib/format";
import { useCreditBook } from "../lib/queries-v2";
import type { Customer, CreditBookFilter, CreditBookRow } from "../lib/types";

const FILTERS: CreditBookFilter[] = ["due", "advance", "all"];

export default function CreditBookPage() {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<CreditBookFilter>("due");
  const debounced = useDebounced(q.trim(), 300);
  const creditBook = useCreditBook(debounced, filter);
  const remind = useRemind();
  const whatsapp = useFeature("invoices.whatsapp");
  const [receiving, setReceiving] = React.useState<Pick<Customer, "id" | "name" | "outstanding"> | null>(null);
  const [adding, setAdding] = React.useState(false);

  const items = creditBook.data?.items ?? [];
  const totals = creditBook.data?.totals;

  return (
    <Page className="max-w-5xl">
      <PageHeading
        icon={NotebookTabsIcon}
        title={t("billing.creditBook.title")}
        description={t("billing.creditBook.description")}
        actions={
          <Button asChild variant="outline" size="lg" className="h-11">
            <ModuleLink to="customers">
              <UsersRoundIcon /> {t("billing.nav.customers")}
            </ModuleLink>
          </Button>
        }
      />

      {/* Totals on a branded band */}
      <section
        aria-label={t("billing.creditBook.totals.aria")}
        className="hero-band relative mb-5 overflow-hidden rounded-2xl p-3 shadow-raised sm:p-4"
      >
        <div aria-hidden className="hero-dots pointer-events-none absolute inset-0" />
        <div className="relative grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile
            variant="hero"
            className="col-span-2 sm:col-span-1"
            label={t("billing.creditBook.totals.receivable")}
            value={totals?.receivable}
            icon={HandCoinsIcon}
            loading={!totals && creditBook.isPending}
          />
          <StatTile
            variant="hero"
            label={t("billing.creditBook.totals.advance")}
            value={totals?.advance}
            icon={PiggyBankIcon}
            loading={!totals && creditBook.isPending}
          />
          <StatTile
            variant="hero"
            kind="count"
            label={t("billing.creditBook.totals.customersWithDues")}
            value={totals?.customersWithDues}
            icon={UsersRoundIcon}
            loading={!totals && creditBook.isPending}
          />
        </div>
      </section>

      <div className="mb-3 grid gap-3 sm:flex sm:items-center sm:justify-between">
        <ChipGroup
          aria-label={t("billing.creditBook.filter.label")}
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({
            value: f,
            label: t(`billing.creditBook.filter.${f}`),
            meta: f === "due" && totals ? totals.customersWithDues : undefined,
          }))}
        />
        <SearchField value={q} onChange={setQ} placeholder={t("billing.creditBook.search")} className="sm:w-72" />
      </div>

      {creditBook.isError ? (
        <QueryError error={creditBook.error} onRetry={() => void creditBook.refetch()} />
      ) : creditBook.isPending ? (
        <Card className="gap-0 divide-y py-1">
          {Array.from({ length: 6 }, (_, i) => (
            <CreditBookRowSkeleton key={i} />
          ))}
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          illustration={<CreditBookIllustration />}
          title={
            debounced
              ? t("billing.creditBook.empty.noMatch")
              : t(filter === "due" ? "billing.creditBook.empty.dueTitle" : filter === "advance" ? "billing.creditBook.empty.advanceTitle" : "billing.creditBook.empty.allTitle")
          }
          description={
            debounced
              ? t("billing.creditBook.empty.noMatchBody")
              : t(filter === "due" ? "billing.creditBook.empty.dueBody" : filter === "advance" ? "billing.creditBook.empty.advanceBody" : "billing.creditBook.empty.allBody")
          }
          action={
            filter !== "all" ? (
              <Button variant="outline" size="lg" className="h-11" onClick={() => setFilter("all")}>
                {t("billing.creditBook.empty.showAll")}
              </Button>
            ) : !debounced ? (
              <Button size="lg" className="h-11" onClick={() => setAdding(true)}>
                <PlusIcon /> {t("billing.customers.add")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className={cn("gap-0 py-1 transition-opacity", creditBook.isPlaceholderData && "opacity-60")}>
          <Stagger key={`${filter}-${debounced}`} className="divide-y" role="list">
            {items.map((row) => (
              <StaggerItem key={row.customer.id} role="listitem">
                <CreditBookListRow
                  row={row}
                  reminding={remind.pendingId === row.customer.id}
                  onReceive={() => setReceiving({ ...row.customer, outstanding: row.balance })}
                  onRemind={whatsapp ? () => remind.send(row.customer, row.balance) : undefined}
                />
              </StaggerItem>
            ))}
          </Stagger>
        </Card>
      )}

      {receiving && <ReceiveDialog customer={receiving} open={!!receiving} onOpenChange={(o) => !o && setReceiving(null)} />}
      <CustomerDialog open={adding} onOpenChange={setAdding} />
    </Page>
  );
}

function CreditBookListRow({
  row,
  reminding,
  onReceive,
  onRemind,
}: {
  row: CreditBookRow;
  reminding: boolean;
  onReceive: () => void;
  /** Undefined when WhatsApp/SMS sending is off for the shop. */
  onRemind?: () => void;
}) {
  const { t, formatDate } = useI18n();
  const c = row.customer;
  return (
    <div className="flex items-center gap-1 px-1 sm:gap-2 sm:px-2">
      <ModuleLink
        to={`customers/${c.id}`}
        className="group flex min-h-[4.5rem] min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2.5 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring sm:px-3"
      >
        <InitialsAvatar name={c.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{c.name}</p>
          <p className="truncate text-xs text-muted-foreground tabular-nums">
            {[c.phone, row.lastActivity ? t("billing.creditBook.lastActivity", { date: formatDate(row.lastActivity) }) : t("billing.creditBook.noActivity")]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="mt-1 flex flex-wrap gap-1 sm:hidden">
            <OverduePill overdue={row.overdue} />
          </div>
        </div>
        <div className="hidden sm:block">
          <OverduePill overdue={row.overdue} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn("font-heading font-semibold tabular-nums", balanceInk(row.balance))}>{money(Math.abs(row.balance))}</span>
          <BalancePill balance={row.balance} />
        </div>
      </ModuleLink>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="outline"
          className="size-11 p-0 sm:h-10 sm:w-auto sm:px-3"
          onClick={onReceive}
          aria-label={t("billing.creditBook.receiveFor", { name: c.name })}
        >
          <WalletIcon />
          <span className="hidden sm:inline">{t("billing.creditBook.receive")}</span>
        </Button>
        {row.balance > 0 && onRemind && (
          <Button
            variant="ghost"
            className="size-11 p-0 sm:h-10 sm:w-auto sm:px-3"
            onClick={onRemind}
            disabled={reminding}
            aria-label={t("billing.creditBook.remindFor", { name: c.name })}
          >
            {reminding ? <Loader2Icon className="animate-spin" /> : <BellRingIcon />}
            <span className="hidden sm:inline">{t("billing.creditBook.remind")}</span>
          </Button>
        )}
      </div>
    </div>
  );
}

function CreditBookRowSkeleton() {
  return (
    <div className="flex min-h-[4.5rem] items-center gap-3 px-4 py-3">
      <Skeleton className="size-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-28" />
      </div>
      <div className="flex flex-col items-end gap-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <Skeleton className="size-10 rounded-lg" />
    </div>
  );
}
