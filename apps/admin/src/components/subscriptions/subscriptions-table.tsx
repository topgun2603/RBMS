"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
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
  DataTableToolbar,
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
import { useSwitchTenant } from "@/lib/auth";
import { shopAppUrl } from "@/lib/format";
import { tOr, useI18n } from "@/lib/i18n";
import { usePlans } from "@/lib/queries";
import { useSubsT } from "@/lib/subscriptions-messages";
import type { AdminSubscription, SubscriptionStatus } from "@/lib/types";
import { useServerTable, type ServerFilterDefs } from "@/lib/use-server-table";
import { CompPlanDialog, ExtendTrialDialog, SUBS_KEY } from "./dialogs";

export const STATUSES: SubscriptionStatus[] = ["trialing", "active", "past_due", "cancelled", "expired"];
/** Provider filter values (packages/subscriptions/src/list.ts; `none` = no provider, the free plan). */
const PROVIDERS = ["razorpay", "mock", "manual", "none"] as const;

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

/**
 * Every shop's subscription, server-paged: status pills (with counts; the stats tiles above write the same `status`
 * URL param), plan / provider filters, search, sort on shop, plan, status, next date and MRR.
 */
export function SubscriptionsTable() {
  const { t, formatCurrency, formatDate } = useI18n();
  const k = useSubsT();
  const router = useRouter();
  const switchTenant = useSwitchTenant();
  const plans = usePlans(true);
  const [extend, setExtend] = React.useState<AdminSubscription | null>(null);
  const [comp, setComp] = React.useState<AdminSubscription | null>(null);

  const filters = React.useMemo(
    () =>
      ({
        // Shown as the pills below (and the stats tiles), not as a toolbar button.
        status: { kind: "options", label: k("admin.subs.filter.status"), hidden: true, options: STATUSES.map((s) => ({ value: s, label: tOr(k, `admin.subs.status.${s}`, s) })) },
        plan: { kind: "options", label: k("admin.subs.col.plan"), options: (plans.data ?? []).map((p) => ({ value: p.id, label: p.name })) },
        provider: { kind: "options", label: k("admin.subs.col.provider"), options: PROVIDERS.map((p) => ({ value: p, label: k(`admin.subs.provider.${p}`) })) },
      }) satisfies ServerFilterDefs,
    [k, plans.data],
  );

  const columns = React.useMemo<DataTableColumn<AdminSubscription>[]>(() => {
    const d = (iso: string | null) => (iso ? formatDate(iso, { day: "numeric", month: "short", year: "numeric" }) : "");
    const nextDate = (s: AdminSubscription): string => {
      if (s.authUrl) return k("admin.subs.when.awaitingMandate");
      if (s.status === "trialing" && s.trialEndsAt) return k("admin.subs.when.trialEnds", { date: d(s.trialEndsAt) });
      if (s.status === "past_due" && s.graceEndsAt) return k("admin.subs.when.grace", { date: d(s.graceEndsAt) });
      if (s.provider === "manual") return s.currentPeriodEnd ? k("admin.subs.when.compUntil", { date: d(s.currentPeriodEnd) }) : k("admin.subs.when.open");
      if (s.status === "active" && s.currentPeriodEnd) return k(s.cancelAtPeriodEnd ? "admin.subs.when.ends" : "admin.subs.when.renews", { date: d(s.currentPeriodEnd) });
      return "—";
    };
    return [
      {
        id: "shop",
        header: k("admin.subs.col.shop"),
        sortable: true,
        hideable: false,
        card: "title",
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
            </div>
          </div>
        ),
        cardCell: (s) => s.tenant?.name ?? s.tenantId.slice(0, 8),
      },
      {
        id: "plan",
        header: k("admin.subs.col.plan"),
        sortable: true,
        card: "subtitle",
        cell: (s) => (
          <div className="min-w-0">
            <Badge variant="secondary">{s.plan.name}</Badge>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {tOr(k, `admin.subs.interval.${s.interval}`, s.interval)}
              {s.pendingPlanId && <span className="block truncate">{k("admin.subs.when.pending", { plan: s.pendingPlanId })}</span>}
            </div>
          </div>
        ),
        cardCell: (s) => `${s.plan.name} · ${tOr(k, `admin.subs.interval.${s.interval}`, s.interval)}`,
      },
      { id: "status", header: k("admin.subs.col.status"), sortable: true, card: "right", cell: (s) => <SubStatusPill status={s.status} /> },
      {
        id: "next",
        header: k("admin.subs.col.renews"),
        sortable: true,
        hideBelow: "md",
        card: "meta",
        cell: (s) => <span className="whitespace-nowrap text-sm text-muted-foreground">{nextDate(s)}</span>,
      },
      {
        id: "provider",
        header: k("admin.subs.col.provider"),
        hideBelow: "lg",
        card: "meta",
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
        sortable: true,
        numeric: true,
        card: "right",
        cell: (s) => (
          <span className={s.mrrPaise > 0 ? "font-medium" : "text-muted-foreground"}>
            {s.mrrPaise > 0 ? formatCurrency(s.mrrPaise / 100, { maximumFractionDigits: 0 }) : "—"}
          </span>
        ),
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("admin.common.actions")}</span>,
        label: t("admin.common.actions"),
        hideable: false,
        align: "right",
        width: "48px",
        card: "right",
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
  }, [t, k, formatCurrency, formatDate, router, switchTenant]);

  const st = useServerTable<AdminSubscription, typeof filters>({
    queryKey: [...SUBS_KEY, "list"],
    path: "/subscriptions/admin/subscriptions",
    columns,
    filters,
    defaultSort: "-updated", // = subscriptionSort default (last changed first)
    search: k("admin.subs.search"),
    storageKey: "admin-platform-subscriptions",
    getRowId: (s) => s.id,
  });

  const status = st.filters.status;
  const counts = st.facets?.status;
  const all = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined;

  return (
    <>
      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            aria-label={k("admin.subs.filter.status")}
            size="sm"
            value={status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : ""}
            onChange={(v) => status.set(v === "all" ? [] : [v])}
            options={[
              { value: "all", label: k("admin.subs.filter.all"), meta: all },
              ...STATUSES.map((s) => ({ value: s, label: tOr(k, `admin.subs.status.${s}`, s), meta: counts ? (counts[s] ?? 0) : undefined })),
            ]}
          />
        }
      >
        {st.total !== undefined && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{k("admin.subs.count", { count: st.total })}</span>}
      </DataTableToolbar>
      <DataTable
        table={st.table}
        empty={<EmptyState compact icon={CreditCardIcon} title={k("admin.subs.empty")} description={k("admin.subs.emptyHint")} />}
      />
      <ExtendTrialDialog sub={extend} onClose={() => setExtend(null)} />
      <CompPlanDialog sub={comp} onClose={() => setComp(null)} />
    </>
  );
}
