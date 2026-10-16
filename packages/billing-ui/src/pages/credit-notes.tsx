"use client";

import * as React from "react";
import { ModuleLink, Page, PageHeading, QueryError, SearchField, useDebounced, useI18n } from "@srirealtime/web";
import { ChevronRightIcon, FileTextIcon, Undo2Icon } from "lucide-react";
import { Button, Card, ChipGroup, cn, EmptyState, InitialsAvatar, Skeleton, Stagger, StaggerItem } from "@srirealtime/ui";
import { CreditNoteStatusPill } from "../components/credit-notes/credit-note-ui";
import { compactINR, money } from "../lib/format";
import { useCreditNotes } from "../lib/queries-credit-notes";
import type { CreditNoteStatus } from "../lib/types";

export default function CreditNotesPage() {
  return (
    <React.Suspense fallback={null}>
      <CreditNotes />
    </React.Suspense>
  );
}

function CreditNotes() {
  const { t, formatDate, formatNumber } = useI18n();
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<CreditNoteStatus | "">("");
  const debounced = useDebounced(q.trim(), 300);
  const list = useCreditNotes({ q: debounced, status });
  const items = list.data?.items ?? [];
  const live = items.filter((n) => n.status === "issued");
  const credited = live.reduce((s, n) => s + n.total, 0);
  const refunded = live.reduce((s, n) => s + n.refundAmount, 0);
  const filtered = !!debounced || !!status;

  const billsButton = (
    <Button asChild variant="outline" size="lg">
      <ModuleLink to="invoices">
        <FileTextIcon /> {t("billing.cn.toBills")}
      </ModuleLink>
    </Button>
  );

  return (
    <Page>
      <PageHeading icon={Undo2Icon} title={t("billing.cn.title")} description={t("billing.cn.subtitle")} actions={billsButton} />

      <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <SearchField value={q} onChange={setQ} placeholder={t("billing.cn.search")} />
        <ChipGroup
          aria-label={t("billing.cn.statusFilter")}
          value={status || "all"}
          onChange={(v) => setStatus(v === "all" ? "" : (v as CreditNoteStatus))}
          options={[
            { value: "all", label: t("billing.cn.allStatuses") },
            { value: "issued", label: t("billing.cn.status.issued") },
            { value: "cancelled", label: t("billing.cn.status.cancelled") },
          ]}
        />
      </div>

      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <Card className="gap-0 divide-y py-1">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
              <div className="space-y-2">
                <Skeleton className="ml-auto h-4 w-20" />
                <Skeleton className="h-5 w-16" />
              </div>
            </div>
          ))}
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Undo2Icon}
          title={filtered ? t("billing.cn.noMatch") : t("billing.cn.emptyTitle")}
          description={filtered ? undefined : t("billing.cn.emptyBody")}
          action={filtered ? undefined : billsButton}
        />
      ) : (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2 rounded-2xl border border-card-ring bg-card p-3 shadow-elevated" aria-live="polite">
            <Summary label={t("billing.cn.count")} value={formatNumber(live.length)} />
            <Summary label={t("billing.cn.totalShown")} value={compactINR(credited)} title={money(credited)} />
            <Summary label={t("billing.cn.refundedShown")} value={compactINR(refunded)} title={money(refunded)} tone={refunded > 0 ? "text-warning-ink" : undefined} />
          </div>
          <Card className={cn("gap-0 py-1 transition-opacity", list.isPlaceholderData && "opacity-60")}>
            <Stagger key={`${debounced}-${status}`} className="divide-y px-1">
              {items.map((n) => (
                <StaggerItem key={n.id}>
                  <ModuleLink
                    to={`credit-notes/${n.id}`}
                    className="flex min-h-16 items-center gap-3 rounded-lg px-3 py-2.5 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <InitialsAvatar name={n.customerName} />
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate font-medium", n.status === "cancelled" && "text-muted-foreground line-through")}>{n.customerName}</p>
                      <p className="mt-0.5 truncate text-meta text-muted-foreground">
                        <span className="font-mono">{n.number}</span> · {t("billing.cn.against", { number: n.invoiceNumber })} · {formatDate(n.date)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-semibold tabular-nums">−{money(n.total)}</span>
                      <CreditNoteStatusPill status={n.status} />
                    </div>
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </ModuleLink>
                </StaggerItem>
              ))}
            </Stagger>
          </Card>
        </>
      )}
    </Page>
  );
}

function Summary({ label, value, title, tone }: { label: string; value: string; title?: string; tone?: string }) {
  return (
    <div className="min-w-0 text-center sm:text-left" title={title}>
      <p className="truncate text-xs text-muted-foreground sm:text-meta">{label}</p>
      <p className={cn("truncate font-heading text-lg font-bold tabular-nums", tone)}>{value}</p>
      {title && <span className="sr-only">{title}</span>}
    </div>
  );
}
