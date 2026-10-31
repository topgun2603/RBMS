"use client";

import { SparklesIcon } from "lucide-react";
import { Button } from "@rbms/ui";
import { ModuleLink, useSettingsHref } from "../../app/navigation";
import { useI18n } from "../../lib/i18n";
import { useAiAssistAllowed } from "../ai-assist/use-assist";
import { usePermission } from "../../app/session";

/** "Ask Studio": a link from the screens Studio can change (Appearance, Store settings...) to the Studio assistant page. */
export function StudioLink() {
  const { t } = useI18n();
  const href = useSettingsHref();
  const allowed = useAiAssistAllowed();
  const canManage = usePermission("ai.manage");
  if (!allowed || !canManage) return null;
  return (
    <Button asChild variant="outline" size="sm">
      <ModuleLink to={href("studio")}>
        <SparklesIcon /> {t("web.aiStudio.openStudio")}
      </ModuleLink>
    </Button>
  );
}
