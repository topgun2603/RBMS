/** Feature keys the job cards UI uses (declared by @rbms/jobcards). */
export const JOBCARDS_FEATURES = {
  jobcards: "jobcards",
  tracking: "jobcards.tracking",
} as const;

/** Permissions of @rbms/jobcards. Owners and admins hold all of them. */
export const JOBCARDS_PERMISSIONS = {
  view: "jobcards.view",
  manage: "jobcards.manage",
  bill: "jobcards.bill",
} as const;

const P = JOBCARDS_PERMISSIONS;
/** Any of them can open the board and a job. */
export const JOBCARDS_VIEW = [P.view, P.manage, P.bill];
