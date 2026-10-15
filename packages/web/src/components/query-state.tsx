"use client";

import { AlertTriangleIcon, LockIcon, RefreshCwIcon } from "lucide-react";
import { Button, EmptyState } from "@srirealtime/ui";
import { ApiError } from "../lib/api";
import { describeError, useI18n } from "../lib/i18n";

/** Error panel for a failed query, with retry. 403s get a friendlier "no access" message. */
export function QueryError({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const { t } = useI18n();
  if (error instanceof ApiError && error.status === 403) {
    return <EmptyState compact={compact} icon={LockIcon} title={t("web.errors.forbiddenTitle")} description={t("web.errors.forbidden")} />;
  }
  return (
    <EmptyState
      compact={compact}
      icon={AlertTriangleIcon}
      title={t("web.errors.loadFailed")}
      description={describeError(error, t)}
      action={
        onRetry && (
          <Button variant="outline" onClick={onRetry}>
            <RefreshCwIcon /> {t("web.common.retry")}
          </Button>
        )
      }
    />
  );
}
