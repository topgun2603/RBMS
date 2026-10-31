import { defineModule } from "@rbms/core";
import { JOBCARDS_FEATURES, JOBCARDS_PERMISSIONS } from "./ports";
import { jobcardsRoutes } from "./routes";
import { jobcardEvents, jobcardLines, jobcards } from "./schema";
import { JobcardsService, type JobcardsDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./ports";
export * from "./templates";
export {
  JobcardsService,
  JOB_SORT,
  createInput,
  updateInput,
  lineInput,
  linePatch,
  moveInput,
  noteInput,
  cancelInput,
  billInput,
  jobListQuery,
  approvalInput,
  publicApprovalInput,
  findJobInput,
} from "./service";
export type {
  ApprovalInput,
  FindJobInput,
  PublicApprovalInput,
  BillInput,
  CreateInput,
  JobcardsDeps,
  JobcardSummary,
  JobLine,
  JobListQuery,
  JobsSummary,
  JobTrack,
  JobView,
  LineInput,
  MoveInput,
  UpdateInput,
} from "./service";
export { jobcardsRoutes, PublicLimiter, type JobcardsRouteOptions } from "./routes";

/**
 * Job cards for service work: mobile / electronics repair, tailoring, optical lens orders (and a general card).
 * Intake with template details, an estimate of parts and labour, a status flow from received to delivered with a
 * timeline, a GST bill through the kit's `BillingPort`, and a public tracking link for the customer.
 */
export function createJobcards(deps: JobcardsDeps) {
  const service = new JobcardsService(deps);
  const module = defineModule({
    id: "jobcards",
    tables: { jobcards, jobcardLines, jobcardEvents },
    routes: jobcardsRoutes(service),
    features: JOBCARDS_FEATURES,
    permissions: JOBCARDS_PERMISSIONS,
  });
  return { service, module };
}
