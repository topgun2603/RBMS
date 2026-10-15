"use client";

import * as React from "react";
import { DownloadIcon, FilterXIcon, LifeBuoyIcon, Loader2Icon, OctagonAlertIcon, PlusIcon } from "lucide-react";
import {
  Button,
  Card,
  ChipGroup,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@srirealtime/ui";
import { apiDownload, describeError, ModuleLink, Page, PageHeading, QueryError, SearchField, useDebounced, useI18n, useModuleNavigate, useQueryParams } from "@srirealtime/web";
import { Age } from "../components/bits";
import { PriorityPill, SlaBadge, TicketStatusPill } from "../components/pills";
import { useStaffName } from "../components/staff-select";
import { useSentinel } from "../components/two-pane";
import { displayNameOf } from "../lib/format";
import { useTickets } from "../lib/queries";
import { TICKET_PRIORITIES, TICKET_STATUSES, type Ticket, type TicketFilters, type TicketPriority, type TicketStatus } from "../lib/types";

type Tab = TicketStatus | "all";
const ANY = "__any";

export default function SupportPage() {
  const { t, formatNumber } = useI18n();
  const params = useQueryParams();
  const navigate = useModuleNavigate();
  const initialTab = params?.get("status");
  const [tab, setTab] = React.useState<Tab>(initialTab && (TICKET_STATUSES as readonly string[]).includes(initialTab) ? (initialTab as TicketStatus) : initialTab === "all" ? "all" : "open");
  const [q, setQ] = React.useState("");
  const [priority, setPriority] = React.useState<TicketPriority | "">("");
  const [assignee, setAssignee] = React.useState<string>(params?.get("assignee") ?? "");
  const [overdue, setOverdue] = React.useState(params?.get("overdue") === "1");
  const [sort, setSort] = React.useState<NonNullable<TicketFilters["sort"]>>(overdue ? "due" : "recent");
  const [downloading, setDownloading] = React.useState(false);
  const debounced = useDebounced(q.trim(), 300);
  const filters: TicketFilters = { status: tab === "all" ? "" : tab, priority, assignee: assignee || undefined, overdue, q: debounced, sort };
  const list = useTickets(filters);
  const first = list.data?.pages[0];
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const sentinel = useSentinel(() => void list.fetchNextPage(), !!list.hasNextPage && !list.isFetchingNextPage);
  const filtered = !!(debounced || priority || assignee || overdue);
  const counts = first?.counts;
  const allCount = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined;

  const add = (
    <Button asChild size="lg">
      <ModuleLink to="support/new">
        <PlusIcon /> {t("inbox.ticket.new")}
      </ModuleLink>
    </Button>
  );

  return (
    <Page className="max-w-7xl">
      <PageHeading
        icon={LifeBuoyIcon}
        title={t("inbox.ticket.title")}
        description={first ? t("inbox.ticket.subtitleCount", { count: first.total }) : t("inbox.ticket.subtitle")}
        actions={
          <>
            <Button
              variant="outline"
              size="lg"
              disabled={downloading}
              onClick={async () => {
                setDownloading(true);
                try {
                  await apiDownload("/support/tickets", { format: "csv", status: filters.status || undefined, priority: priority || undefined, assignee: assignee || undefined, overdue: overdue ? "true" : undefined, q: debounced || undefined }, "tickets.csv");
                } catch (err) {
                  toast.error(describeError(err, t));
                } finally {
                  setDownloading(false);
                }
              }}
            >
              {downloading ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} <span className="max-sm:sr-only">CSV</span>
            </Button>
            {add}
          </>
        }
      />

      <ChipGroup<Tab>
        className="mb-3"
        aria-label={t("inbox.ticket.statusFilter")}
        value={tab}
        onChange={setTab}
        options={[
          ...TICKET_STATUSES.map((s) => ({ value: s as Tab, label: t(`inbox.ticket.status.${s}`), meta: counts ? formatNumber(counts[s]) : undefined })),
          { value: "all" as Tab, label: t("inbox.common.all"), meta: allCount !== undefined ? formatNumber(allCount) : undefined },
        ]}
      />

      <div className="mb-4 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <SearchField value={q} onChange={setQ} placeholder={t("inbox.ticket.search")} />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={priority || ANY} onValueChange={(v) => setPriority(v === ANY ? "" : (v as TicketPriority))}>
            <SelectTrigger size="lg" className="w-auto min-w-32" aria-label={t("inbox.ticket.priority")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("inbox.ticket.anyPriority")}</SelectItem>
              {TICKET_PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`inbox.ticket.priority.${p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={assignee || ANY} onValueChange={(v) => setAssignee(v === ANY ? "" : v)}>
            <SelectTrigger size="lg" className="w-auto min-w-32" aria-label={t("inbox.ticket.assignee")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t("inbox.ticket.anyone")}</SelectItem>
              <SelectItem value="me">{t("inbox.ticket.assignedMe")}</SelectItem>
              <SelectItem value="none">{t("inbox.assign.none")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as NonNullable<TicketFilters["sort"]>)}>
            <SelectTrigger size="lg" className="w-auto min-w-32" aria-label={t("inbox.ticket.sort")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["recent", "due", "oldest"] as const).map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`inbox.ticket.sort.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={overdue ? "destructive" : "outline"}
            size="lg"
            aria-pressed={overdue}
            onClick={() => {
              setOverdue((o) => !o);
              if (!overdue) setSort("due");
            }}
          >
            <OctagonAlertIcon /> {t("inbox.ticket.overdueOnly")}
            {first && first.overdue > 0 && <span className="rounded-full bg-background/25 px-1.5 text-xs tabular-nums">{first.overdue}</span>}
          </Button>
          {filtered && (
            <Button variant="ghost" size="icon-lg" aria-label={t("inbox.common.clearFilters")} onClick={() => (setQ(""), setPriority(""), setAssignee(""), setOverdue(false), navigate("?", { replace: true }))}>
              <FilterXIcon />
            </Button>
          )}
        </div>
      </div>

      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div className="grid gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={LifeBuoyIcon}
          title={filtered ? t("inbox.common.noMatch") : tab === "open" ? t("inbox.ticket.allCaughtUp") : t("inbox.ticket.emptyTitle")}
          description={filtered ? t("inbox.common.noMatchBody") : t("inbox.ticket.emptyBody")}
          action={filtered ? undefined : add}
        />
      ) : (
        <div className={cn("transition-opacity", list.isPlaceholderData && "opacity-60")}>
          <TicketTable items={items} />
          <Stagger className="grid gap-2 md:hidden">
            {items.map((tk) => (
              <StaggerItem key={tk.id}>
                <TicketCard tk={tk} />
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      )}
      <div ref={sentinel} className="h-1" />
      {list.isFetchingNextPage && <Loader2Icon className="mx-auto my-4 size-5 animate-spin text-muted-foreground" aria-hidden />}
    </Page>
  );
}

function TicketTable({ items }: { items: Ticket[] }) {
  const { t } = useI18n();
  const staffName = useStaffName();
  return (
    <Card className="hidden gap-0 overflow-hidden py-0 md:flex">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="pl-4">{t("inbox.ticket.col.ticket")}</TableHead>
            <TableHead>{t("inbox.ticket.col.status")}</TableHead>
            <TableHead>{t("inbox.ticket.col.sla")}</TableHead>
            <TableHead className="max-lg:hidden">{t("inbox.ticket.col.assignee")}</TableHead>
            <TableHead className="pr-4 text-right">{t("inbox.ticket.col.updated")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((tk) => (
            <TableRow key={tk.id} className={cn("group", tk.overdue && "bg-destructive/[0.03]")}>
              <TableCell className="max-w-[28rem] pl-4">
                <ModuleLink to={`support/${tk.id}`} className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{tk.number}</span>
                    <PriorityPill priority={tk.priority} hideNormal />
                  </span>
                  <span className="block truncate font-medium group-hover:text-primary">{tk.subject}</span>
                  <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    {displayNameOf(tk.requester, t("inbox.ticket.customer"))} · {t(`inbox.ticket.channel.${tk.channel}`)}
                    {tk.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="rounded-full bg-muted px-1.5 text-[0.625rem]">
                        {tag}
                      </span>
                    ))}
                  </span>
                </ModuleLink>
              </TableCell>
              <TableCell>
                <TicketStatusPill status={tk.status} />
              </TableCell>
              <TableCell>
                <SlaBadge ticket={tk} hideDone />
              </TableCell>
              <TableCell className="max-lg:hidden">
                <span className="flex items-center gap-2 text-sm">
                  {tk.assigneeId && <InitialsAvatar name={staffName(tk.assigneeId)} size="sm" className="size-6 text-[0.625rem]" />}
                  <span className={cn(!tk.assigneeId && "text-muted-foreground")}>{staffName(tk.assigneeId)}</span>
                </span>
              </TableCell>
              <TableCell className="pr-4 text-right">
                <Age at={tk.lastMessageAt} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function TicketCard({ tk }: { tk: Ticket }) {
  const { t } = useI18n();
  const staffName = useStaffName();
  return (
    <ModuleLink to={`support/${tk.id}`} className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className={cn("gap-2 p-3", tk.overdue && "border-destructive/40")}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{tk.number}</span>
          <span className="flex-1" />
          <Age at={tk.lastMessageAt} />
        </div>
        <p className="line-clamp-2 font-medium">{tk.subject}</p>
        <p className="truncate text-xs text-muted-foreground">
          {displayNameOf(tk.requester, t("inbox.ticket.customer"))} · {staffName(tk.assigneeId)}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <TicketStatusPill status={tk.status} />
          <PriorityPill priority={tk.priority} hideNormal />
          <SlaBadge ticket={tk} hideDone hideOnTrack />
        </div>
      </Card>
    </ModuleLink>
  );
}
