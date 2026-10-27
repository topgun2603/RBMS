"use client";

import * as React from "react";
import { Page, PageHeading, useI18n, useQueryParams } from "@srirealtime/web";
import { FileBadgeIcon } from "lucide-react";
import { SalesDocForm } from "../components/sales-docs/sd-form";

export default function NewProformaPage() {
  const { t } = useI18n();
  return (
    <Page>
      <PageHeading icon={FileBadgeIcon} title={t("billing.sd.form.newTitle.proforma")} back={{ href: "proformas", label: t("billing.sd.list.title.proforma") }} />
      <React.Suspense fallback={null}>
        <Form />
      </React.Suspense>
    </Page>
  );
}

function Form() {
  const params = useQueryParams();
  return <SalesDocForm kind="proforma" initialCustomerId={params.get("customer") ?? undefined} />;
}
