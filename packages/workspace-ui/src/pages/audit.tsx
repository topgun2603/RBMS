"use client";

import * as React from "react";
import { ChevronRightIcon, DownloadIcon, HistoryIcon, Loader2Icon } from "lucide-react";
import { Button, DataTable, DataTableToolbar, EmptyState, toast, type DataTableColumn } from "@srirealtime/ui";
import {
  describeError,
  displayName,
  Page,
  PageHeading,
  SettingsNav,
  useFeature,
  useI18n,
  useServerTable,
  type ServerFilterDefs,
} from "@srirealtime/web";
import { actionText, auditModuleLabel } from "../components/audit/action-label";
import { AuditDetailSheet, deviceOf } from "../components/audit/detail-sheet";
import { NoPermission } from "../components/bits";
import { PERMISSIONS, useHasPermission } from "../lib/access";
import { AUDIT_AREAS, ENTITY_TYPES } from "../lib/audit-actions";
import { downloadAuditCsv, useMembers, wk } from "../lib/queries";
import type { AuditEvent, AuditListExtras } from "../lib/types";

export default function AuditPage() {
  const { t } = useI18n();
  const allowed = useHasPermission(PERMISSIONS.audit, { explicit: true });
  return (
    <Page>
      <SettingsNav />
      {allowed ? (
        // useServerTable reads the search params, which needs a Suspense boundary.
        <React.Suspense fallback={<PageHeading icon={HistoryIcon} title={t("workspace.audit.title")} description={t("workspace.audit.subtitle")} />}>
          <AuditLog />
        </React.Suspense>
      ) : (
        <>
          <PageHeading icon={HistoryIcon} title={t("workspace.audit.title")} description={t("workspace.audit.subtitle")} />
          <NoPermission permission={PERMISSIONS.audit} />
        </>
      )}
    </Page>
  );
}

function AuditLog() {
  const { t, formatDate } = useI18n();
  const staffOn = useFeature("staff");
  const canSeeTeam = useHasPermission(PERMISSIONS.staff) && staffOn;
  const members = useMembers(canSeeTeam);
  const memberList = members.data;
  const [open, setOpen] = React.useState<AuditEvent | null>(null);
  const [downloading, setDownloading] = React.useState(false);

  const names = React.useMemo(() => new Map((memberList ?? []).map((m) => [m.userId, displayName(m)])), [memberList]);
  const actorName = React.useCallback(
    (id: string | null) => (!id ? t("workspace.audit.system") : (names.get(id) ?? t("workspace.audit.memberId", { id: id.slice(0, 8) }))),
    [names, t],
  );

  const filters = React.useMemo(
    () =>
      ({
        date: { kind: "dateRange", label: t("workspace.audit.period") },
        action: {
          kind: "options",
          label: t("workspace.audit.area"),
          options: AUDIT_AREAS.map((a) => ({ value: a.action, label: auditModuleLabel(t, a.id) })),
        },
        actorUserId: {
          kind: "options",
          label: t("workspace.audit.member"),
          options: (memberList ?? []).map((m) => ({ value: m.userId, label: displayName(m) })),
          dynamic: true,
          hidden: !canSeeTeam,
        },
        entityType: {
          kind: "options",
          label: t("workspace.audit.entityType"),
          options: ENTITY_TYPES.map((e) => ({ value: e, label: auditModuleLabel(t, e) })),
        },
        // From links (`?entityId=…`, e.g. a bill's history); search also matches record ids.
        entityId: { kind: "text" },
      }) satisfies ServerFilterDefs,
    [t, memberList, canSeeTeam],
  );

  const columns = React.useMemo<DataTableColumn<AuditEvent>[]>(() => {
    const when = (iso: string) => formatDate(iso, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    return [
      {
        id: "time",
        header: t("workspace.audit.time"),
        sortable: true,
        sortDescFirst: true,
        hideable: false,
        card: "right",
        width: "9rem",
        cell: (e) => <span className="whitespace-nowrap text-muted-foreground tabular-nums">{when(e.createdAt)}</span>,
        cardCell: (e) => <span className="whitespace-nowrap text-xs font-normal text-muted-foreground tabular-nums">{when(e.createdAt)}</span>,
      },
      {
        id: "member",
        header: t("workspace.audit.member"),
        hideBelow: "md",
        card: "subtitle",
        cell: (e) => <span className="block max-w-40 truncate">{actorName(e.actorUserId)}</span>,
        cardCell: (e) => (e.summary ? `${actorName(e.actorUserId)} · ${e.summary}` : actorName(e.actorUserId)),
      },
      {
        id: "action",
        header: t("workspace.audit.action"),
        hideable: false,
        card: "title",
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
        cardCell: (e) => actionText(t, e.action),
      },
      {
        id: "entity",
        header: t("workspace.audit.entity"),
        hideBelow: "lg",
        card: "meta",
        cell: (e) => (
          <span className="grid">
            <span className="text-sm">{auditModuleLabel(t, e.entityType)}</span>
            {e.entityId && <span className="max-w-40 truncate font-mono text-xs text-muted-foreground">{e.entityId}</span>}
          </span>
        ),
        cardCell: (e) => auditModuleLabel(t, e.entityType),
      },
      {
        id: "device",
        header: t("workspace.audit.device"),
        hideBelow: "lg",
        cell: (e) => <span className="text-xs text-muted-foreground">{deviceOf(e.userAgent) ?? "—"}</span>,
      },
    ];
  }, [t, formatDate, actorName]);

  const st = useServerTable<AuditEvent, typeof filters>({
    queryKey: wk.audit,
    path: "/audit",
    columns,
    filters,
    defaultSort: "-time",
    search: t("workspace.audit.search"),
    storageKey: "workspace-audit",
    getRowId: (e) => e.id,
  });
  const capped = !!(st.query.data as AuditListExtras | undefined)?.totalCapped;
  const filtered = st.table.activeFilterCount > 0;

  const download = async () => {
    setDownloading(true);
    try {
      await downloadAuditCsv(st.apiParams);
      toast.success(t("workspace.common.downloaded"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <PageHeading
        icon={HistoryIcon}
        title={t("workspace.audit.title")}
        description={
          st.total === undefined
            ? t("workspace.audit.subtitle")
            : capped
              ? t("workspace.audit.countCapped", { count: st.total })
              : t("workspace.audit.count", { count: st.total })
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <DataTableToolbar table={st.table}>
          <Button variant="outline" size="sm" className="h-9" onClick={() => void download()} disabled={downloading || st.total === 0}>
            {downloading ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} {t("workspace.common.csv")}
          </Button>
        </DataTableToolbar>
        <DataTable
          table={st.table}
          onRowClick={setOpen}
          empty={
            filtered ? undefined : (
              <EmptyState compact className="border-0 bg-transparent" icon={HistoryIcon} title={t("workspace.audit.emptyTitle")} description={t("workspace.audit.emptyBody")} />
            )
          }
        />
      </div>
      <AuditDetailSheet event={open} actor={actorName} onClose={() => setOpen(null)} />
    </>
  );
}
