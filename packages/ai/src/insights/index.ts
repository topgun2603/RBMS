import { defineModule, type SrModule } from "@rbms/core";
import type { Db } from "@rbms/db";
import type { AiRunner } from "../assist/hsn";
import { DailySummaryService, type DailyLog, type DailyPorts } from "./daily";
import { aiDailySummaries } from "./schema";
import { insightRoutes, type InsightPorts } from "./routes";

export { allowedNumbers, checkNumbers, numbersIn, canonNumber, type NumberCheck } from "./numbers";
export { addDays as planAddDays, daysBetween as planDaysBetween, PLAN_FESTIVALS, festivalsAhead, lastYearOf, type PlanFestival, type FestivalAhead } from "./calendar";
export * from "./summary";
export * from "./daily-settings";
export * from "./daily";
export * from "./schema";
export * from "./reorder";
export * from "./campaign";
export * from "./reviews";
export { insightRoutes, INSIGHT_PERMISSIONS, type InsightPorts, type ReorderData } from "./routes";

export interface AiInsightsDeps {
  db: Db;
  ai: AiRunner;
  daily: DailyPorts;
  ports: InsightPorts;
  log?: DailyLog;
  now?: () => Date;
}

/**
 * Phase 2 part B (docs/ai.md "Phase 2 part B"): daily summary (job + dashboard card + WhatsApp), festival-aware reorder
 * suggestions, the WhatsApp campaign writer and review replies / themes. Mount `module` (routes at /v1/ai/insights) and
 * schedule `DAILY_JOB` every 15 minutes with `service.tick()` as its body.
 */
export function createAiInsights(deps: AiInsightsDeps) {
  const daily = new DailySummaryService({ db: deps.db, ai: deps.ai, ports: deps.daily, log: deps.log, now: deps.now });
  const module: SrModule = defineModule({
    id: "ai/insights",
    tables: { aiDailySummaries },
    routes: insightRoutes({ ai: deps.ai, daily, ports: deps.ports }),
  });
  return { module, daily };
}
