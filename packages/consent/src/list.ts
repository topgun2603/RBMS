import { defineSort, listFilter, listQuerySchema, searchAny } from "@rbms/core";
import { and, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { dataRequests } from "./schema";

/*
 * Super-admin privacy (DPDP) request list (GET /v1/consent/requests), docs/CONVENTIONS.md → "Lists and tables".
 *   ?status=pending,failed&type=delete&q=<user id part>&sort=scheduled&limit=25&offset=0
 *   → { items, total, limit, offset, facets: { status, type } }
 */

export const DATA_REQUEST_STATUSES = ["pending", "processing", "completed", "cancelled", "failed"] as const;
export const DATA_REQUEST_TYPES = ["export", "delete"] as const;

export const dataRequestListQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: 200 }).extend({
  status: listFilter.oneOf(DATA_REQUEST_STATUSES),
  type: listFilter.oneOf(DATA_REQUEST_TYPES),
});
export type DataRequestListQuery = z.input<typeof dataRequestListQuerySchema>;
export type DataRequestListParams = z.output<typeof dataRequestListQuerySchema>;

export const DATA_REQUEST_SORT = defineSort(
  {
    created: dataRequests.createdAt,
    scheduled: dataRequests.scheduledFor,
    status: dataRequests.status,
    type: dataRequests.type,
  },
  { default: "-created", tieBreaker: dataRequests.id },
);

/** WHERE of the list; `omit` leaves one filter out (its facet counts). `q` matches the user or request id. */
export function dataRequestListConditions(p: DataRequestListParams, omit?: "status" | "type"): SQL | undefined {
  return and(
    omit !== "status" && p.status?.length ? inArray(dataRequests.status, p.status) : undefined,
    omit !== "type" && p.type?.length ? inArray(dataRequests.type, p.type) : undefined,
    searchAny(p.q, [sql`${dataRequests.userId}::text`, sql`${dataRequests.id}::text`]),
  );
}
