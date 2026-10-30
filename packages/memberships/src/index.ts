import { defineModule } from "@rbms/core";
import { MEMBERSHIPS_FEATURES, MEMBERSHIPS_PERMISSIONS } from "./ports";
import { membershipsRoutes } from "./routes";
import { membershipCheckins, membershipMembers, membershipPlans, membershipSubscriptions } from "./schema";
import { MembershipsService, type MembershipsDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./ports";
export {
  MembershipsService,
  MEMBER_SORT,
  planInput,
  planPatch,
  sellInput,
  renewInput,
  memberInput,
  memberPatch,
  freezeInput,
  cancelInput,
  checkinInput,
  memberListQuery,
} from "./service";
export type {
  CheckinInput,
  CheckinResult,
  CheckinView,
  MemberDetail,
  MemberInput,
  MemberListQuery,
  MembershipsDeps,
  MembershipsSummary,
  MemberSummary,
  PlanInput,
  RenewInput,
  SellInput,
  SubscriptionView,
  TodayCheckin,
} from "./service";
export { membershipsRoutes } from "./routes";

/**
 * Memberships and packages a shop sells to its own customers: gym memberships (monthly / quarterly / yearly), PT
 * session packs, salon packages. Plans, members with member codes, selling and renewing (billed through the kit's
 * `BillingPort`), freezes, front-desk check-ins and expiry reminders (`remindExpiring`, scheduled by the host).
 * Not the platform's own SaaS billing (that is @rbms/subscriptions).
 */
export function createMemberships(deps: MembershipsDeps) {
  const service = new MembershipsService(deps);
  const module = defineModule({
    id: "memberships",
    tables: { membershipPlans, membershipMembers, membershipSubscriptions, membershipCheckins },
    routes: membershipsRoutes(service),
    features: MEMBERSHIPS_FEATURES,
    permissions: MEMBERSHIPS_PERMISSIONS,
  });
  return { service, module };
}
