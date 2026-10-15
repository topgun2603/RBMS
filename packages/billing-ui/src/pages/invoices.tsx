"use client";

import * as React from "react";
import { ModuleLink, Page, PageHeading, QueryError, useDebounced, useI18n, useModuleNavigate, useQueryParams } from "@srirealtime/web";
import { FileTextIcon, Loader2Icon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { Button, Card, ChipGroup, cn, EmptyState, Input, Stagger, StaggerItem } from "@srirealtime/ui";
import { BillsIllustration } from "../components/illustrations";
import { InvoiceRow, InvoiceRowSkeleton } from "../components/invoice-row";
import { useInvoiceList, type InvoiceFilters } from "../lib/queries";

const FILTERS = ["", "draft", "issued", "partially_paid", "overdue", "paid", "cancelled"] as const;
type Filter = (typeof FILTERS)[number];

export default function InvoicesPage() {
  return (
    <React.Suspense fallback={null}>
      <InvoicesList />
    </React.Suspense>
  );
}

function InvoicesList() {
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const params = useQueryParams();
  const status = (FILTERS as readonly string[]).includes(params.get("status") ?? "") ? (params.get("status") as Filter) : "";
  const [q, setQ] = React.useState(params.get("q") ?? "");
  const debounced = useDebounced(q.trim(), 300);

  const setStatus = (s: Filter) => {
    const next = new URLSearchParams(params.toString());
    if (s) next.set("status", s);
    else next.delete("status");
    navigate(next.toString() ? `?${next}` : "?", { replace: true, scroll: false });
  };

  const filters: InvoiceFilters = { status, q: debounced };
  const list = useInvoiceList(filters);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total;

  // Auto-load the next page when the sentinel scrolls into view.
  const sentinel = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el || !list.hasNextPage) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !list.isFetchingNextPage) void list.fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [list.hasNextPage, list.isFetchingNextPage, list]);

  return (
    <Page className="max-w-4xl">
      <PageHeading
        icon={FileTextIcon}
        title={t("billing.invoices.title")}
        description={total !== undefined ? t("billing.invoices.count", { count: total }) : undefined}
        actions={
          <Button asChild size="lg" className="hidden sm:inline-flex">
            <ModuleLink to="invoices/new">
              <PlusIcon /> {t("billing.nav.newBill")}
            </ModuleLink>
          </Button>
        }
      />

      <div className="sticky top-14 z-20 -mx-4 mb-3 grid gap-3 bg-page/90 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label={t("billing.invoices.search")}
            placeholder={t("billing.invoices.search")}
            size="lg"
            className="rounded-xl bg-card pl-9 text-base sm:text-sm"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-1/2 right-1.5 -translate-y-1/2"
              aria-label={t("billing.common.clear")}
              onClick={() => setQ("")}
            >
              <XIcon />
            </Button>
          )}
        </div>
        <ChipGroup
          aria-label={t("billing.invoices.filter")}
          value={status || "all"}
          onChange={(v) => setStatus(v === "all" ? "" : (v as Filter))}
          options={FILTERS.map((f) => ({ value: f || "all", label: f ? t(`billing.status.${f}`) : t("billing.invoices.all") }))}
        />
      </div>

      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <Card className="gap-0 divide-y py-1">
          {Array.from({ length: 6 }, (_, i) => (
            <InvoiceRowSkeleton key={i} />
          ))}
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          illustration={<BillsIllustration />}
          title={debounced || status ? t("billing.invoices.noMatchTitle") : t("billing.invoices.emptyTitle")}
          description={debounced || status ? t("billing.invoices.noMatchBody") : t("billing.invoices.emptyBody")}
          action={
            debounced || status ? (
              <Button
                variant="outline"
                onClick={() => {
                  setQ("");
                  setStatus("");
                }}
              >
                {t("billing.invoices.clearFilters")}
              </Button>
            ) : (
              <Button asChild size="lg">
                <ModuleLink to="invoices/new">
                  <PlusIcon /> {t("billing.dashboard.firstBill")}
                </ModuleLink>
              </Button>
            )
          }
        />
      ) : (
        <Card className={cn("gap-0 py-1 transition-opacity", list.isPlaceholderData && "opacity-60")}>
          <Stagger key={`${status}|${debounced}`} className="divide-y divide-border/60 px-1.5">
            {items.map((inv) => (
              <StaggerItem key={inv.id}>
                <InvoiceRow inv={inv} />
              </StaggerItem>
            ))}
          </Stagger>
          <div ref={sentinel} />
          {list.hasNextPage && (
            <div className="flex justify-center p-3">
              <Button variant="ghost" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage && <Loader2Icon className="animate-spin" />}
                {t("billing.common.loadMore")}
              </Button>
            </div>
          )}
        </Card>
      )}
    </Page>
  );
}
