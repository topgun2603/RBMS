"use client";

import * as React from "react";
import { Page, PageHeading, useI18n, useQueryParams } from "@srirealtime/web";
import { FilePlus2Icon } from "lucide-react";
import { InvoiceForm } from "../components/invoice-form";

export default function NewInvoicePage() {
  const { t } = useI18n();
  return (
    <Page>
      <PageHeading icon={FilePlus2Icon} title={t("billing.form.newTitle")} back={{ href: "invoices", label: t("billing.nav.invoices") }} />
      <React.Suspense fallback={null}>
        <NewInvoiceForm />
      </React.Suspense>
    </Page>
  );
}

function NewInvoiceForm() {
  const params = useQueryParams();
  return <InvoiceForm initialCustomerId={params.get("customer") ?? undefined} />;
}
