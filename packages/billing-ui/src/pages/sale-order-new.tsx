"use client";

import * as React from "react";
import { Page, PageHeading, useI18n, useQueryParams } from "@srirealtime/web";
import { ClipboardListIcon } from "lucide-react";
import { SalesDocForm } from "../components/sales-docs/sd-form";

export default function NewSaleOrderPage() {
  const { t } = useI18n();
  return (
    <Page>
      <PageHeading icon={ClipboardListIcon} title={t("billing.sd.form.newTitle.sale_order")} back={{ href: "sale-orders", label: t("billing.sd.list.title.sale_order") }} />
      <React.Suspense fallback={null}>
        <Form />
      </React.Suspense>
    </Page>
  );
}

function Form() {
  const params = useQueryParams();
  return <SalesDocForm kind="sale_order" initialCustomerId={params.get("customer") ?? undefined} />;
}
