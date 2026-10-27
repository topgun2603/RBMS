"use client";

import * as React from "react";
import { Page, PageHeading, useI18n, useQueryParams } from "@srirealtime/web";
import { RepeatIcon } from "lucide-react";
import { RecurringForm } from "../components/recurring/rc-form";

export default function NewRecurringPage() {
  const { t } = useI18n();
  return (
    <Page>
      <PageHeading icon={RepeatIcon} title={t("billing.recurring.form.newTitle")} back={{ href: "recurring", label: t("billing.recurring.list.title") }} />
      <React.Suspense fallback={null}>
        <Form />
      </React.Suspense>
    </Page>
  );
}

function Form() {
  const params = useQueryParams();
  return <RecurringForm initialCustomerId={params.get("customer") ?? undefined} />;
}
