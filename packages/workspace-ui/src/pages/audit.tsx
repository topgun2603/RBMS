"use client";

import * as React from "react";
import { ChevronRightIcon, DownloadIcon, FilterXIcon, HistoryIcon, Loader2Icon } from "lucide-react";
import {
  Button,
  Card,
  ChipGroup,
  cn,
  DataTable,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  type DataTableColumn,
} from "@srirealtime/ui";
import { describeError, displayName, Page, PageHeading, QueryError, SettingsNav, useDebounced, useFeature, useI18n } from "@srirealtime/web";
import { actionText, auditModuleLabel } from "../components/audit/action-label";
import { AuditDetailSheet, deviceOf } from "../components/audit/detail-sheet";
import { NoPermission } from "../components/bits";
import { PERMISSIONS, useHasPermission } from "../lib/access";
import { ENTITY_TYPES } from "../lib/audit-actions";
import { downloadAuditCsv, useAuditLog, useMembers } from "../lib/queries";
import type { AuditEvent, AuditFilters } from "../lib/types";

const ANY = "__any";
const ACTION_GROUPS = ["invoices", "catalog", "inventory", "orders", "expenses", "staff", "import", "features", "payments"] as const;
type Preset = "today" | "7d" | "30d" | "90d" | "custom";

/** Today in IST as YYYY-MM-DD, and n days before it. */
function istDay(offsetDays = 0): string {
  const d = new Date(Date.now() - offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
const presetRange = (p: Exclude<Preset, "custom">) => {
  const days = { today: 0, "7d": 6, "30d": 29, "90d": 89 }[p];
  return { from: istDay(days), to: istDay(0) };
};

export default function AuditPage() {
  const { t } = useI18n();
  const allowed = useHasPermission(PERMISSIONS.audit, { explicit: true });
  return (
    <Page className="max-w-6xl">
      <SettingsNav />
      <PageHeading icon={HistoryIcon} title={t("workspace.audit.title")} description={t("workspace.audit.subtitle")} />
      {allowed ? <AuditLog /> : <NoPermission permission={PERMISSIONS.audit} />}
    </Page>
  );
}

function AuditLog() {
  const { t, formatDate } = useI18n();
  const staffOn = useFeature("staff");
  const canSeeTeam = useHasPermission(PERMISSIONS.staff) && staffOn;
  const members = useMembers(canSeeTeam);
  const [preset, setPreset] = React.useState<Preset>("30d");
  const [range, setRange] = React.useState(() => presetRange("30d"));
  const [actor, setActor] = React.useState(ANY);
  const [group, setGroup] = React.useState(ANY);
  const [entityType, setEntityType] = React.useState(ANY);
  const [entityId, setEntityId] = React.useState("");
  const debouncedId = useDebounced(entityId.trim(), 350);
  const [open, setOpen] = React.useState<AuditEvent | null>(null);
  const [downloading, setDownloading] = React.useState(false);

  const filters = React.useMemo<AuditFilters>(
    () => ({
      from: range.from || undefined,
      to: range.to || undefined,
      actorUserId: actor === ANY ? undefined : actor,
      action: group === ANY ? undefined : `${group}.*`,
      entityType: entityType === ANY ? undefined : entityType,
      entityId: debouncedId || undefined,
    }),
    [range, actor, group, entityType, debouncedId],
  );
  const q = useAuditLog(filters);
  const rows = React.useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const total = q.data?.pages[0]?.total;

  const names = React.useMemo(() => new Map((members.data ?? []).map((m) => [m.userId, displayName(m)])), [members.data]);
  const actorName = React.useCallback(
    (id: string | null) => (!id ? t("workspace.audit.system") : (names.get(id) ?? t("workspace.audit.memberId", { id: id.slice(0, 8) }))),
    [names, t],
  );
  const filtered = actor !== ANY || group !== ANY || entityType !== ANY || !!entityId || preset !== "30d";
  const reset = () => {
    setPreset("30d");
    setRange(presetRange("30d"));
    setActor(ANY);
    setGroup(ANY);
    setEntityType(ANY);
    setEntityId("");
  };

  const download = async () => {
    setDownloading(true);
    try {
      await downloadAuditCsv(filters);
      toast.success(t("workspace.common.downloaded"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setDownloading(false);
    }
  };

  const when = (iso: string) => formatDate(iso, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const columns: DataTableColumn<AuditEvent>[] = [
    { id: "time", header: t("workspace.audit.time"), cell: (e) => <span className="whitespace-nowrap text-muted-foreground tabular-nums">{when(e.createdAt)}</span>, width: "9rem" },
    { id: "member", header: t("workspace.audit.member"), cell: (e) => <span className="block max-w-40 truncate">{actorName(e.actorUserId)}</span>, hideBelow: "md" },
    {
      id: "action",
      header: t("workspace.audit.action"),
      cell: (e) => (
        <button
          type="button"
          onClick={(ev) => {
            ev.stopPropagation();
            setOpen(e);
          }}
          className="group flex w-full min-w-0 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{actionText(t, e.action)}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {e.summary || <span className="md:hidden">{actorName(e.actorUserId)}</span>}
            </span>
          </span>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        </button>
      ),
    },
    {
      id: "entity",
      header: t("workspace.audit.entity"),
      hideBelow: "lg",
      cell: (e) => (
        <span className="grid">
          <span className="text-sm">{auditModuleLabel(t, e.entityType)}</span>
          {e.entityId && <span className="max-w-40 truncate font-mono text-xs text-muted-foreground">{e.entityId}</span>}
        </span>
      ),
    },
    { id: "device", header: t("workspace.audit.device"), hideBelow: "lg", cell: (e) => <span className="text-xs text-muted-foreground">{deviceOf(e.userAgent) ?? "—"}</span> },
  ];

  return (
    <div className="grid gap-4">
      <Card className="gap-3 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ChipGroup
            size="sm"
            aria-label={t("workspace.audit.period")}
            value={preset}
            onChange={(p) => {
              setPreset(p);
              if (p !== "custom") setRange(presetRange(p));
            }}
            options={(["today", "7d", "30d", "90d", "custom"] as const).map((p) => ({ value: p, label: t(`workspace.audit.presets.${p}`) }))}
          />
          <div className="flex gap-2">
            {filtered && (
              <Button variant="ghost" size="sm" className="h-9" onClick={reset}>
                <FilterXIcon /> {t("workspace.audit.clear")}
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-9" onClick={() => void download()} disabled={downloading}>
              {downloading ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} {t("workspace.common.csv")}
            </Button>
          </div>
        </div>
        {preset === "custom" && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <Label htmlFor="audit-from" className="text-xs text-muted-foreground">
                {t("workspace.audit.from")}
              </Label>
              <Input id="audit-from" type="date" className="h-10 w-40" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="audit-to" className="text-xs text-muted-foreground">
                {t("workspace.audit.to")}
              </Label>
              <Input id="audit-to" type="date" className="h-10 w-40" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
            </div>
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {canSeeTeam && (
            <Select value={actor} onValueChange={setActor}>
              <SelectTrigger className="h-10 w-full" aria-label={t("workspace.audit.member")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t("workspace.audit.anyMember")}</SelectItem>
                {(members.data ?? []).map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {displayName(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger className="h-10 w-full" aria-label={t("workspace.audit.action")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("workspace.audit.anyAction")}</SelectItem>
              {ACTION_GROUPS.map((g) => (
                <SelectItem key={g} value={g}>
                  {auditModuleLabel(t, g)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger className="h-10 w-full" aria-label={t("workspace.audit.entityType")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("workspace.audit.anyEntity")}</SelectItem>
              {ENTITY_TYPES.map((e) => (
                <SelectItem key={e} value={e}>
                  {auditModuleLabel(t, e)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="h-10 font-mono"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            placeholder={t("workspace.audit.entityIdPlaceholder")}
            aria-label={t("workspace.audit.entityId")}
          />
        </div>
      </Card>

      {q.isError && !q.data ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className={cn("grid gap-3 transition-opacity", q.isPlaceholderData && "opacity-60")}>
          {total !== undefined && <p className="text-xs text-muted-foreground">{t("workspace.audit.count", { count: total })}</p>}
          <DataTable
            columns={columns}
            data={rows}
            loading={q.isPending}
            getRowId={(e) => e.id}
            onRowClick={setOpen}
            skeletonRows={8}
            empty={<EmptyState compact icon={HistoryIcon} title={t("workspace.audit.emptyTitle")} description={t("workspace.audit.emptyBody")} />}
          />
          {q.hasNextPage && (
            <Button variant="outline" className="h-11 justify-self-center" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
              {q.isFetchingNextPage && <Loader2Icon className="animate-spin" />}
              {t("workspace.common.loadMore")}
            </Button>
          )}
        </div>
      )}

      <AuditDetailSheet event={open} actor={actorName} onClose={() => setOpen(null)} />
    </div>
  );
}
