"use client";

import * as React from "react";
import { StoreIcon, WalletIcon } from "lucide-react";
import { AnimatedNumber } from "@srirealtime/ui";
import { AttentionItem, InsightCard, QueryError, useI18n } from "@srirealtime/web";
import { money, previewPayouts } from "../lib/logic";
import { todayIST, useMarketplaceSettings, usePayoutPreviewData, useVendorList } from "../lib/queries";

/** Needs-attention row: seller applications waiting for approval. */
export function ApplicationsAttentionWidget() {
  const { t } = useI18n();
  const q = useVendorList({ status: "pending", offset: 0, limit: 1 });
  return (
    <AttentionItem
      label={t("marketplace.widget.attnApplications")}
      count={q.data?.counts.pending}
      tone="info"
      icon={StoreIcon}
      to="vendors?status=pending"
      loading={q.isPending}
      error={q.isError}
    />
  );
}

/** "More insights" card: what a payout run today would pay (the same client-side dry run as the payouts screen). */
export function PayableWidget() {
  const { t } = useI18n();
  const until = todayIST();
  const settings = useMarketplaceSettings();
  const data = usePayoutPreviewData(until);
  const preview = React.useMemo(
    () => (data.data && settings.data ? previewPayouts(data.data.vendors.map((v) => ({ ...v, balance: v.balance.balance })), data.data.orders, settings.data, data.data.until) : null),
    [data.data, settings.data],
  );
  return (
    <InsightCard
      icon={WalletIcon}
      title={t("marketplace.widget.payable")}
      to="payouts"
      linkLabel={t("marketplace.widget.view")}
      loading={!data.isError && !preview}
      value={preview ? <AnimatedNumber value={preview.total} from={0} format={money} /> : undefined}
      caption={preview ? t("marketplace.widget.payableBody", { count: preview.pay.length, skipped: preview.skip.length }) : undefined}
    >
      {data.isError && <QueryError compact error={data.error} onRetry={() => void data.refetch()} />}
    </InsightCard>
  );
}
