"use client";

import { TrendingUpIcon } from "lucide-react";
import { Page, PageHeading, PricingHintsPanel, useI18n } from "@rbms/web";

/** Items > Pricing hints (AI Phase 4 part B): computed in code from the shop's own sales; the AI only words them. Never changes a price. */
export default function PricingHintsPage() {
  const { t } = useI18n();
  return (
    <Page>
      <PageHeading icon={TrendingUpIcon} title={t("billing.pricing.title")} description={t("billing.pricing.subtitle")} />
      <PricingHintsPanel />
    </Page>
  );
}
