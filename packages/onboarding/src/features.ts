import type { FeatureDef } from "@srirealtime/core";

export const ONBOARDING_FEATURE = "onboarding";

export const ONBOARDING_FEATURES: FeatureDef[] = [
  {
    key: ONBOARDING_FEATURE,
    module: "onboarding",
    label: "Getting started checklist",
    description: "A setup checklist for new shops: business profile, logo, first product, first bill, payments and more.",
  },
];
