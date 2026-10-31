import { aiOnboarding, type AiService, type AiSettings, type studio } from "@rbms/ai";
import type { SrModule } from "@rbms/core";
import type { OnboardingStep } from "@rbms/onboarding";

export interface AiOnboardingKitDeps {
  ai: AiService;
  /** The Studio engine and its ports (kit-ai-studio.ts): the setup plan is a Studio change. */
  studio: { service: studio.StudioService; ports: studio.StudioPorts };
  /** The settings namespace "ai" (progress lives under `onboarding`). */
  aiSettings: { get(scope: { tenantId: string }): Promise<unknown>; setTenant(tenantId: string, patch: never): Promise<unknown> };
  tenancy: { getById(id: string): Promise<{ name: string; appId: string | null } | null> };
  /** Does the shop have products yet? A shop that does is not new, so the checklist step counts as done. */
  hasProducts: (tenantId: string) => Promise<boolean>;
  registerStep: (step: OnboardingStep) => void;
  now?: () => Date;
}

/**
 * Phase 7 part A wiring (docs/ai.md "Phase 7 part A: shop setup assistant"): five questions for a new owner, read by the
 * rules and one light-tier call, planned as a Studio change (look, home page, product groups, trade) that the owner
 * previews, applies and undoes. No table of its own: progress is the `ai.onboarding` setting.
 */
export function createAiOnboardingKit(d: AiOnboardingKitDeps): { module: SrModule; setup: aiOnboarding.SetupAssistant } {
  const readAi = async (tenantId: string) => (await d.aiSettings.get({ tenantId })) as AiSettings;
  const setup = new aiOnboarding.SetupAssistant({
    ai: d.ai,
    studio: d.studio.service,
    ports: d.studio.ports,
    progress: {
      get: async (tenantId) => ((await readAi(tenantId)).onboarding as aiOnboarding.SetupProgress | undefined) ?? null,
      set: async (tenantId, p) => {
        await d.aiSettings.setTenant(tenantId, { onboarding: p } as never);
      },
    },
    shop: async (tenantId) => {
      const t = await d.tenancy.getById(tenantId);
      return { name: t?.name ?? "", appId: t?.appId ?? null };
    },
    now: d.now,
  });

  // Why AI would not read the answers right now (the setup still works with the rules).
  const aiReady = async (tenantId: string) => {
    const s = await d.ai.status(tenantId);
    const helper = s.features.find((f) => f.key === aiOnboarding.SETUP_FEATURE);
    const reason = !s.platformEnabled ? "ai_disabled" : !s.available ? "ai_unavailable" : !s.shopEnabled ? "ai_off" : helper && !helper.allowed ? "ai_feature_off" : s.credits.remaining !== null && s.credits.remaining <= 0 ? "ai_credits_exhausted" : s.mock ? "mock" : null;
    return { ready: reason === null || reason === "mock", reason };
  };

  d.registerStep({
    key: "shop-setup-assistant",
    module: "ai",
    feature: "ai",
    label: "Set up your shop in five questions",
    description: "Answer five questions; your product groups, store look and home page are set up for you to check.",
    href: "settings/shop-setup",
    order: 5,
    check: async (tenantId) => {
      const p = (await readAi(tenantId)).onboarding;
      if (p && (p.status === "applied" || p.status === "dismissed")) return true;
      return d.hasProducts(tenantId);
    },
  });

  return { module: aiOnboarding.setupModule({ setup, aiReady }), setup };
}
