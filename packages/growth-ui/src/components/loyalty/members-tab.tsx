"use client";

import * as React from "react";
import { CoinsIcon, CrownIcon, DownloadIcon, GiftIcon, Loader2Icon, UsersIcon, WalletIcon } from "lucide-react";
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  InitialsAvatar,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatCard,
  StatusPill,
  toast,
  type DataTableColumn,
} from "@srirealtime/ui";
import { describeError, QueryError, SearchField, useDebounced, useI18n, useModuleNavigate } from "@srirealtime/web";
import { displayPhone, money, num, searchTerm } from "../../lib/format";
import { downloadMembersCsv, useLoyaltySettings, useLoyaltySummary, useMembers, type MemberFilters } from "../../lib/queries/loyalty";
import type { LoyaltyMember, MemberSort } from "../../lib/types";
import { GROWTH_ROUTES } from "../../module";

const ANY = "__any";
const SORTS: MemberSort[] = ["recent", "points", "spend", "name", "joined"];

export function MembersTab() {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const settings = useLoyaltySettings();
  const summary = useLoyaltySummary();
  const [q, setQ] = React.useState("");
  const [tier, setTier] = React.useState(ANY);
  const [sort, setSort] = React.useState<MemberSort>("recent");
  const dq = useDebounced(searchTerm(q), 300);
  const filters: MemberFilters = { q: dq || undefined, tier: tier === ANY ? undefined : tier, sort };
  const members = useMembers(filters);
  const [downloading, setDownloading] = React.useState(false);

  const rows = members.data?.pages.flatMap((p) => p.items);
  const total = members.data?.pages[0]?.total ?? 0;
  const filtered = !!filters.q || !!filters.tier;

  const columns: DataTableColumn<LoyaltyMember>[] = [
    {
      id: "member",
      header: t("growth.loyalty.member"),
      cell: (m) => (
        <span className="flex min-w-0 items-center gap-3">
          <InitialsAvatar name={m.name ?? m.memberKey} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-medium">{m.name || t("growth.loyalty.noName")}</span>
            <span className="block text-xs text-muted-foreground tabular-nums">{displayPhone(m.memberKey)}</span>
          </span>
        </span>
      ),
    },
    {
      id: "tier",
      header: t("growth.loyalty.tier"),
      hideBelow: "sm",
      cell: (m) => (
        <StatusPill tone="brand" icon={CrownIcon}>
          {m.tier}
        </StatusPill>
      ),
    },
    {
      id: "balance",
      header: t("growth.loyalty.balance"),
      align: "right",
      cell: (m) => (
        <span className="grid justify-items-end leading-tight">
          <span className="font-semibold tabular-nums">{t("growth.loyalty.pointsN", { n: num(m.pointsBalance) })}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{money(m.pointsValue)}</span>
        </span>
      ),
    },
    { id: "spend", header: t("growth.loyalty.lifetimeSpend"), align: "right", hideBelow: "md", cell: (m) => <span className="tabular-nums">{money(m.lifetimeSpend)}</span> },
    {
      id: "last",
      header: t("growth.loyalty.lastActivity"),
      align: "right",
      hideBelow: "lg",
      cell: (m) => <span className="text-muted-foreground">{m.lastActivityAt ? formatDate(m.lastActivityAt) : formatDate(m.joinedAt)}</span>,
    },
  ];

  const download = async () => {
    setDownloading(true);
    try {
      await downloadMembersCsv(filters);
      toast.success(t("growth.common.downloaded"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard title={t("growth.loyalty.statMembers")} value={num(summary.data?.members)} icon={UsersIcon} loading={summary.isPending} />
        <StatCard
          title={t("growth.widgets.liability")}
          value={summary.data ? (summary.data.exact ? money(summary.data.liability) : t("growth.widgets.liabilityAtLeast", { value: money(summary.data.liability) })) : "—"}
          description={t("growth.widgets.liabilityHint")}
          icon={WalletIcon}
          loading={summary.isPending}
        />
        <StatCard
          className="col-span-2 lg:col-span-1"
          title={t("growth.loyalty.statPoints")}
          value={num(summary.data?.points)}
          icon={CoinsIcon}
          loading={summary.isPending}
        />
      </div>

      <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_11rem_auto]">
        <SearchField value={q} onChange={setQ} placeholder={t("growth.loyalty.searchPlaceholder")} size="default" />
        <Field>
          <FieldLabel className="sr-only">{t("growth.loyalty.tier")}</FieldLabel>
          <Select value={tier} onValueChange={setTier}>
            <FieldControl>
              <SelectTrigger className="w-full" aria-label={t("growth.loyalty.tier")}>
                <SelectValue />
              </SelectTrigger>
            </FieldControl>
            <SelectContent>
              <SelectItem value={ANY}>{t("growth.loyalty.allTiers")}</SelectItem>
              {(settings.data?.tiers ?? []).map((x) => (
                <SelectItem key={x.name} value={x.name}>
                  {x.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel className="sr-only">{t("growth.loyalty.sort")}</FieldLabel>
          <Select value={sort} onValueChange={(v) => setSort(v as MemberSort)}>
            <FieldControl>
              <SelectTrigger className="w-full" aria-label={t("growth.loyalty.sort")}>
                <SelectValue />
              </SelectTrigger>
            </FieldControl>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`growth.loyalty.sorts.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Button variant="outline" onClick={() => void download()} disabled={downloading || total === 0}>
          {downloading ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
          {t("growth.common.downloadCsv")}
        </Button>
      </div>

      {members.isError && !members.data ? (
        <QueryError error={members.error} onRetry={() => void members.refetch()} />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={rows}
            loading={members.isPending}
            getRowId={(m) => m.id}
            onRowClick={(m) => navigate(GROWTH_ROUTES.member(m.id))}
            empty={
              <EmptyState
                compact
                icon={GiftIcon}
                title={filtered ? t("growth.loyalty.noMatches") : t("growth.loyalty.emptyTitle")}
                description={filtered ? undefined : t("growth.loyalty.emptyBody")}
              />
            }
          />
          {rows && rows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t("growth.loyalty.showing", { shown: num(rows.length), total: num(total) })}</span>
              {members.hasNextPage && (
                <Button variant="outline" size="sm" onClick={() => void members.fetchNextPage()} disabled={members.isFetchingNextPage}>
                  {members.isFetchingNextPage && <Loader2Icon className="animate-spin" />}
                  {t("growth.common.loadMore")}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
