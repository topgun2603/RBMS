"use client";

import * as React from "react";
import { ModuleLink, useI18n } from "@srirealtime/web";
import { cn, Skeleton, Stagger, StaggerItem, Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@srirealtime/ui";
import { money } from "../../lib/format";
import type { LedgerEntry, LedgerResponse } from "../../lib/types";
import { balanceInk, ledgerTypeMeta } from "./credit-book-ui";

export interface LedgerData {
  openingBalance: number | null;
  entries: LedgerEntry[];
  closingBalance: number | null;
}

/** Accepts the ledger response shape or a bare entries array (public statement), and fills gaps. */
export function normalizeLedger(raw: Partial<LedgerResponse> | LedgerEntry[] | null | undefined): LedgerData {
  if (!raw) return { openingBalance: null, entries: [], closingBalance: null };
  const entries = (Array.isArray(raw) ? raw : (raw.entries ?? [])).filter(Boolean);
  const opening = Array.isArray(raw) ? null : typeof raw.openingBalance === "number" ? raw.openingBalance : null;
  const lastBal = entries.length ? entries[entries.length - 1]!.balance : null;
  const closing = Array.isArray(raw) ? lastBal : typeof raw.closingBalance === "number" ? raw.closingBalance : lastBal;
  return { openingBalance: opening, entries, closingBalance: closing };
}

/** Running balance as an amount + "due"/"adv." suffix (never a bare minus sign). */
function RunningBalance({ value, className }: { value: number; className?: string }) {
  const { t } = useI18n();
  return (
    <span className={cn("tabular-nums", balanceInk(value), className)}>
      {money(Math.abs(value))}
      {value !== 0 && (
        <span className="ml-1 text-[0.6875rem] font-normal opacity-80">
          {value > 0 ? t("billing.creditBook.ledger.balDue") : t("billing.creditBook.ledger.balAdvance")}
        </span>
      )}
    </span>
  );
}

function useEntryTitle() {
  const { t } = useI18n();
  return (e: LedgerEntry) => {
    const type = t.has(`billing.creditBook.ledger.types.${e.type}`) ? t(`billing.creditBook.ledger.types.${e.type}`) : e.type;
    return { type, detail: e.description || e.number || "" };
  };
}

function EntryIcon({ type, className }: { type: string; className?: string }) {
  const m = ledgerTypeMeta(type);
  const Icon = m.icon;
  return (
    <span className={cn("icon-chip size-8 print:hidden", m.tone, className)}>
      <Icon className="size-4" />
    </span>
  );
}

function Particulars({ e, linkInvoices }: { e: LedgerEntry; linkInvoices: boolean }) {
  const title = useEntryTitle()(e);
  const label = (
    <>
      <span className="font-medium">{title.type}</span>
      {e.number && <span className="text-muted-foreground"> · {e.number}</span>}
    </>
  );
  return (
    <div className="min-w-0">
      {linkInvoices && e.type === "invoice" && e.refId ? (
        <ModuleLink to={`invoices/${e.refId}`} className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
          {label}
        </ModuleLink>
      ) : (
        <span>{label}</span>
      )}
      {e.description && e.description !== e.number && <p className="mt-0.5 truncate text-meta text-muted-foreground">{e.description}</p>}
    </div>
  );
}

/** Desktop / print: Date · Particulars · Debit · Credit · Balance, with brought-forward and closing rows. */
export function LedgerTable({
  data,
  from,
  linkInvoices = true,
  ariaLabel,
  className,
}: {
  data: LedgerData;
  from?: string;
  linkInvoices?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  const { t, formatDate } = useI18n();
  const debit = data.entries.reduce((s, e) => s + (e.debit || 0), 0);
  const credit = data.entries.reduce((s, e) => s + (e.credit || 0), 0);
  return (
    <div className={className}>
      <Table aria-label={ariaLabel}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-28">{t("billing.creditBook.ledger.date")}</TableHead>
            <TableHead>{t("billing.creditBook.ledger.particulars")}</TableHead>
            <TableHead className="text-right">{t("billing.creditBook.ledger.debit")}</TableHead>
            <TableHead className="text-right">{t("billing.creditBook.ledger.credit")}</TableHead>
            <TableHead className="text-right">{t("billing.creditBook.ledger.balance")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.openingBalance !== null && from && (
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableCell className="text-muted-foreground tabular-nums">{formatDate(from)}</TableCell>
              <TableCell className="text-muted-foreground italic">
                {t("billing.creditBook.ledger.broughtForward", { date: formatDate(from) })}
              </TableCell>
              <TableCell />
              <TableCell />
              <TableCell className="text-right font-medium">
                <RunningBalance value={data.openingBalance} />
              </TableCell>
            </TableRow>
          )}
          {data.entries.map((e, i) => (
            <TableRow key={`${e.date}-${e.type}-${e.refId ?? i}-${i}`}>
              <TableCell className="align-top text-muted-foreground tabular-nums">{formatDate(e.date)}</TableCell>
              <TableCell className="max-w-[22rem] whitespace-normal">
                <div className="flex items-start gap-2.5">
                  <EntryIcon type={e.type} className="size-7" />
                  <Particulars e={e} linkInvoices={linkInvoices} />
                </div>
              </TableCell>
              <TableCell className="text-right align-top tabular-nums">{e.debit ? money(e.debit) : ""}</TableCell>
              <TableCell className="text-right align-top text-success-ink tabular-nums">{e.credit ? money(e.credit) : ""}</TableCell>
              <TableCell className="text-right align-top font-medium">
                <RunningBalance value={e.balance} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        {data.closingBalance !== null && (
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={2} className="font-semibold">
                {t("billing.creditBook.ledger.closing")}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{money(debit)}</TableCell>
              <TableCell className="text-right font-semibold text-success-ink tabular-nums">{money(credit)}</TableCell>
              <TableCell className="text-right font-bold">
                <RunningBalance value={data.closingBalance} />
              </TableCell>
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}

/** Phones: a vertical timeline, newest first, each entry with ± amount and the running balance. */
export function LedgerTimeline({
  data,
  from,
  linkInvoices = true,
  ariaLabel,
  className,
}: {
  data: LedgerData;
  from?: string;
  linkInvoices?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  const { t, formatDate } = useI18n();
  const entries = [...data.entries].reverse();
  return (
    <div className={className}>
      <Stagger role="list" aria-label={ariaLabel} className="relative">
        <span aria-hidden className="absolute top-4 bottom-4 left-[1.0625rem] w-px bg-border" />
        {entries.map((e, i) => {
          const amount = e.debit || e.credit;
          const isCredit = !e.debit && !!e.credit;
          return (
            <StaggerItem key={`${e.date}-${e.type}-${e.refId ?? i}-${i}`} role="listitem" className="relative flex gap-3 py-2.5">
              <EntryIcon type={e.type} className="relative z-10 size-9 bg-card" />
              <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <Particulars e={e} linkInvoices={linkInvoices} />
                  <p className="text-meta text-muted-foreground tabular-nums">{formatDate(e.date)}</p>
                </div>
                <div className="shrink-0 text-right">
                  {amount ? (
                    <p className={cn("font-semibold tabular-nums", isCredit ? "text-success-ink" : "text-foreground")}>
                      <span className="sr-only">{isCredit ? t("billing.creditBook.ledger.received") : t("billing.creditBook.ledger.billed")} </span>
                      <span aria-hidden>{isCredit ? "− " : "+ "}</span>
                      {money(amount)}
                    </p>
                  ) : null}
                  <p className="text-meta text-muted-foreground">
                    {t("billing.creditBook.ledger.balance")} <RunningBalance value={e.balance} className="text-xs" />
                  </p>
                </div>
              </div>
            </StaggerItem>
          );
        })}
        {data.openingBalance !== null && from && (
          <StaggerItem role="listitem" className="relative flex gap-3 py-2.5">
            <EntryIcon type="opening" className="relative z-10 size-9 bg-card" />
            <div className="flex min-w-0 flex-1 items-center justify-between gap-3 text-sm">
              <p className="text-muted-foreground italic">{t("billing.creditBook.ledger.broughtForward", { date: formatDate(from) })}</p>
              <RunningBalance value={data.openingBalance} className="text-sm font-medium" />
            </div>
          </StaggerItem>
        )}
      </Stagger>
    </div>
  );
}

export function LedgerSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-3">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="flex flex-col items-end gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}
