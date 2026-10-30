"use client";

import Link from "next/link";
import { CompassIcon } from "lucide-react";
import { Button, EmptyState } from "@rbms/ui";
import { useI18n } from "@/lib/i18n";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <EmptyState
        className="w-full max-w-md"
        icon={CompassIcon}
        title={t("admin.notFound.title")}
        description={t("admin.notFound.description")}
        action={
          <Button asChild>
            <Link href="/">{t("admin.notFound.home")}</Link>
          </Button>
        }
      />
    </div>
  );
}
