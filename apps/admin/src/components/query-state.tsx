"use client";

import { AlertTriangleIcon, LockIcon, RefreshCwIcon } from "lucide-react";
import { Button, EmptyState } from "@rbms/ui";
import { ApiError } from "@/lib/api";
import { describeError, useI18n } from "@/lib/i18n";

/** Error panel for a failed query, with retry. 403s get a friendlier "no access" message. */
export function QueryError({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const { t } = useI18n();
  if (error instanceof ApiError && error.status === 403) {
    return <EmptyState compact={compact} icon={LockIcon} title={t("admin.errors.forbiddenTitle")} description={t("admin.errors.forbidden")} />;
  }
  return (
    <EmptyState
      compact={compact}
      icon={AlertTriangleIcon}
      title={t("admin.errors.loadFailed")}
      description={describeError(error, t)}
      action={
        onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCwIcon /> {t("admin.common.retry")}
          </Button>
        )
      }
    />
  );
}
