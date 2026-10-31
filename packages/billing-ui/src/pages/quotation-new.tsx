"use client";

import * as React from "react";
import { Page, PageHeading, useI18n, useQueryParams } from "@rbms/web";
import { FileSignatureIcon } from "lucide-react";
import { QuotationForm } from "../components/quotations/quotation-form";

export default function NewQuotationPage() {
  const { t } = useI18n();
  return (
    <Page>
      <PageHeading icon={FileSignatureIcon} title={t("billing.q.form.newTitle")} back={{ href: "quotations", label: t("billing.nav.quotations") }} />
      <React.Suspense fallback={null}>
        <NewQuotationForm />
      </React.Suspense>
    </Page>
  );
}

function NewQuotationForm() {
  const params = useQueryParams();
  return <QuotationForm initialCustomerId={params.get("customer") ?? undefined} />;
}
