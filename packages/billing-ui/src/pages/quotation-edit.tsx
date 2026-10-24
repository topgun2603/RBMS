"use client";

import { ModuleLink, Page, PageHeading, QueryError, useI18n, useRouteParams } from "@srirealtime/web";
import { LockIcon, PencilLineIcon } from "lucide-react";
import { Button, EmptyState, Skeleton } from "@srirealtime/ui";
import { QuotationForm } from "../components/quotations/quotation-form";
import { useQuotation } from "../lib/queries-quotations";

/** Edits a draft in place; for a quotation that already went out it saves a new revision (same number, rev + 1). */
export default function EditQuotationPage() {
  const { t } = useI18n();
  const { id } = useRouteParams<{ id: string }>();
  const q = useQuotation(id);
  const mode = q.data?.canEdit ? "edit" : "revise";

  return (
    <Page>
      <PageHeading
        icon={PencilLineIcon}
        title={q.data && !q.data.canEdit ? t("billing.q.form.reviseHeading") : t("billing.q.form.editTitle")}
        back={{ href: `quotations/${id}`, label: t("billing.q.back") }}
      />
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid gap-section">
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
          <Skeleton className="hidden h-80 rounded-2xl lg:block" />
        </div>
      ) : !q.data.canEdit && !q.data.canRevise ? (
        <EmptyState
          icon={LockIcon}
          title={t("billing.q.form.notEditableTitle")}
          description={t("billing.q.form.notEditable")}
          action={
            <Button asChild>
              <ModuleLink to={`quotations/${id}`}>{t("billing.q.back")}</ModuleLink>
            </Button>
          }
        />
      ) : (
        <QuotationForm key={q.data.id} quotation={q.data} mode={mode} />
      )}
    </Page>
  );
}
