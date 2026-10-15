import { defineModule } from "@srirealtime/core";
import { BRANCHES_FEATURES, BRANCHES_MODULE, BRANCHES_PERMISSIONS } from "./features";
import { branchContextHook, type BranchHookOptions } from "./hook";
import { branchesRoutes } from "./routes";
import { branches, branchUsers } from "./schema";
import { BranchesService, type BranchesDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./ports";
export * from "./service";
export * from "./features";
export * from "./hook";
export { branchesRoutes } from "./routes";

/**
 * Multi-branch shops at `/v1/branches` (docs/batch3.md §B3): branches with their own GSTIN/state, address, bill
 * prefix and stock location, staff assignments, and `ctx.branch` per request. Mount `contextHook` after the tenancy
 * and auth hooks: `contextHooks: [tenancy.contextHook, auth.contextHook, branches.contextHook]`.
 */
export function createBranches(deps: BranchesDeps & { hook?: BranchHookOptions }) {
  const service = new BranchesService(deps);
  const module = defineModule({
    id: BRANCHES_MODULE,
    tables: { branches, branchUsers },
    routes: branchesRoutes(service),
    features: BRANCHES_FEATURES,
    permissions: BRANCHES_PERMISSIONS,
  });
  const contextHook = branchContextHook(service, { log: deps.log, ...deps.hook });
  return { service, module, contextHook };
}
