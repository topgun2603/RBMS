"use client";

import * as React from "react";
import { Page, PageHeading, useI18n, useQueryParams } from "@srirealtime/web";
import { TruckIcon } from "lucide-react";
import { SalesDocForm } from "../components/sales-docs/sd-form";

export default function NewChallanPage() {
  const { t } = useI18n();
  return (
    <Page>
      <PageHeading icon={TruckIcon} title={t("billing.sd.form.newTitle.challan")} back={{ href: "challans", label: t("billing.sd.list.title.challan") }} />
      <React.Suspense fallback={null}>
        <Form />
      </React.Suspense>
    </Page>
  );
}

function Form() {
  const params = useQueryParams();
  return <SalesDocForm kind="challan" initialCustomerId={params.get("customer") ?? undefined} />;
}
