"use client";

import * as React from "react";
import { FileTextIcon } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button, Card, EmptyState, Skeleton } from "@srirealtime/ui";
import { ApiError, ModuleLink, Page, QueryError, useI18n } from "@srirealtime/web";

/** Loading / not found / error states around a page or post editor. */
export function ContentLoader<T>({ kind, query, children }: { kind: "page" | "post"; query: UseQueryResult<T, unknown>; children: (item: T) => React.ReactNode }) {
  const { t } = useI18n();
  if (query.isError) {
    const missing = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400);
    return (
      <Page width="narrow">
        {missing ? (
          <EmptyState
            icon={FileTextIcon}
            title={t(kind === "page" ? "site.pages.notFound" : "site.posts.notFound")}
            action={
              <Button asChild variant="outline" size="lg">
                <ModuleLink to={kind === "page" ? "pages" : "blog"}>{t(kind === "page" ? "site.pages.back" : "site.posts.back")}</ModuleLink>
              </Button>
            }
          />
        ) : (
          <QueryError error={query.error} onRetry={() => void query.refetch()} />
        )}
      </Page>
    );
  }
  if (!query.data)
    return (
      <Page>
        <Skeleton className="mb-5 h-10 w-64" />
        <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card className="p-card">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </Card>
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
      </Page>
    );
  return <>{children(query.data)}</>;
}
