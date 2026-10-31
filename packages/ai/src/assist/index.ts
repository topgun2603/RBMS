import { defineModule, type SrModule } from "@rbms/core";
import type { Db } from "@rbms/db";
import type { AiService } from "../service";
import { aiProductTranslations } from "../schema";
import { loadGuideIndex, type GuideIndex } from "./help";
import { assistRoutes, type AssistPorts, RateLimiter } from "./routes";
import { TranslationService, type TranslateJobPayload } from "./translations";

export * from "./hsn-ref";
export * from "./safety";
export * from "./hsn";
export * from "./describe";
export * from "./mapping";
export * from "./help";
export * from "./translations";
export { assistRoutes, RateLimiter, ASSIST_PERMISSIONS, type AssistPorts } from "./routes";

export interface AiAssistDeps {
  db: Db;
  ai: AiService;
  ports: AssistPorts;
  /** Queue a translation batch (the API kit defines the job); omit to draft inline. */
  enqueueTranslate?: (payload: TranslateJobPayload) => Promise<void>;
  guides?: GuideIndex;
  log?: { warn(o: object, m?: string): void };
}

/**
 * Phase 1 text helpers (docs/ai.md "Phase 1"): HSN + GST suggestions, product descriptions and bulk Tamil translation,
 * smart import mapping, and the help assistant. Mount `module` (routes at /v1/ai/assist); `translations.process` is the
 * body of the `ai.translate-batch` job.
 */
export function createAiAssist(deps: AiAssistDeps) {
  const guides = deps.guides ?? loadGuideIndex();
  if (guides.size === 0) deps.log?.warn({}, "ai: no guides found for the help assistant (docs/guides or AI_GUIDES_DIR); it will answer \"I don't know\"");
  const translations = new TranslationService({ db: deps.db, ai: deps.ai, products: { get: deps.ports.products }, enqueue: deps.enqueueTranslate, log: deps.log });
  const module: SrModule = defineModule({
    id: "ai/assist",
    tables: { aiProductTranslations },
    routes: assistRoutes({ ai: deps.ai, translations, ports: deps.ports, guides }),
  });
  return { module, translations, guides };
}
