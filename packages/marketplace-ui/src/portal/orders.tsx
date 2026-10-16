"use client";

import * as React from "react";
import { DownloadIcon, HourglassIcon, InfoIcon, Loader2Icon, PackageCheckIcon, ReceiptTextIcon, TruckIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  Button,
  ChipGroup,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldError,
  FieldLabel,
  FieldRow,
  Input,
  toast,
} from "@srirealtime/ui";
import { describeError, Page, PageHeading, QueryError, useI18n } from "@srirealtime/web";
import { SubmitButton } from "../components/account";
import { Pager, RowsSkeleton, VendorOrdersList } from "../components/lists";
import { fulfilmentStep } from "../lib/logic";
import { MP } from "../lib/queries";
import { useMarkPacked, useMarkShipped, useMyOrders, useVendor, vendorDownload } from "../lib/vendor";
import type { OrderStatus, VendorOrder } from "../lib/types";

type Filter = "all" | "open" | OrderStatus;
const PAGE = 20;
/** Ship-by hint for open orders: two days after the order was placed. */
const SHIP_BY_DAYS = 2;

/**
 * The seller's orders (their lines of each customer order). The seller marks their part packed, then shipped with a
 * tracking number; when the order has only their items the whole order moves (and the customer is told), otherwise
 * the shop finishes it.
 */
export default function MyOrdersPage() {
  const { t } = useI18n();
  const { vendorId, self } = useVendor();
  const [filter, setFilter] = React.useState<Filter>("all");
  const [offset, setOffset] = React.useState(0);
  const [shipping, setShipping] = React.useState<VendorOrder | null>(null);
  React.useEffect(() => setOffset(0), [filter]);
  const status = filter === "all" || filter === "open" ? undefined : filter;
  const q = useMyOrders({ status, limit: filter === "open" ? 100 : PAGE, offset: filter === "open" ? 0 : offset });
  const items = (q.data?.items ?? []).filter((o) => filter !== "open" || ["to_confirm", "to_pack", "to_ship"].includes(fulfilmentStep(o)));
  const pack = useMarkPacked();
  const suspended = self?.status === "suspended";

  const download = async () => {
    try {
      await vendorDownload(vendorId, `${MP}/vendor/orders`, { format: "csv", ...(status ? { status } : {}) }, "seller-orders.csv");
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const markPacked = async (o: VendorOrder) => {
    try {
      const r = await pack.mutateAsync(o.id);
      toast.success(t(r.status === "packed" ? "marketplace.orders.packedDone" : "marketplace.orders.packedPart", { number: o.orderNumber }));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const actions = (o: VendorOrder) => {
    if (suspended) return null;
    const step = fulfilmentStep(o);
    if (step === "to_confirm")
      return (
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="awaiting-confirmation">
          <HourglassIcon className="size-4" /> {t("marketplace.orders.awaitingConfirm")}
        </span>
      );
    if (step === "to_pack") {
      const busy = pack.isPending && pack.variables === o.id;
      return (
        <>
          <Button variant="outline" size="sm" onClick={() => setShipping(o)} disabled={busy}>
            <TruckIcon /> {t("marketplace.orders.markShipped")}
          </Button>
          <Button size="sm" onClick={() => void markPacked(o)} disabled={busy} data-testid="mark-packed">
            {busy ? <Loader2Icon className="animate-spin" /> : <PackageCheckIcon />} {t("marketplace.orders.markPacked")}
          </Button>
        </>
      );
    }
    if (step === "to_ship")
      return (
        <Button size="sm" onClick={() => setShipping(o)} data-testid="mark-shipped">
          <TruckIcon /> {t("marketplace.orders.markShipped")}
        </Button>
      );
    return null;
  };

  return (
    <Page>
      <PageHeading
        icon={ReceiptTextIcon}
        title={t("marketplace.orders.title")}
        description={t("marketplace.orders.subtitle")}
        actions={
          <Button variant="outline" size="lg" onClick={() => void download()}>
            <DownloadIcon /> {t("marketplace.common.exportCsv")}
          </Button>
        }
      />
      <Alert className="mb-4">
        <InfoIcon />
        <AlertDescription>{t("marketplace.orders.fulfilNote")}</AlertDescription>
      </Alert>
      <div className="mb-4 -mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
        <ChipGroup<Filter>
          value={filter}
          onChange={setFilter}
          size="sm"
          aria-label={t("marketplace.orders.filter")}
          options={[
            { value: "all", label: t("marketplace.vendors.tabAll") },
            { value: "open", label: t("marketplace.orders.open") },
            { value: "shipped", label: t("marketplace.orderStatus.shipped") },
            { value: "delivered", label: t("marketplace.orderStatus.delivered") },
            { value: "returned", label: t("marketplace.orderStatus.returned") },
            { value: "cancelled", label: t("marketplace.orderStatus.cancelled") },
          ]}
        />
      </div>
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <RowsSkeleton />
      ) : (
        <div className={cn("transition-opacity", q.isPlaceholderData && "opacity-60")}>
          <VendorOrdersList items={items} shipByDays={SHIP_BY_DAYS} actions={actions} />
          {filter !== "open" && <Pager offset={offset} limit={PAGE} total={q.data.total} onChange={setOffset} />}
        </div>
      )}
      <ShipDialog order={shipping} onOpenChange={(o) => !o && setShipping(null)} />
    </Page>
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
