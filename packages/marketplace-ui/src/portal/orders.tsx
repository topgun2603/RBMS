"use client";

import * as React from "react";
import { DownloadIcon, HourglassIcon, InfoIcon, Loader2Icon, PackageCheckIcon, ReceiptTextIcon, TruckIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  Button,
  ChipGroup,
  cn,
  DataTable,
  DataTableToolbar,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldError,
  FieldLabel,
  FieldRow,
  Input,
  StatusPill,
  toast,
  type DataTableColumn,
} from "@srirealtime/ui";
import { api, describeError, Page, PageHeading, useI18n, useServerTable, type ServerFilterDefs } from "@srirealtime/web";
import { SubmitButton } from "../components/account";
import { OrderStatusPill, SettlementPill } from "../components/bits";
import { VendorOrderSheet } from "../components/table-columns";
import { fulfilmentStep, money, saleAmountOf } from "../lib/logic";
import { MP } from "../lib/queries";
import { useMarkPacked, useMarkShipped, useVendor, vendorDownload, vendorOpts } from "../lib/vendor";
import { ORDER_STATUSES, type ListResult, type VendorOrder } from "../lib/types";

/** Ship-by hint for open orders: two days after the order was placed. */
const SHIP_BY_DAYS = 2;
/** The seller's open orders (the "To ship" pill): the API's `step` filter. */
const OPEN_STEPS = ["to_confirm", "to_pack", "to_ship"];
const PILL_STATUSES = ["shipped", "delivered", "returned", "cancelled"] as const;
type Pill = "all" | "open" | (typeof PILL_STATUSES)[number] | "";

/**
 * The seller's orders (their lines of each customer order). The seller marks their part packed, then shipped with a
 * tracking number; when the order has only their items the whole order moves (and the customer is told), otherwise
 * the shop finishes it.
 */
export default function MyOrdersPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <MyOrders />
    </React.Suspense>
  );
}

function MyOrders() {
  const { t, formatDate } = useI18n();
  const { vendorId, self } = useVendor();
  const [shipping, setShipping] = React.useState<VendorOrder | null>(null);
  const [open, setOpen] = React.useState<VendorOrder | null>(null);
  const pack = useMarkPacked();
  const suspended = self?.status === "suspended";

  const packAsync = pack.mutateAsync;
  const markPacked = React.useCallback(
    async (o: VendorOrder) => {
      try {
        const r = await packAsync(o.id);
        toast.success(t(r.status === "packed" ? "marketplace.orders.packedDone" : "marketplace.orders.packedPart", { number: o.orderNumber }));
      } catch (err) {
        toast.error(describeError(err, t));
      }
    },
    [packAsync, t],
  );
  const busyId = pack.isPending ? pack.variables : undefined;

  const actions = React.useCallback(
    (o: VendorOrder) => {
      if (suspended) return null;
      const step = fulfilmentStep(o);
      if (step === "to_confirm")
        return (
          <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap text-muted-foreground" data-testid="awaiting-confirmation">
            <HourglassIcon className="size-4" /> {t("marketplace.orders.awaitingConfirm")}
          </span>
        );
      if (step === "to_pack") {
        const busy = busyId === o.id;
        return (
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setShipping(o)} disabled={busy}>
              <TruckIcon /> {t("marketplace.orders.markShipped")}
            </Button>
            <Button size="sm" onClick={() => void markPacked(o)} disabled={busy} data-testid="mark-packed">
              {busy ? <Loader2Icon className="animate-spin" /> : <PackageCheckIcon />} {t("marketplace.orders.markPacked")}
            </Button>
          </div>
        );
      }
      if (step === "to_ship")
        return (
          <Button size="sm" onClick={() => setShipping(o)} data-testid="mark-shipped">
            <TruckIcon /> {t("marketplace.orders.markShipped")}
          </Button>
        );
      return null;
    },
    [suspended, busyId, markPacked, t],
  );

  const filters = React.useMemo(
    () =>
      ({
        status: {
          kind: "options",
          label: t("marketplace.orders.filterStatus"),
          options: ORDER_STATUSES.map((s) => ({ value: s, label: t(`marketplace.orderStatus.${s}`) })),
        },
        date: { kind: "dateRange", label: t("marketplace.orders.filterDate") },
        // Driven by the "To ship" pill.
        step: { kind: "options", label: t("marketplace.orders.open"), options: OPEN_STEPS.map((s) => ({ value: s, label: s })), hidden: true },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<VendorOrder>[]>(
    () => [
      {
        id: "number",
        header: t("marketplace.orders.col.order"),
        sortable: true,
        hideable: false,
        card: "title",
        cell: (o) => <span className="font-medium tabular-nums">{o.orderNumber}</span>,
      },
      {
        id: "date",
        header: t("marketplace.orders.col.placed"),
        sortable: true,
        sortDescFirst: true,
        card: "subtitle",
        cell: (o) => <ShipBy order={o} />,
        cardCell: (o) => (
          <span>
            {formatDate(o.placedAt, { day: "numeric", month: "short" })} · {t("marketplace.orders.items", { count: o.lines.reduce((n, l) => n + l.qty, 0) })}
          </span>
        ),
      },
      {
        id: "items",
        header: t("marketplace.orders.col.items"),
        hideBelow: "md",
        className: "max-w-[16rem]",
        cell: (o) => (
          <div className="grid min-w-0">
            <span className="truncate">{o.lines.map((l) => l.name).join(", ")}</span>
            <span className="text-xs text-muted-foreground">{t("marketplace.orders.items", { count: o.lines.reduce((n, l) => n + l.qty, 0) })}</span>
          </div>
        ),
      },
      { id: "status", header: t("marketplace.orders.col.status"), sortable: true, card: "meta", cell: (o) => <StatusCell order={o} /> },
      {
        id: "settlement",
        header: t("marketplace.orders.col.settlement"),
        hideBelow: "lg",
        card: "meta",
        cell: (o) => <SettlementPill status={o.settlementStatus} />,
      },
      {
        id: "total",
        header: t("marketplace.orders.col.sale"),
        sortable: true,
        numeric: true,
        hideBelow: "md",
        cell: (o) => <span className="text-muted-foreground">{money(saleAmountOf(o))}</span>,
      },
      {
        id: "net",
        header: t("marketplace.orders.col.net"),
        sortable: true,
        numeric: true,
        hideable: false,
        card: "right",
        cell: (o) => <span className="font-semibold">{money(o.net)}</span>,
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("marketplace.orders.col.actions")}</span>,
        label: t("marketplace.orders.col.actions"),
        hideable: false,
        align: "right",
        card: "meta",
        cell: (o) => actions(o),
      },
    ],
    [t, formatDate, actions],
  );

  const st = useServerTable<VendorOrder, typeof filters>({
    queryKey: ["marketplace", "self", vendorId, "orders", "table"],
    path: `${MP}/vendor/orders`,
    fetcher: (params, signal) => api.get<ListResult<VendorOrder>>(`${MP}/vendor/orders`, params, vendorOpts(vendorId, { signal })),
    columns,
    filters,
    defaultSort: "-date",
    search: t("marketplace.orders.search"),
    storageKey: "marketplace-seller-orders",
  });

  // Pills: one status, or "To ship" (the open steps), over the same URL filters.
  const status = st.filters.status.value;
  const step = st.filters.step.value;
  const pill: Pill =
    status.length === 0 && step.length === 0
      ? "all"
      : status.length === 0 && step.length === OPEN_STEPS.length && OPEN_STEPS.every((s) => step.includes(s))
        ? "open"
        : step.length === 0 && status.length === 1 && (PILL_STATUSES as readonly string[]).includes(status[0]!)
          ? (status[0] as Pill)
          : "";
  const setPill = (v: Pill) =>
    st.update({ filters: { status: v === "all" || v === "open" || v === "" ? [] : [v], step: v === "open" ? OPEN_STEPS : [] } });
  const statusCounts = st.facets?.status;
  const stepCounts = st.facets?.step;
  const openCount = stepCounts ? OPEN_STEPS.reduce((n, s) => n + (stepCounts[s] ?? 0), 0) : undefined;
  const filtered = st.table.activeFilterCount > 0;

  const download = async () => {
    const { limit: _l, offset: _o, ...q } = st.apiParams;
    try {
      await vendorDownload(vendorId, `${MP}/vendor/orders`, { ...q, format: "csv" }, "seller-orders.csv");
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Page width="full">
      <PageHeading
        icon={ReceiptTextIcon}
        title={t("marketplace.orders.title")}
        description={st.total ? t("marketplace.orders.count", { count: st.total }) : t("marketplace.orders.subtitle")}
        actions={
          <Button variant="outline" size="lg" onClick={() => void download()}>
            <DownloadIcon /> <span className="hidden sm:inline">{t("marketplace.common.exportCsv")}</span>
          </Button>
        }
      />
      <Alert className="mb-4">
        <InfoIcon />
        <AlertDescription>{t("marketplace.orders.fulfilNote")}</AlertDescription>
      </Alert>
      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup<Pill>
            value={pill}
            onChange={setPill}
            size="sm"
            aria-label={t("marketplace.orders.filter")}
            options={[
              { value: "all", label: t("marketplace.vendors.tabAll") },
              { value: "open", label: t("marketplace.orders.open"), meta: openCount || undefined },
              ...PILL_STATUSES.map((s) => ({ value: s, label: t(`marketplace.orderStatus.${s}`), meta: statusCounts ? statusCounts[s] || undefined : undefined })),
            ]}
          />
        }
      />
      <DataTable
        table={st.table}
        onRowClick={setOpen}
        empty={filtered ? undefined : <EmptyState className="border-0 bg-transparent" icon={ReceiptTextIcon} title={t("marketplace.orders.emptyTitle")} description={t("marketplace.orders.emptyBody")} />}
      />
      <VendorOrderSheet order={open} onClose={() => setOpen(null)} actions={actions} />
      <ShipDialog order={shipping} onOpenChange={(o) => !o && setShipping(null)} />
    </Page>
  );
}

/** Placed date with the ship-by hint for open orders (late ones in red). */
function ShipBy({ order: o }: { order: VendorOrder }) {
  const { t, formatDate } = useI18n();
  const step = fulfilmentStep(o);
  const shipBy = step === "to_pack" || step === "to_confirm" ? new Date(new Date(o.placedAt).getTime() + SHIP_BY_DAYS * 86_400_000) : null;
  const late = shipBy ? shipBy.getTime() < Date.now() : false;
  return (
    <div className="grid">
      <span className="whitespace-nowrap tabular-nums">{formatDate(o.placedAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
      {shipBy && (
        <span className={cn("text-xs whitespace-nowrap", late ? "font-medium text-danger-ink" : "text-muted-foreground")}>
          {t(late ? "marketplace.orders.shipLate" : "marketplace.orders.shipBy", { date: formatDate(shipBy, { day: "numeric", month: "short" }) })}
        </span>
      )}
    </div>
  );
}

/** Order status, plus the seller's own packed / shipped mark while a split order waits for the others. */
function StatusCell({ order: o }: { order: VendorOrder }) {
  const { t } = useI18n();
  const step = fulfilmentStep(o);
  const ownMark = step === "shipped" && o.status !== "shipped" ? "shipped" : step === "to_ship" && o.status !== "packed" ? "packed" : null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <OrderStatusPill status={o.status} />
      {ownMark && (
        <StatusPill tone="brand" icon={ownMark === "shipped" ? TruckIcon : PackageCheckIcon} data-testid={`own-${ownMark}`}>
          {t(`marketplace.orders.own.${ownMark}`)}
        </StatusPill>
      )}
    </div>
  );
}

/** Mark shipped: courier (optional) and the tracking number the customer gets. */
function ShipDialog({ order, onOpenChange }: { order: VendorOrder | null; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const ship = useMarkShipped();
  const [carrier, setCarrier] = React.useState("");
  const [tracking, setTracking] = React.useState("");
  const [tried, setTried] = React.useState(false);
  React.useEffect(() => {
    if (order) {
      setCarrier("");
      setTracking("");
      setTried(false);
    }
  }, [order]);
  const error = tracking.trim().length < 3 ? t("marketplace.orders.trackingNeeded") : null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (error || !order) return;
    try {
      const r = await ship.mutateAsync({ id: order.id, carrier: carrier.trim() || null, trackingNumber: tracking.trim() });
      toast.success(t(r.status === "shipped" ? "marketplace.orders.shippedDone" : "marketplace.orders.shippedPart", { number: order.orderNumber }));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={!!order} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("marketplace.common.close")}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t("marketplace.orders.shipTitle", { number: order?.orderNumber ?? "" })}</DialogTitle>
            <DialogDescription>{t("marketplace.orders.shipBody")}</DialogDescription>
          </DialogHeader>
          <FieldRow>
            <Field>
              <FieldLabel optional={t("marketplace.common.optional")}>{t("marketplace.orders.carrier")}</FieldLabel>
              <FieldControl>
                <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} maxLength={60} placeholder={t("marketplace.orders.carrierPlaceholder")} />
              </FieldControl>
            </Field>
            <Field invalid={tried && !!error}>
              <FieldLabel>{t("marketplace.orders.trackingNumber")}</FieldLabel>
              <FieldControl>
                <Input value={tracking} onChange={(e) => setTracking(e.target.value)} maxLength={80} autoFocus data-testid="tracking-number" />
              </FieldControl>
              <FieldError>{tried ? error : null}</FieldError>
            </Field>
          </FieldRow>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("marketplace.common.cancel")}
            </Button>
            <SubmitButton pending={ship.isPending} data-testid="ship-submit">
              <TruckIcon /> {t("marketplace.orders.markShipped")}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
