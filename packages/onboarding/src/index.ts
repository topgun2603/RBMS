import { defineModule } from "@rbms/core";
import { ONBOARDING_FEATURES } from "./features";
import { onboardingRoutes } from "./routes";
import { onboardingState } from "./schema";
import { OnboardingService, type OnboardingDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./features";
export { OnboardingService } from "./service";
export type { OnboardingDeps, LoggerPort } from "./service";
export { onboardingRoutes } from "./routes";

/**
 * Setup checklist. Modules (via apps/api kit) add steps with `registerStep`; each step's `check` runs in parallel with a
 * 3 s timeout, results are cached per tenant for 30 s, and steps whose feature is off are hidden.
 */
export function createOnboarding(deps: OnboardingDeps) {
  const service = new OnboardingService(deps);
  const module = defineModule({
    id: "onboarding",
    tables: { onboardingState },
    routes: onboardingRoutes(service),
    features: ONBOARDING_FEATURES,
  });
  return { service, module, registerStep: service.registerStep.bind(service) };
}
