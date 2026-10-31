"use client";

import * as React from "react";
import {
  ArrowRightIcon,
  DownloadIcon,
  EyeIcon,
  KanbanSquareIcon,
  ListIcon,
  Loader2Icon,
  MoreVerticalIcon,
  PackageCheckIcon,
  PlusIcon,
  PrinterIcon,
  ShoppingBagIcon,
} from "lucide-react";
import {
  Button,
  ChipGroup,
  cn,
  DataTable,
  DataTableToolbar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  toast,
  type DataTableColumn,
} from "@rbms/ui";
import {
  describeError,
  ModuleLink,
  Page,
  PageHeading,
  useFeature,
  useI18n,
  useModuleNavigate,
  useQueryParams,
  useServerTable,
  type ServerFilterDefs,
} from "@rbms/web";
import { OrdersIllustration } from "../components/illustrations";
import { KanbanBoard } from "../components/kanban";
import { OrderStatusPill, PaymentPill } from "../components/pills";
import { useStatusMover, type MovableOrder } from "../components/status-actions";
import { PERMS, usePermissions } from "../lib/access";
import { docPath, openPdfs } from "../lib/documents";
import { formatPhone, money } from "../lib/format";
import { exportOrdersCsv, ok, useUpdateStatus } from "../lib/queries";
import { allowedTransitions, canMarkPacked, nextStep, STATUS_TABS, totalCount, type StatusTab } from "../lib/status";
import { ORDER_CHANNELS, ORDER_STATUSES, PAYMENT_STATUSES, type OrderListFilters, type OrderStatus, type OrderSummary } from "../lib/types";

type View = "list" | "board";

export default function OrdersPage() {
  return (
    <React.Suspense fallback={null}>
      <OrdersList />
    </React.Suspense>
  );
}

function OrdersList() {
  const { t } = useI18n();
  const params = useQueryParams();
  const navigate = useModuleNavigate();
  const { can } = usePermissions();
  const returnsEnabled = useFeature("orders.returns");
  const mover = useStatusMover();
  const update = useUpdateStatus();
  const canManage = can(PERMS.manage);

  // The view is page state next to the table's own URL params (the table keeps params it doesn't own).
  const view: View = params.get("view") === "board" ? "board" : "list";
  const setView = (v: View) => {
    const sp = new URLSearchParams(params.toString());
    if (v === "board") sp.set("view", "board");
    else sp.delete("view");
    navigate(sp.toString() ? `?${sp}` : "?", { replace: true, scroll: false });
  };

  const filters = React.useMemo(
    () =>
      ({
        status: {
          kind: "options",
          label: t("orders.list.filterStatus"),
          options: ORDER_STATUSES.map((s) => ({ value: s, label: t(`orders.status.${s}`) })),
        },
        paymentStatus: {
          kind: "options",
          label: t("orders.list.filterPayment"),
          options: PAYMENT_STATUSES.map((s) => ({ value: s, label: t(`orders.paymentStatus.${s}`) })),
        },
        channel: {
          kind: "options",
          label: t("orders.list.filterChannel"),
          options: ORDER_CHANNELS.map((c) => ({ value: c, label: t(`orders.channel.${c}`) })),
        },
        date: { kind: "dateRange", label: t("orders.list.filterDate"), presets: ["today", "yesterday", "last7", "last30", "thisMonth", "lastMonth"] },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const quick = React.useCallback(
    (o: OrderSummary) => {
      const next = nextStep(o.status, allowedTransitions(o.status, { returnsEnabled }));
      return next && mover.canMove(next) ? next : null;
    },
    [returnsEnabled, mover],
  );

  const columns = React.useMemo<DataTableColumn<OrderSummary>[]>(
    () => [
      {
        id: "number",
        header: t("orders.list.col.order"),
        sortable: true,
        sortDescFirst: true,
        hideable: false,
        card: "title",
        cell: (o) => (
          <ModuleLink to={`orders/${o.id}`} className="font-semibold whitespace-nowrap outline-none hover:text-primary hover:underline focus-visible:underline">
            {o.number}
          </ModuleLink>
        ),
        cardCell: (o) => <span className="font-semibold">{o.number}</span>,
      },
      {
        id: "placed",
        header: t("orders.list.col.placed"),
        sortable: true,
        sortDescFirst: true,
        card: "meta",
        cell: (o) => <PlacedAt iso={o.placedAt} />,
      },
      {
        id: "customer",
        header: t("orders.list.col.customer"),
        sortable: true,
        card: "subtitle",
        className: "max-w-[16rem]",
        cell: (o) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{o.customerName}</p>
            <p className="mt-0.5 truncate text-meta text-muted-foreground">
              {[o.customerPhone && formatPhone(o.customerPhone), t(`orders.channel.${o.channel}`)].filter(Boolean).join(" · ")}
            </p>
          </div>
        ),
        cardCell: (o) => [o.customerName, t(`orders.channel.${o.channel}`)].join(" · "),
      },
      {
        id: "items",
        header: t("orders.list.col.items"),
        numeric: true,
        hideBelow: "lg",
        card: "meta",
        cell: (o) => o.itemCount,
        cardCell: (o) => t("orders.list.itemCount", { count: o.itemCount }),
      },
      {
        id: "total",
        header: t("orders.list.col.total"),
        sortable: true,
        numeric: true,
        card: "right",
        cell: (o) => <span className="font-semibold whitespace-nowrap">{money(o.total)}</span>,
      },
      {
        id: "payment",
        header: t("orders.list.col.payment"),
        card: "meta",
        cell: (o) => <PaymentPill status={o.paymentStatus} />,
      },
      {
        id: "status",
        header: t("orders.list.col.status"),
        sortable: true,
        card: "right",
        cell: (o) => <OrderStatusPill status={o.status} />,
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("orders.common.actions")}</span>,
        label: t("orders.common.actions"),
        hideable: false,
        headerClassName: "w-44",
        card: "meta",
        cell: (o) => {
          const next = quick(o);
          return (
            <div className="flex items-center justify-end gap-1">
              {next && (
                <Button size="sm" variant="outline" disabled={mover.busyId === o.id} onClick={() => mover.request(o, next)} className="whitespace-nowrap">
                  {mover.busyId === o.id ? <Loader2Icon className="animate-spin" /> : <ArrowRightIcon />}
                  {t(`orders.action.${next}`)}
                </Button>
              )}
              <RowMenu order={o} returnsEnabled={returnsEnabled} onMove={mover.request} canMove={mover.canMove} />
            </div>
          );
        },
      },
    ],
    [t, quick, mover, returnsEnabled],
  );

  const st = useServerTable<OrderSummary, typeof filters>({
    queryKey: ok.lists,
    path: "/orders",
    columns,
    filters,
    defaultSort: "-placed",
    search: t("orders.list.search"),
    storageKey: "orders-list",
    selectable: true,
  });

  const s = st.state.filters;
  // The board shows every status as a column, so it takes the other filters only.
  const base = React.useMemo<OrderListFilters>(
    () => ({
      q: st.state.q || undefined,
      paymentStatus: s.paymentStatus.join(",") || undefined,
      channel: s.channel.join(",") || undefined,
      from: s.date.from,
      to: s.date.to,
    }),
    [st.state.q, s.paymentStatus, s.channel, s.date],
  );
  const listFilters = React.useMemo<OrderListFilters>(() => ({ ...base, status: s.status.join(",") || undefined }), [base, s.status]);

  const counts = st.facets?.status as Partial<Record<OrderStatus, number>> | undefined;
  const total = st.total ?? 0;
  const pill: StatusTab | "" = s.status.length === 0 ? "all" : s.status.length === 1 ? (s.status[0] as StatusTab) : "";

  const [bulkBusy, setBulkBusy] = React.useState<"pack" | "print" | null>(null);
  const markPacked = async (selectedOrders: OrderSummary[], clear: () => void) => {
    const packable = selectedOrders.filter((o) => canMarkPacked(o.status));
    if (packable.length === 0) return;
    setBulkBusy("pack");
    const id = toast.loading(t("orders.bulk.packing", { count: packable.length }));
    const results = await Promise.allSettled(packable.map((o) => update.mutateAsync({ id: o.id, from: o.status, body: { status: "packed" } })));
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length === 0) toast.success(t("orders.bulk.packed", { count: packable.length }), { id });
    else toast.warning(t("orders.bulk.partial", { failed: failed.length, count: packable.length }), { id, description: describeError((failed[0] as PromiseRejectedResult).reason, t) });
    clear();
    setBulkBusy(null);
  };
  const printSlips = async (selectedOrders: OrderSummary[]) => {
    setBulkBusy("print");
    try {
      const failed = await openPdfs(
        selectedOrders.map((o) => ({ path: docPath.packingSlip(o.id), title: t("orders.docs.packingSlipFor", { number: o.number }) })),
        { loadingTitle: t("orders.docs.loading"), pageTitle: t("orders.docs.packingSlips") },
      );
      if (failed > 0) toast.warning(t("orders.docs.someFailed", { failed }));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setBulkBusy(null);
    }
  };

  const [exporting, setExporting] = React.useState(false);
  const doExport = async () => {
    setExporting(true);
    try {
      await exportOrdersCsv(listFilters);
      toast.success(t("orders.list.exported"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setExporting(false);
    }
  };

  const newButton = canManage && (
    <Button asChild size="lg">
      <ModuleLink to="orders/new">
        <PlusIcon /> {t("orders.list.new")}
      </ModuleLink>
    </Button>
  );
  const filtered = st.table.activeFilterCount > 0;

  return (
    <Page width="full">
      <PageHeading
        icon={ShoppingBagIcon}
        title={t("orders.list.title")}
        description={counts ? t("orders.list.subtitleCount", { count: totalCount(counts) }) : t("orders.list.subtitle")}
        actions={
          <>
            <div className="hidden items-center rounded-lg border bg-card p-0.5 shadow-xs md:flex" role="radiogroup" aria-label={t("orders.list.view")}>
              {(["list", "board"] as const).map((v) => {
                const Icon = v === "list" ? ListIcon : KanbanSquareIcon;
                return (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={view === v}
                    onClick={() => setView(v)}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      view === v ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4" /> {t(`orders.list.view.${v}`)}
                  </button>
                );
              })}
            </div>
            <Button variant="outline" size="lg" onClick={() => void doExport()} disabled={exporting || total === 0} className="hidden sm:inline-flex">
              {exporting ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} {t("orders.list.export")}
            </Button>
            {newButton}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-lg" className="sm:hidden" aria-label={t("orders.common.more")}>
                  <MoreVerticalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="h-10" onSelect={() => void doExport()} disabled={total === 0}>
                  <DownloadIcon /> {t("orders.list.export")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <DataTableToolbar
        table={st.table}
        showColumns={view === "list"}
        quickFilters={
          <ChipGroup<StatusTab | "">
            value={pill}
            onChange={(v) => st.filters.status.set(v === "all" || v === "" ? [] : [v])}
            size="sm"
            aria-label={t("orders.list.filterStatus")}
            className={cn(view === "board" && "md:hidden")}
            options={STATUS_TABS.map((x) => ({
              value: x,
              label: x === "all" ? t("orders.list.all") : t(`orders.status.${x}`),
              meta: counts ? (x === "all" ? totalCount(counts) : counts[x] || undefined) : undefined,
            }))}
          />
        }
      />

      {view === "board" && (
        <div className="hidden md:block">
          <KanbanBoard filters={base} returnsEnabled={returnsEnabled} onMove={mover.request} canMove={mover.canMove} />
        </div>
      )}

      <div className={cn(view === "board" && "md:hidden")}>
        <DataTable
          table={st.table}
          onRowClick={(o) => navigate(`orders/${o.id}`)}
          empty={
            filtered ? undefined : (
              <EmptyState
                className="border-0 bg-transparent"
                illustration={<OrdersIllustration />}
                title={t("orders.list.emptyTitle")}
                description={t("orders.list.emptyBody")}
                action={newButton || undefined}
              />
            )
          }
          bulkActions={(rows, clear) => {
            const packable = rows.filter((o) => canMarkPacked(o.status));
            return (
              <>
                {can(PERMS.manage) && (
                  <Button size="sm" variant="outline" disabled={!!bulkBusy || packable.length === 0} onClick={() => void markPacked(rows, clear)}>
                    {bulkBusy === "pack" ? <Loader2Icon className="animate-spin" /> : <PackageCheckIcon />}
                    <span className="hidden sm:inline">{t("orders.bulk.markPacked")}</span>
                    {packable.length > 0 && packable.length < rows.length && <span className="tabular-nums">({packable.length})</span>}
                  </Button>
                )}
                <Button size="sm" variant="outline" disabled={!!bulkBusy} onClick={() => void printSlips(rows)}>
                  {bulkBusy === "print" ? <Loader2Icon className="animate-spin" /> : <PrinterIcon />}
                  <span className="hidden sm:inline">{t("orders.bulk.printSlips")}</span>
                </Button>
              </>
            );
          }}
        />
      </div>

      {mover.dialogs}
    </Page>
  );
}

/** "14 Oct, 6:42 pm" in IST. */
function PlacedAt({ iso }: { iso: string }) {
  const { formatDate } = useI18n();
  return (
    <time dateTime={iso} className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
      {formatDate(iso, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
    </time>
  );
}

function RowMenu({
  order,
  returnsEnabled,
  onMove,
  canMove,
}: {
  order: OrderSummary;
  returnsEnabled: boolean;
  onMove: (o: MovableOrder, to: OrderStatus) => void;
  canMove: (to: OrderStatus) => boolean;
}) {
  const { t } = useI18n();
  const moves = allowedTransitions(order.status, { returnsEnabled }).filter(canMove);
  const openSlip = () =>
    void openPdfs([{ path: docPath.packingSlip(order.id), title: t("orders.docs.packingSlipFor", { number: order.number }) }], {
      loadingTitle: t("orders.docs.loading"),
      pageTitle: t("orders.docs.packingSlips"),
    }).catch((err) => toast.error(describeError(err, t)));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("orders.common.actionsFor", { name: order.number })}>
          <MoreVerticalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem asChild className="h-10">
          <ModuleLink to={`orders/${order.id}`}>
            <EyeIcon /> {t("orders.list.open")}
          </ModuleLink>
        </DropdownMenuItem>
        <DropdownMenuItem className="h-10" onSelect={openSlip}>
          <PrinterIcon /> {t("orders.docs.packingSlip")}
        </DropdownMenuItem>
        {moves.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t("orders.list.moveTo")}</DropdownMenuLabel>
            {moves.map((s) => (
              <DropdownMenuItem key={s} className="h-10" variant={s === "cancelled" ? "destructive" : "default"} onSelect={() => onMove(order, s)}>
                {t(`orders.action.${s}`)}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

