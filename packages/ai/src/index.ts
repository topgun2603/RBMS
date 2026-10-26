import { defineModule, type SrModule } from "@srirealtime/core";
import { AI_FEATURES, AI_PERMISSIONS } from "./features";
import { aiAdminRoutes, aiRoutes } from "./routes";
import { aiRuns } from "./schema";
import { AiService, type AiDeps } from "./service";

export * from "./types";
export * from "./features";
export * from "./pricing";
export * from "./masking";
export * from "./schema";
export * from "./config";
export * from "./assist";
export * from "./insights";
export * from "./ask";
export * from "./vision/shared";
export * from "./vision/bill";
export * from "./vision/receipt";
export * as tradesC from "./trades/service";
export * as studio from "./studio";
export * as tradesB from "./trades/b-index";
export * as tradesA from "./trades/a-index";
export * as aiStore from "./store";
export * as aiMoney from "./money";
export * as imaging from "./imaging";
export * as aiCounter from "./counter";
export { AiService, monthKey, runView, toAppError, DEBUG_KEEP_DAYS } from "./service";
export type { AiDeps, AiLogger, CreditBalance, CreditsPort } from "./service";
export { ClaudeProvider, FALLBACK_BETA } from "./claude-provider";
export type { ClaudeClientLike, ClaudeProviderOptions } from "./claude-provider";
export { MockProvider, MOCK_MARKERS, sampleFor } from "./mock-provider";
export type { MockResponder } from "./mock-provider";
export { aiRoutes, aiAdminRoutes } from "./routes";

/**
 * AI foundation (docs/ai.md): the shared plumbing every AI helper uses. `ai.service.run(...)` checks the switches and
 * credits, masks the input, calls the model (Claude, or the mock outside production without a key), validates structured
 * output, charges credits and records the run. Ships no end-user AI feature itself; features register in features.ts.
 */
export function createAi(deps: AiDeps) {
  const service = new AiService(deps);
  const module = defineModule({
    id: "ai",
    tables: { aiRuns },
    routes: aiRoutes(service),
    features: AI_FEATURES,
    permissions: AI_PERMISSIONS,
  });
  /** Platform routes under /v1/admin/ai. */
  const adminModule: SrModule = { id: "admin/ai", routes: aiAdminRoutes(service) };
  return { service, module, adminModule };
}
