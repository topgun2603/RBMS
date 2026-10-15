import { LOYALTY_FEATURE_KEYS } from "./features";
import { toIndianE164 } from "./logic";
import { noopLogger, type FeatureGatePort, type LoggerPort } from "./ports";
import type { EarnResult, LoyaltyService, ReverseResult } from "./service";

/**
 * How apps/api/src/kit.ts should wire loyalty to the other modules (packages never import each other). Each entry
 * names the source event, the hook to call, and what to pass.
 */
export const LOYALTY_EVENT_WIRING = [
  {
    event: "invoices: bill fully paid (status → paid), counter or credit",
    hook: "invoicePaid",
    pass: "{ id, customerPhone, customerName, amount: bill total minus any loyalty discount line }",
  },
  {
    event: "invoices: paid bill cancelled / credit note for the whole bill",
    hook: "invoiceCancelled",
    pass: "invoice id",
  },
  {
    event: "orders: status → delivered, or payment captured (whichever first; earn is idempotent per order)",
    hook: "orderCompleted",
    pass: "{ id, customer.phone, customer.name, amount: order total paid (after the points discount, excl. refunds) }",
  },
  {
    event: "orders: status → cancelled or returned (or fully refunded)",
    hook: "orderCancelled",
    pass: "order id (gives back redeemed points and takes back earned ones)",
  },
  {
    event: "checkout (orders) and billing (invoices) applying points",
    hook: "service.redeem",
    pass: "{ memberKey: phone, points, refType: 'order' | 'invoice', refId, orderAmount } → { discount } as a discount line; call before the order/bill is final, and reverse on failure",
  },
] as const;

export interface LoyaltyHookDeps {
  service: Pick<LoyaltyService, "earn" | "reverse">;
  /** Skips shops with `loyalty` off. */
  featureGate?: FeatureGatePort;
  log?: LoggerPort;
}

export interface PurchaseEvent {
  id: string;
  /** Paise the customer paid (net of the points discount). */
  amount: number;
  customerPhone?: string | null;
  customerName?: string | null;
}

/** Event handlers for the kit. They never throw (a loyalty failure must not break a payment or order update). */
export interface LoyaltyHooks {
  invoicePaid(tenantId: string, invoice: PurchaseEvent): Promise<EarnResult | null>;
  invoiceCancelled(tenantId: string, invoiceId: string): Promise<ReverseResult | null>;
  orderCompleted(tenantId: string, order: PurchaseEvent): Promise<EarnResult | null>;
  orderCancelled(tenantId: string, orderId: string): Promise<ReverseResult | null>;
}

export function createLoyaltyHooks(deps: LoyaltyHookDeps): LoyaltyHooks {
  const log = deps.log ?? noopLogger;
  const enabled = async (tenantId: string) => {
    if (!deps.featureGate) return true;
    try {
      return await deps.featureGate.isEnabled(tenantId, LOYALTY_FEATURE_KEYS.base);
    } catch (err) {
      log.warn({ err, tenantId }, "loyalty: feature check failed, skipping");
      return false;
    }
  };

  const earn = async (tenantId: string, refType: "invoice" | "order", e: PurchaseEvent) => {
    const memberKey = toIndianE164(e.customerPhone);
    if (!memberKey || !(e.amount > 0)) return null;
    if (!(await enabled(tenantId))) return null;
    try {
      return await deps.service.earn(tenantId, { memberKey, name: e.customerName ?? null, amount: Math.round(e.amount), refType, refId: e.id });
    } catch (err) {
      log.error({ err, tenantId, refType, refId: e.id }, "loyalty earn failed");
      return null;
    }
  };

  // Reversals run even when the feature is off now: points earned while it was on must still be undone.
  const reverse = async (tenantId: string, refType: "invoice" | "order", id: string) => {
    try {
      return await deps.service.reverse(tenantId, refType, id);
    } catch (err) {
      log.error({ err, tenantId, refType, refId: id }, "loyalty reverse failed");
      return null;
    }
  };

  return {
    invoicePaid: (tenantId, invoice) => earn(tenantId, "invoice", invoice),
    invoiceCancelled: (tenantId, invoiceId) => reverse(tenantId, "invoice", invoiceId),
    orderCompleted: (tenantId, order) => earn(tenantId, "order", order),
    orderCancelled: (tenantId, orderId) => reverse(tenantId, "order", orderId),
  };
}
