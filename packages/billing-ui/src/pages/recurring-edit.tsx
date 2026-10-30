"use client";

import { ModuleLink, Page, PageHeading, QueryError, useI18n, useRouteParams } from "@rbms/web";
import { LockIcon, PencilLineIcon } from "lucide-react";
import { Button, EmptyState, Skeleton } from "@rbms/ui";
import { RecurringForm } from "../components/recurring/rc-form";
import { useRecurring } from "../lib/queries-recurring";

/** Edits a recurring bill until it has ended (bills already made are not changed). */
export default function EditRecurringPage() {
  const { t } = useI18n();
  const { id } = useRouteParams<{ id: string }>();
  const q = useRecurring(id);
  return (
    <Page>
      <PageHeading icon={PencilLineIcon} title={t("billing.recurring.form.editTitle")} back={{ href: `recurring/${id}`, label: t("billing.recurring.back") }} />
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : q.data.status === "ended" ? (
        <EmptyState
          icon={LockIcon}
          title={t("billing.recurring.form.notEditableTitle")}
          description={t("billing.recurring.form.notEditable")}
          action={
            <Button asChild>
              <ModuleLink to={`recurring/${id}`}>{t("billing.recurring.back")}</ModuleLink>
            </Button>
          }
        />
      ) : (
        <RecurringForm key={q.data.id} profile={q.data} />
      )}
    </Page>
  );
}
