"use client";

import { ModuleLink, Page, PageHeading, QueryError, useI18n, useRouteParams } from "@rbms/web";
import { LockIcon, PencilLineIcon } from "lucide-react";
import { Button, EmptyState, Skeleton } from "@rbms/ui";
import { SalesDocForm } from "../components/sales-docs/sd-form";
import { useProforma } from "../lib/queries-sales-docs";

/** Edits a proforma until it is billed or cancelled (the number stays). */
export default function EditProformaPage() {
  const { t } = useI18n();
  const { id } = useRouteParams<{ id: string }>();
  const q = useProforma(id);
  return (
    <Page>
      <PageHeading icon={PencilLineIcon} title={t("billing.sd.form.editTitle.proforma")} back={{ href: `proformas/${id}`, label: t("billing.sd.back") }} />
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
              <ModuleLink to={`proformas/${id}`}>{t("billing.sd.back")}</ModuleLink>
            </Button>
          }
        />
      ) : (
        <SalesDocForm key={q.data.id} kind="proforma" proforma={q.data} />
      )}
    </Page>
  );
}
