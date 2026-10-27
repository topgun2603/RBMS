"use client";

import { ModuleLink, Page, PageHeading, QueryError, useI18n, useRouteParams } from "@srirealtime/web";
import { LockIcon, PencilLineIcon } from "lucide-react";
import { Button, EmptyState, Skeleton } from "@srirealtime/ui";
import { SalesDocForm } from "../components/sales-docs/sd-form";
import { useSaleOrder } from "../lib/queries-sales-docs";

/** Edits a sale order: everything while nothing left; dates, notes, terms and the stock hold after that. */
export default function EditSaleOrderPage() {
  const { t } = useI18n();
  const { id } = useRouteParams<{ id: string }>();
  const q = useSaleOrder(id);
  return (
    <Page>
      <PageHeading icon={PencilLineIcon} title={t("billing.sd.form.editTitle.sale_order")} back={{ href: `sale-orders/${id}`, label: t("billing.sd.back") }} />
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : !q.data.canEdit ? (
        <EmptyState
          icon={LockIcon}
          title={t("billing.sd.form.notEditableTitle")}
          description={t("billing.sd.form.notEditable")}
          action={
            <Button asChild>
              <ModuleLink to={`sale-orders/${id}`}>{t("billing.sd.back")}</ModuleLink>
            </Button>
          }
        />
      ) : (
        <SalesDocForm key={q.data.id} kind="sale_order" order={q.data} />
      )}
    </Page>
  );
}
