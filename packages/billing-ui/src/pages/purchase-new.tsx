"use client";

import { TruckIcon } from "lucide-react";
import { PurchaseForm } from "../components/inventory/purchase-form";
import { Page, PageHeading, useI18n } from "@srirealtime/web";

export default function NewPurchasePage() {
  const { t } = useI18n();
  return (
    <Page className="max-w-6xl">
      <PageHeading
        icon={TruckIcon}
        title={t("billing.purchaseForm.title")}
        description={t("billing.purchaseForm.subtitle")}
        back={{ href: "purchases", label: t("billing.nav.purchases") }}
      />
      <PurchaseForm />
    </Page>
  );
}
