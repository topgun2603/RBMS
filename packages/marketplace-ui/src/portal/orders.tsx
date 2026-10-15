"use client";

import * as React from "react";
import { DownloadIcon, InfoIcon, ReceiptTextIcon } from "lucide-react";
import { Alert, AlertDescription, Button, ChipGroup, cn, toast } from "@srirealtime/ui";
import { describeError, Page, PageHeading, QueryError, useI18n } from "@srirealtime/web";
import { Pager, RowsSkeleton, VendorOrdersList } from "../components/lists";
import { MP } from "../lib/queries";
import { useMyOrders, useVendor, vendorDownload } from "../lib/vendor";
import type { OrderStatus } from "../lib/types";

type Filter = "all" | "open" | OrderStatus;
const PAGE = 20;
/** Ship-by hint for open orders: two days after the order was placed. */
const SHIP_BY_DAYS = 2;

/**
 * The seller's orders (their lines of each customer order). Read-only: order status is changed by the shop (the API
 * has no seller "mark packed" endpoint yet), so the page explains that instead of offering the button.
 */
export default function MyOrdersPage() {
  const { t } = useI18n();
  const { vendorId } = useVendor();
  const [filter, setFilter] = React.useState<Filter>("all");
  const [offset, setOffset] = React.useState(0);
  React.useEffect(() => setOffset(0), [filter]);
  const status = filter === "all" || filter === "open" ? undefined : filter;
  const q = useMyOrders({ status, limit: filter === "open" ? 100 : PAGE, offset: filter === "open" ? 0 : offset });
  const items = (q.data?.items ?? []).filter((o) => filter !== "open" || ["placed", "confirmed", "packed"].includes(o.status));

  const download = async () => {
    try {
      await vendorDownload(vendorId, `${MP}/vendor/orders`, { format: "csv", ...(status ? { status } : {}) }, "seller-orders.csv");
    } catch (err) {
      toast.error(describeError(err, t));
    }
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
        <AlertDescription>{t("marketplace.orders.readOnlyNote")}</AlertDescription>
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
          <VendorOrdersList items={items} shipByDays={SHIP_BY_DAYS} />
          {filter !== "open" && <Pager offset={offset} limit={PAGE} total={q.data.total} onChange={setOffset} />}
        </div>
      )}
    </Page>
  );
}
