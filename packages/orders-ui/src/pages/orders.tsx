"use client";

import * as React from "react";
import {
  ArrowRightIcon,
  DownloadIcon,
  EyeIcon,
  FilterXIcon,
  KanbanSquareIcon,
  ListIcon,
  Loader2Icon,
  MoreVerticalIcon,
  PackageCheckIcon,
  PlusIcon,
  PrinterIcon,
  ShoppingBagIcon,
  XIcon,
} from "lucide-react";
import {
  AnimatePresence,
  Button,
  Card,
  Checkbox,
  ChipGroup,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  motion,
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
import {
  describeError,
  ModuleLink,
  Page,
  PageHeading,
  QueryError,
  SearchField,
  useDebounced,
  useFeature,
  useI18n,
  useModuleNavigate,
  useQueryParams,
} from "@srirealtime/web";
import { OrdersIllustration } from "../components/illustrations";
import { KanbanBoard } from "../components/kanban";
import { OrderStatusPill, PaymentPill } from "../components/pills";
import { useStatusMover, type MovableOrder } from "../components/status-actions";
import { PERMS, usePermissions } from "../lib/access";
import { docPath, openPdfs } from "../lib/documents";
import { formatPhone, money, presetRange, todayIST, DATE_PRESETS, type DatePreset } from "../lib/format";
import { exportOrdersCsv, useOrderList, useUpdateStatus } from "../lib/queries";
import { allowedTransitions, canMarkPacked, nextStep, STATUS_TABS, totalCount, type StatusTab } from "../lib/status";
import {
  ORDER_CHANNELS,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type OrderChannel,
  type OrderListFilters,
  type OrderStatus,
  type OrderSummary,
  type PaymentStatus,
} from "../lib/types";

const ALL = "__all";
type View = "list" | "board";

const pick = <T extends string>(v: string | null, allowed: readonly T[]): T | "" => (v && (allowed as readonly string[]).includes(v) ? (v as T) : "");

export default function OrdersPage() {
  const { t } = useI18n();
  const params = useQueryParams();
  const navigate = useModuleNavigate();
  const { can } = usePermissions();
  const returnsEnabled = useFeature("orders.returns");
  const mover = useStatusMover();
  const update = useUpdateStatus();
  const canManage = can(PERMS.manage);

  const [q, setQ] = React.useState(params.get("q") ?? "");
  const [status, setStatus] = React.useState<StatusTab>(pick(params.get("status"), ORDER_STATUSES) || "all");
  const [payment, setPayment] = React.useState<PaymentStatus | "">(pick(params.get("payment"), PAYMENT_STATUSES));
  const [channel, setChannel] = React.useState<OrderChannel | "">(pick(params.get("channel"), ORDER_CHANNELS));
  const [preset, setPreset] = React.useState<DatePreset>(pick(params.get("range"), DATE_PRESETS) || "all");
  const [custom, setCustom] = React.useState({ from: params.get("from") ?? "", to: params.get("to") ?? "" });
  const [view, setView] = React.useState<View>(params.get("view") === "board" ? "board" : "list");
  const debounced = useDebounced(q.trim(), 300);

  const range = preset === "custom" ? { from: custom.from || undefined, to: custom.to || undefined } : presetRange(preset);
  const base = React.useMemo<OrderListFilters>(
    () => ({ q: debounced || undefined, paymentStatus: payment || undefined, channel: channel || undefined, ...range }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- range is derived from preset/custom
    [debounced, payment, channel, preset, custom.from, custom.to],
  );
  const filters = React.useMemo<OrderListFilters>(() => ({ ...base, status: status === "all" ? undefined : status }), [base, status]);

  // Filters live in the URL (shareable; back from an order keeps them).
  React.useEffect(() => {
    const sp = new URLSearchParams();
    if (base.q) sp.set("q", base.q);
    if (status !== "all") sp.set("status", status);
    if (payment) sp.set("payment", payment);
    if (channel) sp.set("channel", channel);
    if (preset !== "all") sp.set("range", preset);
    if (preset === "custom" && custom.from) sp.set("from", custom.from);
    if (preset === "custom" && custom.to) sp.set("to", custom.to);
    if (view === "board") sp.set("view", "board");
    const next = sp.toString();
    if (next !== params.toString()) navigate(next ? `?${next}` : "?", { replace: true, scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the filters change
  }, [base, status, view]);

  const list = useOrderList(filters);
  const items = React.useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const counts = list.data?.pages[0]?.counts;
  const total = list.data?.pages[0]?.total ?? 0;
  const filtered = !!(base.q || base.paymentStatus || base.channel || base.from || base.to);

  // ---- selection (list view)
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  React.useEffect(() => setSelected(new Set()), [filters]);
  const allOnPage = items.length > 0 && items.every((i) => selected.has(i.id));
  const someOnPage = items.some((i) => selected.has(i.id));
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const selectedOrders = items.filter((i) => selected.has(i.id));
  const packable = selectedOrders.filter((o) => canMarkPacked(o.status));

  const [bulkBusy, setBulkBusy] = React.useState<"pack" | "print" | null>(null);
  const markPacked = async () => {
    if (packable.length === 0) return;
    setBulkBusy("pack");
    const id = toast.loading(t("orders.bulk.packing", { count: packable.length }));
    const results = await Promise.allSettled(packable.map((o) => update.mutateAsync({ id: o.id, from: o.status, body: { status: "packed" } })));
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length === 0) toast.success(t("orders.bulk.packed", { count: packable.length }), { id });
    else toast.warning(t("orders.bulk.partial", { failed: failed.length, count: packable.length }), { id, description: describeError((failed[0] as PromiseRejectedResult).reason, t) });
    setSelected(new Set());
    setBulkBusy(null);
  };
  const printSlips = async () => {
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
      await exportOrdersCsv(filters);
      toast.success(t("orders.list.exported"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setExporting(false);
    }
  };

  const clearFilters = () => {
    setQ("");
    setPayment("");
    setChannel("");
    setPreset("all");
    setCustom({ from: "", to: "" });
  };

  const newButton = canManage && (
    <Button asChild size="lg">
      <ModuleLink to="orders/new">
        <PlusIcon /> {t("orders.list.new")}
      </ModuleLink>
    </Button>
  );

  const quick = (o: OrderSummary) => {
    const next = nextStep(o.status, allowedTransitions(o.status, { returnsEnabled }));
    return next && mover.canMove(next) ? next : null;
  };

  return (
    <Page wide className="max-w-7xl">
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

      {/* Filters */}
      <div className="mb-4 grid gap-3">
        <div className="grid items-start gap-2 md:grid-cols-[minmax(0,1fr)_11rem_11rem_11rem]">
          <SearchField value={q} onChange={setQ} placeholder={t("orders.list.search")} />
          <Select value={payment || ALL} onValueChange={(v) => setPayment(v === ALL ? "" : (v as PaymentStatus))}>
            <SelectTrigger size="lg" className="w-full rounded-xl bg-card" aria-label={t("orders.list.filterPayment")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("orders.list.allPayments")}</SelectItem>
              {PAYMENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`orders.paymentStatus.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={channel || ALL} onValueChange={(v) => setChannel(v === ALL ? "" : (v as OrderChannel))}>
            <SelectTrigger size="lg" className="w-full rounded-xl bg-card" aria-label={t("orders.list.filterChannel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("orders.list.allChannels")}</SelectItem>
              {ORDER_CHANNELS.map((c) => (
                <SelectItem key={c} value={c}>
                  {t(`orders.channel.${c}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={preset} onValueChange={(v) => setPreset(v as DatePreset)}>
            <SelectTrigger size="lg" className="w-full rounded-xl bg-card" aria-label={t("orders.list.filterDate")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_PRESETS.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`orders.range.${p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {preset === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              className="w-40"
              aria-label={t("orders.range.from")}
              value={custom.from}
              max={custom.to || todayIST()}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="date"
              className="w-40"
              aria-label={t("orders.range.to")}
              value={custom.to}
              min={custom.from}
              max={todayIST()}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
            />
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <ChipGroup<StatusTab>
            value={status}
            onChange={setStatus}
            size="sm"
            aria-label={t("orders.list.filterStatus")}
            className={cn(view === "board" && "md:hidden")}
            options={STATUS_TABS.map((s) => ({
              value: s,
              label: s === "all" ? t("orders.list.all") : t(`orders.status.${s}`),
              meta: counts ? (s === "all" ? totalCount(counts) : counts[s] || undefined) : undefined,
            }))}
          />
          {filtered && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="shrink-0">
              <FilterXIcon /> <span className="hidden sm:inline">{t("orders.list.clearFilters")}</span>
            </Button>
          )}
        </div>
      </div>

      {view === "board" && (
        <div className="hidden md:block">
          <KanbanBoard filters={base} returnsEnabled={returnsEnabled} onMove={mover.request} canMove={mover.canMove} />
        </div>
      )}

      <div className={cn(view === "board" && "md:hidden")}>
        {list.isError ? (
          <QueryError error={list.error} onRetry={() => void list.refetch()} />
        ) : list.isPending ? (
          <ListSkeleton />
        ) : items.length === 0 ? (
          <EmptyState
            illustration={filtered || status !== "all" ? undefined : <OrdersIllustration />}
            icon={ShoppingBagIcon}
            title={filtered || status !== "all" ? t("orders.list.noMatch") : t("orders.list.emptyTitle")}
            description={filtered || status !== "all" ? t("orders.list.noMatchBody") : t("orders.list.emptyBody")}
            action={
              filtered ? (
                <Button variant="outline" size="lg" onClick={clearFilters}>
                  <FilterXIcon /> {t("orders.list.clearFilters")}
                </Button>
              ) : status === "all" ? (
                newButton || undefined
              ) : undefined
            }
          />
        ) : (
          <div className={cn("transition-opacity", list.isPlaceholderData && "opacity-60")}>
            {/* Desktop table */}
            <Card className="hidden gap-0 overflow-hidden py-0 md:flex">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="w-10 pl-4">
                      <Checkbox
                        checked={allOnPage ? true : someOnPage ? "indeterminate" : false}
                        onCheckedChange={(v) => setSelected(v === true ? new Set(items.map((i) => i.id)) : new Set())}
                        aria-label={t("orders.list.selectAll")}
                      />
                    </TableHead>
                    <TableHead>{t("orders.list.col.order")}</TableHead>
                    <TableHead>{t("orders.list.col.customer")}</TableHead>
                    <TableHead className="text-right">{t("orders.list.col.items")}</TableHead>
                    <TableHead className="text-right">{t("orders.list.col.total")}</TableHead>
                    <TableHead>{t("orders.list.col.payment")}</TableHead>
                    <TableHead>{t("orders.list.col.status")}</TableHead>
                    <TableHead className="w-44 pr-4 text-right">
                      <span className="sr-only">{t("orders.common.actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((o) => {
                    const next = quick(o);
                    return (
                      <TableRow key={o.id} data-state={selected.has(o.id) ? "selected" : undefined} className="group">
                        <TableCell className="pl-4">
                          <Checkbox checked={selected.has(o.id)} onCheckedChange={(v) => toggle(o.id, v === true)} aria-label={t("orders.list.selectOne", { number: o.number })} />
                        </TableCell>
                        <TableCell>
                          <ModuleLink to={`orders/${o.id}`} className="grid rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <span className="font-semibold whitespace-nowrap group-hover:text-primary">{o.number}</span>
                            <PlacedAt iso={o.placedAt} />
                          </ModuleLink>
                        </TableCell>
                        <TableCell className="max-w-[16rem]">
                          <p className="truncate font-medium">{o.customerName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[o.customerPhone && formatPhone(o.customerPhone), t(`orders.channel.${o.channel}`)].filter(Boolean).join(" · ")}
                          </p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{o.itemCount}</TableCell>
                        <TableCell className="text-right font-semibold whitespace-nowrap tabular-nums">{money(o.total)}</TableCell>
                        <TableCell>
                          <PaymentPill status={o.paymentStatus} />
                        </TableCell>
                        <TableCell>
                          <OrderStatusPill status={o.status} />
                        </TableCell>
                        <TableCell className="pr-4">
                          <div className="flex items-center justify-end gap-1">
                            {next && (
                              <Button size="sm" variant="outline" disabled={mover.busyId === o.id} onClick={() => mover.request(o, next)} className="whitespace-nowrap">
                                {mover.busyId === o.id ? <Loader2Icon className="animate-spin" /> : <ArrowRightIcon />}
                                {t(`orders.action.${next}`)}
                              </Button>
                            )}
                            <RowMenu order={o} returnsEnabled={returnsEnabled} onMove={mover.request} canMove={mover.canMove} />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>

            {/* Phone cards */}
            <Stagger key={JSON.stringify(filters)} className="grid gap-2.5 md:hidden">
              {items.map((o) => {
                const next = quick(o);
                return (
                  <StaggerItem key={o.id}>
                    <Card className={cn("gap-2.5 p-3", selected.has(o.id) && "ring-2 ring-primary/50")}>
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={selected.has(o.id)}
                          onCheckedChange={(v) => toggle(o.id, v === true)}
                          aria-label={t("orders.list.selectOne", { number: o.number })}
                          className="mt-0.5 size-5"
                        />
                        <ModuleLink to={`orders/${o.id}`} className="min-w-0 flex-1 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate font-semibold">{o.number}</span>
                            <span className="shrink-0 font-semibold tabular-nums">{money(o.total)}</span>
                          </div>
                          <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                            <span className="truncate">{o.customerName}</span>
                            <PlacedAt iso={o.placedAt} />
                          </div>
                        </ModuleLink>
                        <RowMenu order={o} returnsEnabled={returnsEnabled} onMove={mover.request} canMove={mover.canMove} />
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 pl-8">
                        <OrderStatusPill status={o.status} />
                        <PaymentPill status={o.paymentStatus} />
                        <span className="text-xs text-muted-foreground">{t("orders.list.itemCount", { count: o.itemCount })}</span>
                        {next && (
                          <Button size="sm" variant="secondary" className="ml-auto" disabled={mover.busyId === o.id} onClick={() => mover.request(o, next)}>
                            {mover.busyId === o.id ? <Loader2Icon className="animate-spin" /> : <ArrowRightIcon />}
                            {t(`orders.action.${next}`)}
                          </Button>
                        )}
                      </div>
                    </Card>
                  </StaggerItem>
                );
              })}
            </Stagger>

            <div className="mt-3 flex flex-col items-center gap-2">
              {list.hasNextPage && (
                <Button variant="ghost" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                  {list.isFetchingNextPage && <Loader2Icon className="animate-spin" />}
                  {t("orders.common.loadMore")}
                </Button>
              )}
              <p className="text-xs text-muted-foreground">{t("orders.list.showing", { shown: items.length, total })}</p>
            </div>
          </div>
        )}
      </div>

      {/* Bulk bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-2xl md:bottom-6"
            role="region"
            aria-label={t("orders.bulk.label")}
          >
            <div className="flex items-center gap-2 rounded-2xl border border-card-ring bg-card/95 p-2 pl-4 shadow-raised backdrop-blur">
              <p className="min-w-0 flex-1 truncate text-sm font-medium">{t("orders.bulk.selected", { count: selected.size })}</p>
              {can(PERMS.manage) && (
                <Button size="sm" variant="outline" disabled={!!bulkBusy || packable.length === 0} onClick={() => void markPacked()}>
                  {bulkBusy === "pack" ? <Loader2Icon className="animate-spin" /> : <PackageCheckIcon />}
                  <span className="hidden sm:inline">{t("orders.bulk.markPacked")}</span>
                  {packable.length > 0 && packable.length < selected.size && <span className="tabular-nums">({packable.length})</span>}
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={!!bulkBusy} onClick={() => void printSlips()}>
                {bulkBusy === "print" ? <Loader2Icon className="animate-spin" /> : <PrinterIcon />}
                <span className="hidden sm:inline">{t("orders.bulk.printSlips")}</span>
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => setSelected(new Set())} aria-label={t("orders.bulk.clear")}>
                <XIcon />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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

function ListSkeleton() {
  return (
    <>
      <Card className="hidden gap-0 divide-y py-1 md:flex">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-5 px-4 py-3.5">
            <Skeleton className="size-4 rounded" />
            <div className="w-36 space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-8 w-28 rounded-lg" />
          </div>
        ))}
      </Card>
      <div className="grid gap-2.5 md:hidden">
        {Array.from({ length: 6 }, (_, i) => (
          <Card key={i} className="gap-2 p-3">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-3 w-40" />
            <div className="flex gap-2">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
