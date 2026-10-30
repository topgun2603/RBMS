import { AppError, FULL_ACCESS_ROLES, permissionsAllow, type AuditPort } from "@rbms/core";
import type { TillApprovalPort } from "@rbms/invoices";
import { DISCOUNT_APPROVE_PERMISSION } from "@rbms/staff";
import { APPROVAL_MAX_FAILURES, APPROVAL_WINDOW_MS } from "./discount-guard";

export interface TillApprovalDeps {
  /** The shop's cash-difference limit in paise (settings `till.varianceLimit`). */
  limit(tenantId: string): Promise<number>;
  /** The shop member who owns a staff PIN (POS PIN), or null. */
  memberForPin(tenantId: string, pin: string): Promise<{ userId: string; name: string | null; roles: string[]; permissions: string[] } | null>;
  audit?: AuditPort;
  now?: () => number;
}

/**
 * The manager approval for a till difference beyond the limit (Z report close, cashier handover): the same POS PIN
 * and permission (`invoices.discount-approve`) that approve discounts, the same wrong-PIN lockout (five in five minutes
 * per cashier). Approvals and wrong PINs are audited.
 */
export function tillApprovals(deps: TillApprovalDeps): TillApprovalPort {
  const now = deps.now ?? Date.now;
  const failures = new Map<string, number[]>();
  const recent = (key: string) => {
    const from = now() - APPROVAL_WINDOW_MS;
    const list = (failures.get(key) ?? []).filter((t) => t > from);
    if (list.length) failures.set(key, list);
    else failures.delete(key);
    return list;
  };
  const record = (tenantId: string, userId: string | null, action: string, summary: string, extra: Record<string, unknown> = {}) =>
    deps.audit?.record({ tenantId, actorUserId: userId, action, entityType: "till_session", entityId: null, summary, after: extra }).catch(() => undefined);

  return {
    varianceLimit: (tenantId) => deps.limit(tenantId),
    async approve(tenantId, pin, requesterId) {
      const key = `${tenantId}:${requesterId ?? "-"}`;
      const failed = recent(key);
      if (failed.length >= APPROVAL_MAX_FAILURES) throw new AppError(429, "rate_limited", "Too many wrong manager PINs. Please wait a few minutes and try again");
      const approver = await deps.memberForPin(tenantId, pin);
      const allowed =
        !!approver &&
        approver.userId !== requesterId &&
        (approver.roles.some((r) => FULL_ACCESS_ROLES.includes(r)) || permissionsAllow(approver.permissions, DISCOUNT_APPROVE_PERMISSION));
      if (!approver || !allowed) {
        failed.push(now());
        failures.set(key, failed);
        await record(tenantId, requesterId, "invoices.till.approval_failed", approver ? "Till approval refused: that member cannot approve" : "Till approval refused: unknown manager PIN");
        return null;
      }
      failures.delete(key);
      await record(tenantId, requesterId, "invoices.till.approved", `Till difference approved by ${approver.name ?? "a manager"}`, { approvedBy: approver.userId });
      return { userId: approver.userId, name: approver.name };
    },
  };
}
