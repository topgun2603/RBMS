"use client";

import { LayersIcon } from "lucide-react";
import { Button, Card, EmptyState, Skeleton } from "@rbms/ui";
import { ApiError, ModuleLink, Page, QueryError, useI18n, useRouteParams } from "@rbms/web";
import { CollectionEditor } from "../components/collection-editor";
import { useCollection } from "../lib/queries";

export default function CollectionEditPage() {
  const { t } = useI18n();
  const { id } = useRouteParams<{ id: string }>();
  const q = useCollection(id);

  if (q.isError) {
    const missing = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400);
    return (
      <Page width="narrow">
        {missing ? (
          <EmptyState
            icon={LayersIcon}
            title={t("commerce.collections.notFound")}
            action={
              <Button asChild variant="outline" size="lg">
                <ModuleLink to="collections">{t("commerce.collections.back")}</ModuleLink>
              </Button>
            }
          />
        ) : (
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        )}
      </Page>
    );
  }
  if (!q.data) {
    return (
      <Page>
        <Skeleton className="mb-5 h-10 w-64" />
        <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Card className="p-card">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </Card>
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
      </Page>
    );
  }
  return <CollectionEditor key={q.data.id} collection={q.data} />;
}
