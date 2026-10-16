"use client";

import * as React from "react";
import { ModuleLink, Page, PageHeading, QueryError, SearchField, useDebounced, useI18n, useModuleNavigate, useQueryParams } from "@srirealtime/web";
import { ChevronRightIcon, PlusIcon, TruckIcon, UsersIcon } from "lucide-react";
import {
  Button,
  Card,
  cn,
  EmptyState,
  InitialsAvatar,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Stagger,
  StaggerItem,
} from "@srirealtime/ui";
import { TruckIllustration } from "../components/illustrations";
import { PurchaseStatusPill } from "../components/inventory/stock-meta";
import { compactINR, money } from "../lib/format";
import { usePurchases, useSuppliers } from "../lib/queries-v2";
import type { PurchaseSummary } from "../lib/types";

const ALL = "__all";
const supplierName = (p: PurchaseSummary) => p.supplierName ?? p.supplier?.name ?? "—";

export default function PurchasesPage() {
  return (
    <React.Suspense fallback={null}>
      <Purchases />
    </React.Suspense>
  );
}

function Purchases() {
  const { t, formatDate, formatNumber } = useI18n();
  const navigate = useModuleNavigate();
  const params = useQueryParams();
  const supplierId = params.get("supplier") ?? "";
  const [q, setQ] = React.useState("");
  const debounced = useDebounced(q.trim(), 300);
  const list = usePurchases({ q: debounced || undefined, supplierId: supplierId || undefined });
  const suppliers = useSuppliers("");
  const items = list.data?.items ?? [];

  const live = items.filter((p) => p.status !== "cancelled");
  const sum = live.reduce((s, p) => s + p.total, 0);
  const unpaid = live.filter((p) => !p.paid).reduce((s, p) => s + p.total, 0);

  const setSupplier = (v: string) => navigate(v === ALL ? "purchases" : `purchases?supplier=${encodeURIComponent(v)}`, { replace: true });
  const filtered = !!debounced || !!supplierId;

  const addButton = (
    <Button asChild size="lg">
      <ModuleLink to="purchases/new">
        <PlusIcon /> {t("billing.purchases.add")}
      </ModuleLink>
    </Button>
  );

  return (
    <Page>
      <PageHeading
        icon={TruckIcon}
        title={t("billing.purchases.title")}
        description={t("billing.purchases.subtitle")}
        actions={
          <>
            <Button asChild variant="outline" size="lg">
              <ModuleLink to="suppliers">
                <UsersIcon /> {t("billing.nav.suppliers")}
              </ModuleLink>
            </Button>
            {addButton}
          </>
        }
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_16rem]">
        <SearchField value={q} onChange={setQ} placeholder={t("billing.purchases.search")} />
        <Select value={supplierId || ALL} onValueChange={setSupplier}>
          <SelectTrigger size="lg" className="w-full rounded-xl bg-card" aria-label={t("billing.purchases.supplierFilter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value={ALL}>{t("billing.purchases.allSuppliers")}</SelectItem>
            {(suppliers.data?.items ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
            {supplierId && !suppliers.data?.items.some((s) => s.id === supplierId) && (
              <SelectItem value={supplierId}>{t("billing.purchases.thisSupplier")}</SelectItem>
            )}
          </SelectContent>
        </Select>
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
                <Skeleton className="h-3 w-24" />
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
          illustration={<TruckIllustration />}
          title={filtered ? t("billing.purchases.noMatch") : t("billing.purchases.emptyTitle")}
          description={filtered ? undefined : t("billing.purchases.emptyBody")}
          action={addButton}
        />
      ) : (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2 rounded-2xl border border-card-ring bg-card p-3 shadow-elevated" aria-live="polite">
            <Summary label={t("billing.purchases.count")} value={formatNumber(live.length)} />
            <Summary label={t("billing.purchases.totalShown")} value={compactINR(sum)} title={money(sum)} />
            <Summary label={t("billing.purchases.unpaidShown")} value={compactINR(unpaid)} title={money(unpaid)} tone={unpaid > 0 ? "text-warning-ink" : undefined} />
          </div>
          <Card className={cn("gap-0 py-1 transition-opacity", list.isPlaceholderData && "opacity-60")}>
            <Stagger key={`${debounced}-${supplierId}`} className="divide-y px-1">
              {items.map((p) => (
                <StaggerItem key={p.id}>
                  <ModuleLink
                    to={`purchases/${p.id}`}
                    className="flex min-h-16 items-center gap-3 rounded-lg px-3 py-2.5 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <InitialsAvatar name={supplierName(p)} />
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate font-medium", p.status === "cancelled" && "text-muted-foreground line-through")}>{supplierName(p)}</p>
                      <p className="mt-0.5 truncate text-meta text-muted-foreground">
                        <span className="font-mono">{p.billNumber}</span> · {formatDate(p.date)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-semibold tabular-nums">{money(p.total)}</span>
                      <PurchaseStatusPill paid={p.paid} status={p.status} />
                    </div>
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </ModuleLink>
                </StaggerItem>
              ))}
            </Stagger>
          </Card>
          {list.data && list.data.total > items.length && (
            <p className="mt-3 text-center text-meta text-muted-foreground">
              {t("billing.purchases.showing", { shown: items.length, total: list.data.total })}
            </p>
          )}
        </>
      )}
    </Page>
  );
}

function Summary({ label, value, title, tone }: { label: string; value: string; title?: string; tone?: string }) {
  return (
    <div className="min-w-0 text-center sm:text-left" title={title}>
      <p className="truncate text-[0.6875rem] text-muted-foreground sm:text-meta">{label}</p>
      <p className={cn("truncate font-heading text-lg font-bold tabular-nums", tone)}>{value}</p>
      {title && <span className="sr-only">{title}</span>}
    </div>
  );
}
