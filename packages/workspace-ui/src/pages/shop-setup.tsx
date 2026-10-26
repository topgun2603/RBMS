"use client";

import { WandSparklesIcon } from "lucide-react";
import { Page, PageHeading, SettingsNav, SetupAssistant, useI18n } from "@srirealtime/web";
import { useStepHref } from "../components/onboarding/steps";

/**
 * Settings > Set up your shop: the shop setup assistant for a new owner (docs/ai.md, Phase 7 part A). Five questions,
 * then the type of business, product groups, store look and home page as a checked plan to apply and undo. Owner only;
 * the server checks the role again.
 */
export default function ShopSetupPage() {
  const { t } = useI18n();
  const stepHref = useStepHref();
  return (
    <Page width="narrow">
      <SettingsNav />
      <PageHeading icon={WandSparklesIcon} title={t("workspace.nav.shopSetup")} description={t("workspace.shopSetup.subtitle")} />
      <SetupAssistant addProductHref={stepHref("catalogue/products/new")} />
    </Page>
  );
}
