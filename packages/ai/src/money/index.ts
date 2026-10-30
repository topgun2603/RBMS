import { defineModule, type SrModule } from "@rbms/core";
import type { Db } from "@rbms/db";
import type { AiRunner } from "../assist/hsn";
import { PackStore } from "./packs";
import { moneyRoutes, type MoneyPorts } from "./routes";
import { aiMoneyPacks } from "./schema";

export * from "./dates";
export * from "./risk";
export * from "./cashflow";
export * from "./loanpack";
export * from "./explain2b";
export * from "./packs";
export * from "./schema";
export { MONEY_REGISTRY } from "./registry";
export { moneyRoutes, MONEY_PERMISSIONS, type MoneyPorts, type MoneyRouteDeps, type RiskSubject, type CashflowRaw, type Reco2bData, type CashflowSettings } from "./routes";

export interface AiMoneyDeps {
  db: Db;
  ai: AiRunner;
  ports: MoneyPorts;
  now?: () => Date;
}

/** Phase 5 part B (docs/ai.md "Phase 5 part B: money"): credit risk, cash-flow forecast, loan readiness pack, GSTR-2B explanations. Mount `module` (routes at /v1/ai/money). */
export function createAiMoney(deps: AiMoneyDeps) {
  const packs = new PackStore(deps.db, deps.now);
  const module: SrModule = defineModule({
    id: "ai/money",
    tables: { aiMoneyPacks },
    routes: moneyRoutes({ ai: deps.ai, packs, ports: deps.ports }),
  });
  return { module, packs };
}
