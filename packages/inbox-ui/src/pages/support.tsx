"use client";

import * as React from "react";
import { DownloadIcon, LifeBuoyIcon, Loader2Icon, OctagonAlertIcon, PlusIcon } from "lucide-react";
import { Button, ChipGroup, cn, DataTable, DataTableToolbar, EmptyState, InitialsAvatar, toast, type DataTableColumn } from "@rbms/ui";
import {
  api,
  apiDownload,
  describeError,
  ModuleLink,
  Page,
  PageHeading,
  useI18n,
  useModuleNavigate,
  useQueryParams,
  useServerTable,
  type ServerFilterDefs,
} from "@rbms/web";
import { Age } from "../components/bits";
import { PriorityPill, SlaBadge, TicketStatusPill } from "../components/pills";
import { useStaffName } from "../components/staff-select";
import { useMe } from "../lib/access";
import { displayNameOf } from "../lib/format";
import { qk, useStaff } from "../lib/queries";
import { TICKET_CHANNELS, TICKET_PRIORITIES, TICKET_STATUSES, type Ticket, type TicketList } from "../lib/types";

/** Status pill "All": kept in the URL (`status=all`) so back/refresh keep it; never sent to the API. */
const ALL = "all";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Drops the "All" sentinel before calling the API. */
function apiParamsOf(p: Record<string, string | number>): Record<string, string | number> {
  if (p.status !== ALL) return p;
  const { status: _s, ...rest } = p;
  return rest;
}

export default function SupportPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <SupportDesk />
    </React.Suspense>
  );
}

function SupportDesk() {
  const { t, formatDate, formatNumber } = useI18n();
  const navigate = useModuleNavigate();
  const params = useQueryParams();
  const me = useMe();
  const staff = useStaff();
  const staffName = useStaffName();
  const [downloading, setDownloading] = React.useState(false);

  // Assignee options: me, unassigned, the team (with `staff.manage`), plus any id a shared link carries.
  const linkedAssignees = React.useMemo(() => (params?.get("assignee") ?? "").split(",").filter((v) => UUID_RE.test(v)), [params]);
  const assigneeOptions = React.useMemo(() => {
    const out = [
      { value: "me", label: t("inbox.assign.me") },
      { value: "none", label: t("inbox.assign.none") },
    ];
    const seen = new Set<string>(me.userId ? [me.userId] : []);
    for (const m of staff.members) {
      if (!m.active || seen.has(m.userId)) continue;
      seen.add(m.userId);
      out.push({ value: m.userId, label: staffName(m.userId) });
    }
    for (const id of linkedAssignees) if (!seen.has(id)) (seen.add(id), out.push({ value: id, label: staffName(id) }));
    return out;
  }, [t, me.userId, staff.members, staffName, linkedAssignees]);

  const filters = React.useMemo(
    () =>
      ({
        // Shown as the pills above the table (single status, or All).
        status: {
          kind: "options",
          label: t("inbox.ticket.statusFilter"),
          single: true,
          hidden: true,
          options: [
            ...TICKET_STATUSES.map((s) => ({
              value: s,
              label: t(`inbox.ticket.status.${s}`),
            })),
            { value: ALL, label: t("inbox.common.all") },
          ],
        },
        priority: {
          kind: "options",
          label: t("inbox.ticket.priority"),
          options: [...TICKET_PRIORITIES].reverse().map((p) => ({ value: p, label: t(`inbox.ticket.priority.${p}`) })),
        },
        assignee: {
          kind: "options",
          label: t("inbox.ticket.assignee"),
          options: assigneeOptions,
          dynamic: true,
        },
        channel: {
          kind: "options",
          label: t("inbox.ticket.col.channel"),
          options: TICKET_CHANNELS.map((c) => ({
            value: c,
            label: t(`inbox.ticket.channel.${c}`),
          })),
        },
        created: { kind: "dateRange", label: t("inbox.ticket.filter.created") },
        // The "Overdue" toggle; `overdue=1` is what dashboard links use.
        overdue: {
          kind: "options",
          label: t("inbox.ticket.overdueOnly"),
          single: true,
          hidden: true,
          options: [{ value: "1", label: t("inbox.ticket.overdueOnly") }],
        },
      }) satisfies ServerFilterDefs,
    [t, assigneeOptions],
  );

  const columns = React.useMemo<DataTableColumn<Ticket>[]>(
    () => [
      {
        id: "number",
        header: t("inbox.ticket.col.number"),
        sortable: true,
        sortDescFirst: true,
        card: "subtitle",
        cell: (tk) => <span className="font-mono text-xs text-muted-foreground">{tk.number}</span>,
        cardCell: (tk) => (
          <span>
            <span className="font-mono">{tk.number}</span> · {displayNameOf(tk.requester, t("inbox.ticket.customer"))}
          </span>
        ),
      },
      {
        id: "subject",
        header: t("inbox.ticket.col.subject"),
        sortable: true,
        hideable: false,
        card: "title",
        className: "max-w-[26rem]",
        cell: (tk) => (
          <div className="grid min-w-0">
            <ModuleLink to={`support/${tk.id}`} className="truncate font-medium outline-none hover:text-primary hover:underline focus-visible:underline">
              {tk.subject}
            </ModuleLink>
            <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
              {displayNameOf(tk.requester, t("inbox.ticket.customer"))}
              {tk.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="rounded-full bg-muted px-1.5 text-[0.625rem]">
                  {tag}
                </span>
              ))}
            </span>
          </div>
        ),
        cardCell: (tk) => <span className="line-clamp-2">{tk.subject}</span>,
      },
      {
        id: "status",
        header: t("inbox.ticket.col.status"),
        sortable: true,
        card: "right",
        cell: (tk) => <TicketStatusPill status={tk.status} />,
      },
      {
        id: "priority",
        header: t("inbox.ticket.priority"),
        sortable: true,
        sortDescFirst: true,
        card: "meta",
        cell: (tk) => <PriorityPill priority={tk.priority} />,
        cardCell: (tk) => <PriorityPill priority={tk.priority} hideNormal />,
      },
      {
        id: "due",
        header: t("inbox.ticket.col.sla"),
        sortable: true,
        card: "meta",
        cell: (tk) => <SlaBadge ticket={tk} hideDone />,
        cardCell: (tk) => <SlaBadge ticket={tk} hideDone hideOnTrack />,
      },
      {
        id: "assignee",
        header: t("inbox.ticket.col.assignee"),
        hideBelow: "lg",
        card: "meta",
        cell: (tk) => (
          <span className="flex items-center gap-2 text-sm">
            {tk.assigneeId && <InitialsAvatar name={staffName(tk.assigneeId)} size="sm" className="size-6 text-[0.625rem]" />}
            <span className={cn(!tk.assigneeId && "text-muted-foreground")}>{staffName(tk.assigneeId)}</span>
          </span>
        ),
        cardCell: (tk) => <span className="text-muted-foreground">{staffName(tk.assigneeId)}</span>,
      },
      {
        id: "channel",
        header: t("inbox.ticket.col.channel"),
        defaultHidden: true,
        cell: (tk) => t(`inbox.ticket.channel.${tk.channel}`),
      },
      {
        id: "created",
        header: t("inbox.ticket.col.created"),
        sortable: true,
        sortDescFirst: true,
        defaultHidden: true,
        cell: (tk) => (
          <span className="tabular-nums">
            {formatDate(tk.createdAt, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        ),
      },
      {
        id: "updated",
        header: t("inbox.ticket.col.updated"),
        sortable: true,
        sortDescFirst: true,
        align: "right",
        hideable: false,
        card: "right",
        cell: (tk) => <Age at={tk.lastMessageAt} />,
      },
    ],
    [t, formatDate, staffName],
  );

  // Landing on the desk without a status shows the open tickets (as before); the fetch waits for that default.
  const [ready, setReady] = React.useState(() => !!params?.has("status"));

  const st = useServerTable<Ticket, typeof filters>({
    queryKey: qk.ticketTable,
    path: "/support/tickets",
    fetcher: (p, signal) => api.get<TicketList>("/support/tickets", apiParamsOf(p), { signal }),
    columns,
    filters,
    defaultSort: "-updated",
    search: t("inbox.ticket.search"),
    storageKey: "inbox-tickets",
    enabled: ready,
  });

  const status = st.filters.status;
  const overdue = st.filters.overdue;
  React.useEffect(() => {
    if (ready) return;
    status.set(["open"]);
    setReady(true);
  }, [ready, status]);

  // New tickets and SLA changes show up without a reload (the list refreshed every minute before too).
  const refetch = st.query.refetch;
  React.useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => void refetch(), 60_000);
    return () => window.clearInterval(id);
  }, [ready, refetch]);

  const data = st.query.data as TicketList | undefined;
  const counts = data?.counts;
  const allCount = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined;
  const pill = status.value[0] ?? ALL;
  const overdueOn = overdue.value.length > 0;
  // Search and toolbar filters (the status pills and the overdue toggle are hidden filters, not counted here).
  const filtered = st.table.activeFilterCount > 0;

  const add = (
    <Button asChild size="lg">
      <ModuleLink to="support/new">
        <PlusIcon /> {t("inbox.ticket.new")}
      </ModuleLink>
    </Button>
  );

  if (!ready) return null;

  const download = async () => {
    setDownloading(true);
    try {
      const { limit: _l, offset: _o, ...rest } = apiParamsOf(st.apiParams);
      await apiDownload("/support/tickets", { ...rest, format: "csv" }, "tickets.csv");
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Page>
      <PageHeading
        icon={LifeBuoyIcon}
        title={t("inbox.ticket.title")}
        description={st.total !== undefined ? t("inbox.ticket.subtitleCount", { count: st.total }) : t("inbox.ticket.subtitle")}
        actions={
          <>
            <Button variant="outline" size="lg" disabled={downloading} onClick={() => void download()}>
              {downloading ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} <span className="max-sm:sr-only">CSV</span>
            </Button>
            {add}
          </>
        }
      />

      <DataTableToolbar
        table={st.table}
        quickFilters={
          <div className="flex flex-wrap items-center gap-2">
            <ChipGroup
              size="sm"
              aria-label={t("inbox.ticket.statusFilter")}
              value={pill}
              onChange={(v) => status.set([v])}
              options={[
                ...TICKET_STATUSES.map((s) => ({
                  value: s as string,
                  label: t(`inbox.ticket.status.${s}`),
                  meta: counts ? formatNumber(counts[s]) : undefined,
                })),
                {
                  value: ALL,
                  label: t("inbox.common.all"),
                  meta: allCount !== undefined ? formatNumber(allCount) : undefined,
                },
              ]}
            />
            <Button
              size="sm"
              variant={overdueOn ? "destructive" : "outline"}
              className="rounded-full"
              aria-pressed={overdueOn}
              onClick={() =>
                overdueOn
                  ? overdue.set([])
                  : st.update({
                      filters: { overdue: ["1"] },
                      sort: { id: "due", desc: false },
                    })
              }
            >
              <OctagonAlertIcon /> {t("inbox.ticket.overdueOnly")}
              {data && data.overdue > 0 && <span className="rounded-full bg-background/25 px-1.5 text-xs tabular-nums">{formatNumber(data.overdue)}</span>}
            </Button>
          </div>
        }
      />

      <DataTable
        table={st.table}
        onRowClick={(tk) => navigate(`support/${tk.id}`)}
        empty={
          filtered ? undefined : (
            <EmptyState
              className="border-0 bg-transparent"
              icon={LifeBuoyIcon}
              title={pill === "open" ? t("inbox.ticket.allCaughtUp") : t("inbox.ticket.emptyTitle")}
              description={t("inbox.ticket.emptyBody")}
              action={add}
            />
          )
        }
      />
    </Page>
  );
}
