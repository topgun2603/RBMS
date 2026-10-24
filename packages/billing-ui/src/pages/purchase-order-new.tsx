"use client";

import { ClipboardListIcon } from "lucide-react";
import { Page, PageHeading, useI18n } from "@srirealtime/web";
import { PurchaseForm } from "../components/inventory/purchase-form";

export default function NewPurchaseOrderPage() {
  const { t } = useI18n();
  return (
    <Page>
      <PageHeading
        icon={ClipboardListIcon}
        title={t("billing.po.newTitle")}
        description={t("billing.po.newSubtitle")}
        back={{ href: "purchase-orders", label: t("billing.po.title") }}
      />
      <PurchaseForm mode="order" />
    </Page>
  );
}
