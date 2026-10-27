/**
 * Recurring invoices: the schedule maths (docs/recurring-export-gstin.md). The pure date maths lives in
 * `@srirealtime/core` (schedule.ts), shared with recurring expenses; re-exported here under the names this package used.
 */
export {
  addDaysIso as addDays,
  CATCH_UP_LIMIT,
  MAX_RUN_ATTEMPTS,
  monthStep,
  nextAfter,
  nextOnOrAfter,
  occurrence,
  planDue,
  previewDates,
  scheduleProblem,
  type DuePlan,
  type Schedule,
} from "@srirealtime/core";
