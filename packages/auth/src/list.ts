import { defineSort, listFilter, listQuerySchema, searchAny } from "@srirealtime/core";
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { detectTarget } from "./helpers";
import { users } from "./schema";

/*
 * Super-admin user list (GET /v1/auth/users), docs/CONVENTIONS.md → "Lists and tables".
 *   ?q=meena&status=active&role=superadmin&sort=-lastActive&limit=25&offset=0
 *   → { items, total, limit, offset, facets: { status, role } }
 */

export const USER_STATUSES = ["active", "disabled", "deleted"] as const;
/** Platform-role filter: `superadmin` holders, or users with no platform role at all (`none`). */
export const USER_ROLE_FILTERS = ["superadmin", "none"] as const;

export const userListQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: 200, maxSearch: 254 }).extend({
  status: listFilter.oneOf(USER_STATUSES),
  role: listFilter.oneOf(USER_ROLE_FILTERS),
});
export type UserListQuery = z.input<typeof userListQuerySchema>;
export type UserListParams = z.output<typeof userListQuerySchema>;

export const USER_SORT = defineSort(
  {
    name: sql`lower(${users.name})`,
    email: users.email,
    phone: users.phone,
    created: users.createdAt,
    lastActive: users.lastLoginAt,
  },
  { default: "-created", tieBreaker: users.id },
);

const hasRole = (role: string) => sql`${role} = any(${users.platformRoles})`;
const noRoles = sql`cardinality(${users.platformRoles}) = 0`;

/** The `role` filter value's condition (also the facet's count expression). */
export const roleCondition = (role: (typeof USER_ROLE_FILTERS)[number]) => (role === "none" ? noRoles : hasRole(role));

/** WHERE of the list; `omit` leaves one filter out (its facet counts). */
export function userListConditions(p: UserListParams, omit?: "status" | "role"): SQL | undefined {
  const phone = p.q ? detectTarget(p.q) : null;
  const search = searchAny(p.q, [users.email, users.name, users.phone]);
  return and(
    omit !== "status" && p.status?.length ? inArray(users.status, p.status) : undefined,
    omit !== "role" && p.role?.length ? or(...p.role.map(roleCondition)) : undefined,
    // "98765 43210" also finds "+919876543210".
    search && phone?.kind === "phone" ? or(search, eq(users.phone, phone.value)) : search,
  );
}
