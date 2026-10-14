"use client";

import { LockIcon } from "lucide-react";
import { EmptyState } from "@srirealtime/ui";
import { Page } from "@/components/page";
import { isSuperAdmin, useMe } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

/** Renders children only for platform super-admins (the API enforces this too). */
export function SuperAdminOnly({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const me = useMe();
  if (!me.data) return null;
  if (!isSuperAdmin(me.data.user)) {
    return (
      <Page>
        <EmptyState icon={LockIcon} title={t("admin.errors.forbiddenTitle")} description={t("admin.platform.onlySuperadmin")} />
      </Page>
    );
  }
  return <>{children}</>;
}
