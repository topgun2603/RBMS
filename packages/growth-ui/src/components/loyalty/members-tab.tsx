"use client";

import * as React from "react";
import { CoinsIcon, CrownIcon, DownloadIcon, GiftIcon, Loader2Icon, UsersIcon, WalletIcon } from "lucide-react";
import {
  AnimatedNumber,
  Button,
  DataTable,
  DataTableToolbar,
  EmptyState,
  InitialsAvatar,
  Skeleton,
  StatCard,
  StatusPill,
  toast,
  type DataTableColumn,
} from "@srirealtime/ui";
import { describeError, ModuleLink, QueryError, useI18n, useModuleNavigate, useServerTable, type ServerFilterDefs } from "@srirealtime/web";
import { displayPhone, money, num } from "../../lib/format";
import { downloadMembersCsv, lk, MEMBERS_DEFAULT_SORT, useLoyaltySettings, useLoyaltySummary } from "../../lib/queries/loyalty";
import type { LoyaltyMember, LoyaltyTier } from "../../lib/types";
import { GROWTH_ROUTES } from "../../module";

/** Members tab: shop totals (server sums) and the server-paged members table. */
export function MembersTab() {
  const { t } = useI18n();
  const settings = useLoyaltySettings();
  const summary = useLoyaltySummary();
  const s = summary.data;

  return (
    <div className="grid gap-section">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          title={t("growth.loyalty.statMembers")}
          value={s ? <AnimatedNumber value={s.members} from={0} format={(n) => num(Math.round(n))} /> : "—"}
          icon={UsersIcon}
          loading={summary.isPending}
        />
        <StatCard
          title={t("growth.widgets.liability")}
          value={s ? <AnimatedNumber value={s.liability} from={0} format={(n) => money(Math.round(n))} /> : "—"}
          description={t("growth.widgets.liabilityHint")}
          icon={WalletIcon}
          loading={summary.isPending}
        />
        <StatCard
          className="col-span-2 lg:col-span-1"
          title={t("growth.loyalty.statPoints")}
          value={s ? <AnimatedNumber value={s.points} from={0} format={(n) => num(Math.round(n))} /> : "—"}
          icon={CoinsIcon}
          loading={summary.isPending}
        />
      </div>

      {/* The tier filter's options come from the settings; the table reads its URL state once they are known. */}
      {settings.data ? (
        <MembersTable tiers={settings.data.tiers} />
      ) : settings.isError ? (
        <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <div className="grid gap-3">
          <Skeleton className="h-10 w-full max-w-sm" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      )}
    </div>
  );
}

function MembersTable({ tiers }: { tiers: readonly LoyaltyTier[] }) {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();

  const filters = React.useMemo(
    () =>
      ({
        tier: {
          kind: "options",
          label: t("growth.loyalty.tier"),
          icon: CrownIcon,
          options: [...tiers].sort((a, b) => a.minSpend - b.minSpend).map((x) => ({ value: x.name, label: x.name })),
          dynamic: true,
        },
      }) satisfies ServerFilterDefs,
    [t, tiers],
  );

  const columns = React.useMemo<DataTableColumn<LoyaltyMember>[]>(
    () => [
      {
        id: "name",
        header: t("growth.loyalty.member"),
        sortable: true,
        hideable: false,
        card: "title",
        cell: (m) => (
          <span className="flex min-w-0 items-center gap-3">
            <InitialsAvatar name={m.name ?? m.memberKey} size="sm" />
            <span className="min-w-0">
              <ModuleLink to={GROWTH_ROUTES.member(m.id)} className="block truncate font-medium outline-none hover:text-primary hover:underline focus-visible:underline">
                {m.name || t("growth.loyalty.noName")}
              </ModuleLink>
              <span className="block text-xs text-muted-foreground tabular-nums">{displayPhone(m.memberKey)}</span>
            </span>
          </span>
        ),
        cardCell: (m) => m.name || t("growth.loyalty.noName"),
      },
      {
        id: "tier",
        header: t("growth.loyalty.tier"),
        sortable: true,
        card: "subtitle",
        cardCell: (m) => `${displayPhone(m.memberKey)} · ${m.tier}`,
        cell: (m) => (
          <StatusPill tone="brand" icon={CrownIcon}>
            {m.tier}
          </StatusPill>
        ),
      },
      {
        id: "points",
        header: t("growth.loyalty.balance"),
        sortable: true,
        numeric: true,
        card: "right",
        cell: (m) => (
          <span className="grid justify-items-end leading-tight">
            <span className="font-semibold tabular-nums">{t("growth.loyalty.pointsN", { n: num(m.pointsBalance) })}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{money(m.pointsValue)}</span>
          </span>
        ),
        cardCell: (m) => t("growth.loyalty.pointsN", { n: num(m.pointsBalance) }),
      },
      {
        id: "spend",
        header: t("growth.loyalty.lifetimeSpend"),
        sortable: true,
        numeric: true,
        card: "right",
        cell: (m) => money(m.lifetimeSpend),
      },
      {
        id: "lastActivity",
        header: t("growth.loyalty.lastActivity"),
        sortable: true,
        sortDescFirst: true,
        card: "meta",
        cell: (m) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(m.lastActivityAt ?? m.joinedAt)}</span>,
      },
      {
        id: "joined",
        header: t("growth.loyalty.joinedCol"),
        sortable: true,
        sortDescFirst: true,
        defaultHidden: true,
        cell: (m) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(m.joinedAt)}</span>,
      },
    ],
    [t, formatDate],
  );

  const st = useServerTable<LoyaltyMember, typeof filters>({
    queryKey: [...lk.members, "table"],
    path: "/loyalty/members",
    columns,
    filters,
    defaultSort: MEMBERS_DEFAULT_SORT,
    defaultPageSize: 50,
    search: t("growth.loyalty.searchPlaceholder"),
    storageKey: "growth-loyalty-members",
    getRowId: (m) => m.id,
  });

  const [downloading, setDownloading] = React.useState(false);
  const download = async () => {
    setDownloading(true);
    try {
      await downloadMembersCsv(st.apiParams);
      toast.success(t("growth.common.downloaded"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setDownloading(false);
    }
  };

  const filtered = st.table.activeFilterCount > 0;
  return (
    <div>
      <DataTableToolbar table={st.table}>
        <Button variant="outline" onClick={() => void download()} disabled={downloading || !st.total}>
          {downloading ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
          <span className="hidden sm:inline">{t("growth.common.downloadCsv")}</span>
        </Button>
      </DataTableToolbar>
      <DataTable
        table={st.table}
        onRowClick={(m) => navigate(GROWTH_ROUTES.member(m.id))}
        empty={filtered ? undefined : <EmptyState compact icon={GiftIcon} title={t("growth.loyalty.emptyTitle")} description={t("growth.loyalty.emptyBody")} />}
      />
    </div>
  );
}
