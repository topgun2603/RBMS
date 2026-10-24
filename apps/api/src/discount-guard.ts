import { AppError, FULL_ACCESS_ROLES, permissionsAllow, type AuditPort } from "@srirealtime/core";
import { APPROVAL_PIN_HEADER, DISCOUNT_APPROVE_PERMISSION, evaluateDiscount, type DiscountLimit, type DiscountLine } from "@srirealtime/staff";
import type { FastifyRequest } from "fastify";

export interface DiscountGuardDeps {
  limits: { limitFor(tenantId: string, userId: string, roles: readonly string[]): Promise<DiscountLimit | null> };
  /** The shop member who owns a staff PIN (POS PIN), or null. */
  memberForPin(tenantId: string, pin: string): Promise<{ userId: string; name: string | null; roles: string[]; permissions: string[] } | null>;
  audit?: AuditPort;
  now?: () => number;
}

/** Wrong manager PINs allowed per requesting cashier per window before the approval is refused for a while. */
export const APPROVAL_MAX_FAILURES = 5;
export const APPROVAL_WINDOW_MS = 5 * 60_000;

const pct = (bp: number) => `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;
const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

/**
 * Discount limits with manager approval, enforced on the server for `POST /v1/invoices` and `PATCH /v1/invoices/:id`
 * (everything that sets bill lines: the counter, the billing app, the API). A member whose role or own row has a limit
 * (packages/staff `discount.ts`) may not discount a line above the percent cap, nor more than the amount cap on a bill.
 * Over the limit the request is refused with 403 `discount_approval_required` (the limit and what was asked in
 * `details`); the client asks a manager for their POS PIN and repeats the request with the `x-approval-pin` header.
 * A PIN of a member holding `invoices.discount-approve` (managers, owners and admins) approves it; wrong PINs are
 * counted per cashier (429 after five in five minutes). Approvals and wrong PINs are audited.
 */
export function discountLimitGuard(deps: DiscountGuardDeps) {
  const now = deps.now ?? Date.now;
  const failures = new Map<string, number[]>();
  const recent = (key: string) => {
    const from = now() - APPROVAL_WINDOW_MS;
    const list = (failures.get(key) ?? []).filter((t) => t > from);
    if (list.length) failures.set(key, list);
    else failures.delete(key);
    return list;
  };

  return async (req: FastifyRequest): Promise<void> => {
    const user = req.ctx.user;
    const tenant = req.ctx.tenant;
    if (!user || !tenant) return;
    const lines = (req.body as { lines?: unknown } | null)?.lines;
    if (!Array.isArray(lines)) return;
    const asked = evaluateDiscount(lines as DiscountLine[], null);
    if (asked.amount === 0) return;
    if (user.tenantRoles.some((r) => FULL_ACCESS_ROLES.includes(r))) return;
    const limit = await deps.limits.limitFor(tenant.id, user.id, user.tenantRoles);
    if (!limit) return;
    const check = evaluateDiscount(lines as DiscountLine[], limit);
    if (check.ok) return;

    const details = {
      breached: check.breached,
      requestedPercent: check.percentBp / 100,
      requestedAmount: check.amount,
      maxPercent: limit.maxPercentBp === null ? null : limit.maxPercentBp / 100,
      maxAmount: limit.maxAmount,
    };
    const what = [
      check.breached.includes("percent") ? `${pct(check.percentBp)} is over your ${pct(limit.maxPercentBp!)} limit` : null,
      check.breached.includes("amount") ? `${rupees(check.amount)} is over your ${rupees(limit.maxAmount!)} limit per bill` : null,
    ]
      .filter(Boolean)
      .join(" and ");
    const raw = req.headers[APPROVAL_PIN_HEADER];
    const pin = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!pin) throw new AppError(403, "discount_approval_required", `This discount needs a manager's approval: ${what}`, details);

    const key = `${tenant.id}:${user.id}`;
    const failed = recent(key);
    if (failed.length >= APPROVAL_MAX_FAILURES) throw new AppError(429, "rate_limited", "Too many wrong manager PINs. Please wait a few minutes and try again");
    const approver = await deps.memberForPin(tenant.id, pin);
    const allowed = !!approver && approver.userId !== user.id && (approver.roles.some((r) => FULL_ACCESS_ROLES.includes(r)) || permissionsAllow(approver.permissions, DISCOUNT_APPROVE_PERMISSION));
    const record = (action: string, summary: string, extra: Record<string, unknown> = {}) =>
      deps.audit
        ?.record({ tenantId: tenant.id, actorUserId: user.id, action, entityType: "invoice", entityId: null, summary, after: { ...details, ...extra }, ip: req.ctx.ip, userAgent: req.ctx.userAgent })
        .catch(() => undefined);
    if (!approver || !allowed) {
      failed.push(now());
      failures.set(key, failed);
      await record("invoices.discount.approval_failed", approver ? "Discount approval refused: that member cannot approve discounts" : "Discount approval refused: unknown manager PIN");
      throw new AppError(403, "discount_approval_invalid", "That PIN can't approve this discount. Ask a manager for their PIN", { ...details, attemptsLeft: Math.max(0, APPROVAL_MAX_FAILURES - failed.length) });
    }
    failures.delete(key);
    await record("invoices.discount.approved", `Discount ${what.replace(/your /g, "the cashier's ")} approved by ${approver.name ?? "a manager"}`, { approvedBy: approver.userId });
  };
}
