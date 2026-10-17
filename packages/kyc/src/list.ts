import { defineSort, listFilter, listQuerySchema, searchAny, type ResolvedSort } from "@srirealtime/core";
import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { CHECK_STATUSES, CHECK_TYPES, kycChecks, kycSubjects, type CheckStatus, type CheckType } from "./schema";

/*
 * Super-admin review queue (GET /v1/kyc/review), docs/CONVENTIONS.md → "Lists and tables".
 *   ?status=manual_review&type=bank_account,upi&tenantId=<uuid>&q=meena&sort=-match&limit=25&offset=0
 *   → { items, total, limit, offset, facets: { status, type } }
 * No `status` = the queue (checks waiting for review); `status=all` = every check.
 */

export const REVIEW_STATUS_ALL = "all";
export const REVIEW_STATUS_FILTERS = [...CHECK_STATUSES, REVIEW_STATUS_ALL] as const;

export const reviewListQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: 200 }).extend({
  tenantId: listFilter.id(),
  status: listFilter.oneOf(REVIEW_STATUS_FILTERS),
  type: listFilter.oneOf(CHECK_TYPES),
});
export type ReviewListQuery = z.input<typeof reviewListQuerySchema>;
export type ReviewListParams = z.output<typeof reviewListQuerySchema>;

export const REVIEW_SORT = defineSort(
  { submitted: kycChecks.createdAt, match: kycChecks.nameMatchScore },
  { default: "submitted", tieBreaker: kycChecks.id },
);
export type ReviewSortKey = (typeof REVIEW_SORT.keys)[number];

/** What the store filters on (resolved from the query). `statuses` null = any status. */
export interface ReviewFilter {
  tenantId: string | null;
  statuses: CheckStatus[] | null;
  types?: CheckType[];
  q?: string;
}

export interface ReviewPageQuery extends ReviewFilter {
  sort: ResolvedSort<ReviewSortKey>;
  limit: number;
  offset: number;
}

/** No status → the queue (`manual_review`); `all` → no status filter. */
export function reviewFilter(p: ReviewListParams): ReviewFilter {
  const s = p.status ?? [];
  return {
    tenantId: p.tenantId ?? null,
    statuses: s.includes(REVIEW_STATUS_ALL) ? null : s.length ? (s as CheckStatus[]) : ["manual_review"],
    types: p.type,
    q: p.q,
  };
}

/** Text the search looks in: the provider's name, the submitted (masked) name and the subject's verified name. */
export const REVIEW_SEARCH = [kycChecks.nameOnRecord, sql`${kycChecks.inputMasked}->>'name'`, kycSubjects.verifiedName];

/** WHERE over `kyc_checks` joined to `kyc_subjects`; `omit` leaves one filter out (its facet counts). */
export function reviewConditions(f: ReviewFilter, omit?: "status" | "type"): SQL | undefined {
  return and(
    f.tenantId ? eq(kycChecks.tenantId, f.tenantId) : undefined,
    omit !== "status" && f.statuses ? inArray(kycChecks.status, f.statuses) : undefined,
    omit !== "type" && f.types?.length ? inArray(kycChecks.type, f.types) : undefined,
    searchAny(f.q, REVIEW_SEARCH),
  );
}
