"use client";

import { PackageXIcon } from "lucide-react";
import { Button, Card, EmptyState, Skeleton } from "@rbms/ui";
import { ApiError, ModuleLink, Page, QueryError, useI18n, useRouteParams } from "@rbms/web";
import { ProductEditor } from "../components/product-editor/editor";
import { useProduct } from "../lib/queries";

export default function ProductEditPage() {
  const { t } = useI18n();
  const { id } = useRouteParams<{ id: string }>();
  const q = useProduct(id);

  if (q.isError) {
    const notFound = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400);
    return (
      <Page width="narrow">
        {notFound ? (
          <EmptyState
            icon={PackageXIcon}
            title={t("commerce.editor.notFound")}
            description={t("commerce.editor.notFoundBody")}
            action={
              <Button asChild variant="outline" size="lg">
                <ModuleLink to="products">{t("commerce.editor.backToProducts")}</ModuleLink>
              </Button>
            }
          />
        ) : (
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        )}
      </Page>
    );
  }
  if (!q.data) return <EditorSkeleton />;
  // Keyed by id: opening another product starts a fresh form.
  return <ProductEditor key={q.data.id} product={q.data} />;
}

function EditorSkeleton() {
  return (
    <Page>
      <div className="mb-5 space-y-3">
        <Skeleton className="h-3 w-20" />
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
      </div>
      <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="grid gap-section">
          {[5, 3, 4].map((rows, i) => (
            <Card key={i} className="p-card">
              <div className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-xl" />
                <Skeleton className="h-5 w-32" />
              </div>
              {Array.from({ length: rows }, (_, j) => (
                <Skeleton key={j} className="h-11 w-full" />
              ))}
            </Card>
          ))}
        </div>
        <Card className="p-card hidden h-64 lg:flex">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-full rounded-full" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </Card>
      </div>
    </Page>
  );
}
