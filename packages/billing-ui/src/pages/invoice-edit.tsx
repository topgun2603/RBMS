"use client";

import { ModuleLink, Page, PageHeading, QueryError, useI18n, useRouteParams } from "@srirealtime/web";
import { LockIcon, PencilLineIcon } from "lucide-react";
import { Button, EmptyState, Skeleton } from "@srirealtime/ui";
import { InvoiceForm } from "../components/invoice-form";
import { useInvoice } from "../lib/queries";

export default function EditInvoicePage() {
  const { t } = useI18n();
  const { id } = useRouteParams<{ id: string }>();
  const inv = useInvoice(id);

  return (
    <Page>
      <PageHeading icon={PencilLineIcon} title={t("billing.form.editTitle")} back={{ href: `invoices/${id}`, label: t("billing.detail.back") }} />
      {inv.isError ? (
        <QueryError error={inv.error} onRetry={() => void inv.refetch()} />
      ) : inv.isPending ? (
        <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid gap-section">
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
          <Skeleton className="hidden h-80 rounded-2xl lg:block" />
        </div>
      ) : inv.data.status !== "draft" ? (
        <EmptyState
          icon={LockIcon}
          title={t("billing.form.notEditableTitle")}
          description={t("billing.form.notEditable")}
          action={
            <Button asChild>
              <ModuleLink to={`invoices/${id}`}>{t("billing.detail.back")}</ModuleLink>
            </Button>
          }
        />
      ) : (
        <InvoiceForm key={inv.data.id} invoice={inv.data} />
      )}
    </Page>
  );
}
