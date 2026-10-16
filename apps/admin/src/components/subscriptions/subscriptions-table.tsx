"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  CircleSlashIcon,
  CreditCardIcon,
  ExternalLinkIcon,
  GiftIcon,
  HourglassIcon,
  LayoutDashboardIcon,
  MoreHorizontalIcon,
  ShieldCheckIcon,
} from "lucide-react";
import {
  Badge,
  Button,
  ChipGroup,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  StatusPill,
  type DataTableColumn,
  type StatusTone,
} from "@srirealtime/ui";
import { QueryError } from "@/components/query-state";
import { DebouncedSearch } from "@/components/search-input";
import { api } from "@/lib/api";
import { useSwitchTenant } from "@/lib/auth";
import { shopAppUrl } from "@/lib/format";
import { tOr, useI18n } from "@/lib/i18n";
import { useSubsT } from "@/lib/subscriptions-messages";
import type { AdminSubscription, Paged, SubscriptionStats, SubscriptionStatus } from "@/lib/types";
import { CompPlanDialog, ExtendTrialDialog, SUBS_KEY } from "./dialogs";

const PAGE = 25;
export const STATUSES: SubscriptionStatus[] = ["trialing", "active", "past_due", "cancelled", "expired"];

const STATUS_STYLE: Record<SubscriptionStatus, { tone: StatusTone; icon: typeof HourglassIcon }> = {
  trialing: { tone: "info", icon: HourglassIcon },
  active: { tone: "success", icon: ShieldCheckIcon },
  past_due: { tone: "danger", icon: AlertTriangleIcon },
  cancelled: { tone: "neutral", icon: CircleSlashIcon },
  expired: { tone: "neutral", icon: CircleSlashIcon },
};

export function SubStatusPill({ status }: { status: SubscriptionStatus }) {
  const k = useSubsT();
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.expired;
  return (
    <StatusPill tone={s.tone} icon={s.icon}>
      {tOr(k, `admin.subs.status.${status}`, status)}
    </StatusPill>
  );
}

/** Trial extension makes sense for trials, ended subscriptions and free/comp shops (the API refuses paying ones). */
const canExtend = (s: AdminSubscription) => s.status !== "past_due" && !(s.status === "active" && (s.provider === "razorpay" || s.provider === "mock"));

export function SubscriptionsTable({
  status,
  onStatus,
  stats,
}: {
  status: SubscriptionStatus | "all";
  onStatus: (s: SubscriptionStatus | "all") => void;
  stats: SubscriptionStats | undefined;
}) {
  const { t, formatCurrency, formatDate } = useI18n();
  const k = useSubsT();
  const router = useRouter();
  const switchTenant = useSwitchTenant();
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [extend, setExtend] = React.useState<AdminSubscription | null>(null);
  const [comp, setComp] = React.useState<AdminSubscription | null>(null);
  React.useEffect(() => setPage(0), [status]);

  const list = useQuery({
    queryKey: [...SUBS_KEY, "list", status, q, page],
    queryFn: () =>
      api.get<Paged<AdminSubscription>>("/subscriptions/admin/subscriptions", { status: status === "all" ? undefined : status, q, limit: PAGE, offset: page * PAGE }, { tenant: null }),
    placeholderData: keepPreviousData,
  });

  const d = (iso: string | null) => (iso ? formatDate(iso, { day: "numeric", month: "short", year: "numeric" }) : "");
  const nextDate = (s: AdminSubscription): string => {
    if (s.authUrl) return k("admin.subs.when.awaitingMandate");
    if (s.status === "trialing" && s.trialEndsAt) return k("admin.subs.when.trialEnds", { date: d(s.trialEndsAt) });
    if (s.status === "past_due" && s.graceEndsAt) return k("admin.subs.when.grace", { date: d(s.graceEndsAt) });
    if (s.provider === "manual") return s.currentPeriodEnd ? k("admin.subs.when.compUntil", { date: d(s.currentPeriodEnd) }) : k("admin.subs.when.open");
    if (s.status === "active" && s.currentPeriodEnd) return k(s.cancelAtPeriodEnd ? "admin.subs.when.ends" : "admin.subs.when.renews", { date: d(s.currentPeriodEnd) });
    return "—";
  };
  const counts: Partial<Record<SubscriptionStatus, number>> = stats
    ? { trialing: stats.trialing, active: stats.active + stats.comp + stats.free, past_due: stats.pastDue, cancelled: stats.cancelled, expired: stats.expired }
    : {};

  const columns: DataTableColumn<AdminSubscription>[] = [
    {
      id: "shop",
      header: k("admin.subs.col.shop"),
      cell: (s) => (
        <div className="flex max-w-[10.5rem] min-w-0 items-center gap-3 sm:max-w-xs">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-sm font-semibold text-primary">
            {Array.from(s.tenant?.name ?? "?")[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">{s.tenant?.name ?? s.tenantId.slice(0, 8)}</div>
            <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
              <span className="font-mono">{s.tenant?.slug ?? "—"}</span>
              {s.tenant?.appId && <span className="rounded bg-muted px-1 font-mono text-[0.625rem]">{s.tenant.appId}</span>}
            </div>
            <div className="truncate text-xs text-muted-foreground sm:hidden">
              {s.plan.name} · {tOr(k, `admin.subs.interval.${s.interval}`, s.interval)}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "plan",
      header: k("admin.subs.col.plan"),
      hideBelow: "sm",
      cell: (s) => (
        <div className="min-w-0">
          <Badge variant="secondary">{s.plan.name}</Badge>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {tOr(k, `admin.subs.interval.${s.interval}`, s.interval)}
            {s.pendingPlanId && <span className="block truncate">{k("admin.subs.when.pending", { plan: s.pendingPlanId })}</span>}
          </div>
        </div>
      ),
    },
    {
      id: "status",
      header: k("admin.subs.col.status"),
      cell: (s) => (
        <div className="grid justify-items-start gap-1">
          <SubStatusPill status={s.status} />
          <span className="max-w-[8.5rem] truncate text-xs text-muted-foreground md:hidden">{nextDate(s)}</span>
        </div>
      ),
    },
    { id: "next", header: k("admin.subs.col.renews"), hideBelow: "md", cell: (s) => <span className="whitespace-nowrap text-sm text-muted-foreground">{nextDate(s)}</span> },
    {
      id: "provider",
      header: k("admin.subs.col.provider"),
      hideBelow: "lg",
      cell: (s) => (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          {s.provider === "manual" ? <GiftIcon className="size-3.5" /> : <CreditCardIcon className="size-3.5" />}
          {k(`admin.subs.provider.${s.provider ?? "none"}`)}
        </span>
      ),
    },
    {
      id: "mrr",
      header: k("admin.subs.col.mrr"),
      align: "right",
      hideBelow: "sm",
      cell: (s) => (
        <span className={s.mrrPaise > 0 ? "font-medium tabular-nums" : "text-muted-foreground tabular-nums"}>
          {s.mrrPaise > 0 ? formatCurrency(s.mrrPaise / 100, { maximumFractionDigits: 0 }) : "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("admin.common.actions")}</span>,
      align: "right",
      width: "48px",
      cell: (s) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("admin.common.actions")}>
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem disabled={!canExtend(s)} onSelect={() => setExtend(s)}>
              <HourglassIcon /> {k("admin.subs.action.extend")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setComp(s)}>
              <GiftIcon /> {k("admin.subs.action.comp")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {s.tenant && (
              <DropdownMenuItem asChild>
                <a href={shopAppUrl(s.tenant.slug, s.tenant.appId)} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon /> {k("admin.subs.action.open")}
                </a>
              </DropdownMenuItem>
            )}
            {s.tenant && (
              <DropdownMenuItem
                onSelect={() => {
                  switchTenant(s.tenant!.slug);
                  router.push("/");
                }}
              >
                <LayoutDashboardIcon /> {k("admin.subs.action.workspace")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <>
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center">
        <ChipGroup
          aria-label={k("admin.subs.filter.status")}
          size="sm"
          value={status}
          onChange={onStatus}
          options={[
            { value: "all" as const, label: k("admin.subs.filter.all"), meta: stats?.total },
            ...STATUSES.map((s) => ({ value: s, label: tOr(k, `admin.subs.status.${s}`, s), meta: counts[s] })),
          ]}
        />
        <div className="flex items-center gap-2 lg:ml-auto">
          <DebouncedSearch
            placeholder={k("admin.subs.search")}
            onSearch={(v) => {
              setQ(v);
              setPage(0);
            }}
          />
          {list.data?.total !== undefined && <span className="shrink-0 text-xs text-muted-foreground">{k("admin.subs.count", { count: list.data.total })}</span>}
        </div>
      </div>
      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={list.data?.items}
          loading={list.isLoading}
          getRowId={(s) => s.id}
          pagination={{ page, pageSize: PAGE, total: list.data?.total, onPageChange: setPage }}
          labels={{
            previous: t("admin.table.previous"),
            next: t("admin.table.next"),
            range: ({ from, to, total }) => (total !== undefined ? t("admin.table.range", { from, to, total }) : t("admin.table.rangeOpen", { from, to })),
          }}
          empty={<EmptyState compact icon={CreditCardIcon} title={q ? t("admin.common.noResults") : k("admin.subs.empty")} description={q ? undefined : k("admin.subs.emptyHint")} />}
        />
      )}
      <ExtendTrialDialog sub={extend} onClose={() => setExtend(null)} />
      <CompPlanDialog sub={comp} onClose={() => setComp(null)} />
    </>
  );
}
