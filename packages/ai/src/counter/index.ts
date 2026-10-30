import { defineModule, type SrModule } from "@rbms/core";
import type { Db } from "@rbms/db";
import type { AiService } from "../service";
import { aiActivityReviews, aiCounterEvents, aiStaffCoaching } from "./schema";
import { counterRoutes } from "./routes";
import { CounterService, type CounterPorts } from "./service";

export * from "./phonetic";
export * from "./lexicon";
export * from "./parse";
export * from "./match";
export * from "./voice";
export * from "./stats";
export * from "./alerts";
export * from "./coaching";
export * from "./shifts";
export { COUNTER_REGISTRY, VOICE_FEATURE_KEY, ALERTS_FEATURE, COACHING_FEATURE_KEY, SHIFTS_FEATURE } from "./registry";
export { CounterService, type CounterPorts, type CounterDeps, type CounterSettings, type DrillRow } from "./service";
export { counterRoutes, isManager, COUNTER_PERMISSIONS } from "./routes";
export * from "./schema";

export interface AiCounterDeps {
  db: Db;
  ai: AiService;
  ports: CounterPorts;
  now?: () => Date;
  today?: () => string;
}

/** AI Phase 5 part A, the counter helpers (docs/ai.md): voice billing, unusual-activity alerts, staff coaching, shift planning. Routes at /v1/ai/counter. */
export function createAiCounter(d: AiCounterDeps) {
  const service = new CounterService(d);
  const module: SrModule = defineModule({
    id: "ai/counter",
    tables: { aiActivityReviews, aiCounterEvents, aiStaffCoaching },
    routes: counterRoutes({ counter: service }),
  });
  return { module, service };
}
