"use client";

import { SparklesIcon } from "lucide-react";
import { Page, PageHeading, SettingsNav, StudioAssistant, useI18n } from "@rbms/web";

/**
 * Settings > Studio assistant: ask in Tamil, Tanglish or English for a change to how the shop looks or works; read the
 * checked plan and preview, apply, and undo from the history (docs/ai.md, Phase 4 part A). Needs `ai.manage`; every step
 * also needs its own permission, which the server checks again when applying.
 */
export default function StudioPage() {
  const { t } = useI18n();
  return (
    <Page width="narrow">
      <SettingsNav />
      <PageHeading icon={SparklesIcon} title={t("workspace.nav.studio")} description={t("workspace.studio.subtitle")} />
      <StudioAssistant />
    </Page>
  );
}
