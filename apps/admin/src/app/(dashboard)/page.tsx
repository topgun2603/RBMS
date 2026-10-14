"use client";

import Link from "next/link";
import {
  ArrowRightIcon,
  BellIcon,
  GaugeIcon,
  HardDriveIcon,
  LayersIcon,
  PaletteIcon,
  UsersIcon,
} from "lucide-react";
import {
  AnimatedNumber,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  PageHeader,
  StatCard,
  Stagger,
  StaggerItem,
} from "@srirealtime/ui";
import { StatusBadge } from "@/components/badges";
import { channelIcon, UsageBar } from "@/components/usage";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { displayName, useMe, useMyTenants } from "@/lib/auth";
import { formatUsageValue, humanizeKey, isUnlimited, usagePercent } from "@/lib/format";
import { tOr, useI18n } from "@/lib/i18n";
import { useCurrentPlan, useMembers, useNotifyLog } from "@/lib/queries";
import { useTenantSlug } from "@/lib/session";
import type { NotifyLogEntry } from "@/lib/types";

export default function OverviewPage() {
  const { t, formatRelative } = useI18n();
  const me = useMe();
  const slug = useTenantSlug();
  const mine = useMyTenants();
  const plan = useCurrentPlan();
  const members = useMembers();
  const log = useNotifyLog(8);
  const tenant = mine.data?.find((m) => m.tenant.slug === slug)?.tenant;

  const storage = plan.data?.usage.find((u) => /storage/i.test(u.key));
  const otherUsage = plan.data?.usage.filter((u) => u !== storage) ?? [];

  const columns = [
    {
      id: "channel",
      header: t("admin.notifications.channel"),
      cell: (r: NotifyLogEntry) => {
        const Icon = channelIcon[r.channel] ?? BellIcon;
        return (
          <span className="flex items-center gap-2">
            <Icon className="size-4 text-muted-foreground" />
            {tOr(t, `admin.channels.${r.channel}`, r.channel)}
          </span>
        );
      },
    },
    { id: "to", header: t("admin.notifications.to"), cell: (r: NotifyLogEntry) => <span className="font-mono text-xs">{r.to}</span> },
    {
      id: "template",
      header: t("admin.notifications.template"),
      hideBelow: "md" as const,
      cell: (r: NotifyLogEntry) => <span className="text-muted-foreground">{r.templateKey ?? "—"}</span>,
    },
    { id: "status", header: t("admin.common.status"), cell: (r: NotifyLogEntry) => <StatusBadge status={r.status} /> },
    {
      id: "when",
      header: t("admin.common.when"),
      align: "right" as const,
      cell: (r: NotifyLogEntry) => <span className="text-muted-foreground">{formatRelative(r.createdAt)}</span>,
    },
  ];

  return (
    <Page>
      <PageHeader
        eyebrow={tenant?.name ?? slug}
        title={t("admin.overview.greeting", { name: displayName(me.data?.user, "") })}
        description={t("admin.overview.subtitle")}
        actions={
          <Button variant="outline" asChild>
            <Link href="/branding">
              <PaletteIcon /> {t("admin.overview.customize")}
            </Link>
          </Button>
        }
      />

      <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StaggerItem>
          <StatCard
            title={t("admin.overview.plan")}
            icon={LayersIcon}
            loading={plan.isLoading}
            value={plan.data?.plan?.name ?? plan.data?.planId ?? t("admin.plans.none")}
            description={t("admin.overview.modules", { count: plan.data?.modules.length ?? 0 })}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            title={t("admin.overview.members")}
            icon={UsersIcon}
            loading={members.isLoading}
            value={members.isError ? "—" : <AnimatedNumber value={members.data?.length ?? 0} />}
            description={
              members.data
                ? t("admin.overview.admins", { count: members.data.filter((m) => m.roles.some((r) => r === "owner" || r === "admin")).length })
                : undefined
            }
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            title={t("admin.overview.storage")}
            icon={HardDriveIcon}
            loading={plan.isLoading}
            value={storage ? formatUsageValue(storage.key, storage.used) : "—"}
            description={
              storage
                ? isUnlimited(storage.limit)
                  ? t("admin.plans.unlimited")
                  : t("admin.overview.ofLimit", { limit: formatUsageValue(storage.key, storage.limit) })
                : t("admin.overview.noStorageLimit")
            }
            footer={storage && !isUnlimited(storage.limit) ? <UsageBar percent={usagePercent(storage)} /> : undefined}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            title={t("admin.overview.messages")}
            icon={BellIcon}
            loading={log.isLoading}
            value={log.isError ? "—" : <AnimatedNumber value={log.data?.filter((l) => l.status === "sent").length ?? 0} />}
            description={t("admin.overview.failed", { count: log.data?.filter((l) => l.status === "failed").length ?? 0 })}
          />
        </StaggerItem>
      </Stagger>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="gap-4 lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("admin.overview.recentMessages")}</CardTitle>
            <CardDescription>{t("admin.overview.recentMessagesHint")}</CardDescription>
            <CardAction>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/notifications">
                  {t("admin.common.viewAll")} <ArrowRightIcon />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="px-0">
            {log.isError ? (
              <QueryError compact error={log.error} onRetry={() => void log.refetch()} />
            ) : (
              <DataTable
                bare
                columns={columns}
                data={log.data}
                loading={log.isLoading}
                skeletonRows={4}
                getRowId={(r) => r.id}
                empty={<EmptyState compact icon={BellIcon} title={t("admin.notifications.logEmpty")} />}
              />
            )}
          </CardContent>
        </Card>

        <Card className="gap-4">
          <CardHeader>
            <CardTitle>{t("admin.overview.usage")}</CardTitle>
            <CardDescription>{t("admin.overview.usageHint")}</CardDescription>
            <CardAction>
              <Button variant="ghost" size="icon-sm" asChild aria-label={t("admin.nav.plans")}>
                <Link href="/plans">
                  <GaugeIcon />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            {plan.isError ? (
              <QueryError compact error={plan.error} onRetry={() => void plan.refetch()} />
            ) : otherUsage.length === 0 && !plan.isLoading ? (
              <p className="text-sm text-muted-foreground">{t("admin.plans.noUsage")}</p>
            ) : (
              otherUsage.slice(0, 5).map((u) => (
                <div key={u.key} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span>{tOr(t, `admin.usage.${u.key}`, humanizeKey(u.key))}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatUsageValue(u.key, u.used)} / {isUnlimited(u.limit) ? "∞" : formatUsageValue(u.key, u.limit)}
                    </span>
                  </div>
                  <UsageBar percent={usagePercent(u)} />
                </div>
              ))
            )}
            {plan.data && plan.data.modules.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-2">
                {plan.data.modules.map((m) => (
                  <Badge key={m} variant="muted">
                    {m}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
