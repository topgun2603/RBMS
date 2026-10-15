// Pure order-status rules for the UI: the same machine as @srirealtime/orders (logic.ts), plus what the screens need
// (the next step's button, kanban drops, which permission a move needs). No React, unit-tested.
import type { OrderStatus, PaymentStatus } from "./types";

/** The forward flow. Steps may be skipped forwards (a counter order placed → delivered). */
export const ORDER_FLOW: readonly OrderStatus[] = ["placed", "confirmed", "packed", "shipped", "delivered"];
export const CANCELLABLE: readonly OrderStatus[] = ["placed", "confirmed", "packed"];
/** Statuses that are finished: no more moves except a return from delivered. */
export const FINAL: readonly OrderStatus[] = ["delivered", "cancelled", "returned"];
/** Tabs on the list, in order ("all" first). */
export const STATUS_TABS = ["all", "placed", "confirmed", "packed", "shipped", "delivered", "cancelled", "returned"] as const;
export type StatusTab = (typeof STATUS_TABS)[number];

/** Statuses an order may move to next (mirrors the server; the detail page uses the server's `nextStatuses`). */
export function allowedTransitions(status: OrderStatus, opts: { returnsEnabled: boolean }): OrderStatus[] {
  const out: OrderStatus[] = [];
  const i = ORDER_FLOW.indexOf(status);
  if (i >= 0) out.push(...ORDER_FLOW.slice(i + 1));
  if (CANCELLABLE.includes(status)) out.push("cancelled");
  if (status === "delivered" && opts.returnsEnabled) out.push("returned");
  return out;
}

/** The one-step-forward status (the primary button), or null at the end of the flow. */
export function nextStep(status: OrderStatus, allowed?: readonly OrderStatus[]): OrderStatus | null {
  const i = ORDER_FLOW.indexOf(status);
  if (i < 0 || i === ORDER_FLOW.length - 1) return null;
  const next = ORDER_FLOW[i + 1]!;
  if (allowed && !allowed.includes(next)) return null;
  return next;
}

/** Forward statuses after the next step (shown as "skip to …" in the menu). */
export function skipAheadSteps(status: OrderStatus, allowed: readonly OrderStatus[]): OrderStatus[] {
  const next = nextStep(status, allowed);
  return allowed.filter((s) => ORDER_FLOW.includes(s) && s !== next);
}

/** Moves that need a dialog before they run. */
export type TransitionDialog = "cancel" | "return" | "ship" | null;
export function dialogFor(to: OrderStatus): TransitionDialog {
  if (to === "cancelled") return "cancel";
  if (to === "returned") return "return";
  if (to === "shipped") return "ship";
  return null;
}

/** Permission keys that allow moving an order to `to` (any one of them; owners/admins have `*`). Same as the API. */
export function transitionPermissions(to: OrderStatus): string[] {
  if (to === "cancelled") return ["orders.cancel"];
  if (to === "shipped") return ["orders.manage", "orders.ship"];
  if (to === "delivered") return ["orders.manage", "orders.deliver"];
  return ["orders.manage"];
}

/** Kanban: may a card in `from` be dropped on the `to` column? Only forward moves the machine allows. */
export function canDrop(from: OrderStatus, to: OrderStatus, opts: { returnsEnabled: boolean }): boolean {
  if (from === to) return false;
  if (!ORDER_FLOW.includes(to)) return false;
  return allowedTransitions(from, opts).includes(to);
}

/** Bulk "mark packed": the selected orders that can be packed. */
export const canMarkPacked = (status: OrderStatus) => status === "placed" || status === "confirmed";

/** Columns shown on the kanban board. */
export const KANBAN_COLUMNS: readonly OrderStatus[] = ORDER_FLOW;

/** Index of `status` in the flow for progress bars; cancelled/returned → -1. */
export const flowIndex = (status: OrderStatus) => ORDER_FLOW.indexOf(status);

/** Payment pill kind: paid / COD / pending / refunded (partially) / unpaid. */
export type PaymentPillKind = "paid" | "cod" | "pending" | "refunded" | "partial_refund" | "unpaid";
export function paymentPillKind(status: PaymentStatus): PaymentPillKind {
  switch (status) {
    case "paid":
      return "paid";
    case "cod":
      return "cod";
    case "pending":
      return "pending";
    case "refunded":
      return "refunded";
    case "partially_refunded":
      return "partial_refund";
    default:
      return "unpaid";
  }
}

/**
 * Optimistic counts after moving one order from `from` to `to`: the source tab loses one, the target gains one.
 * Missing keys count as 0; never below 0.
 */
export function moveCount(counts: Partial<Record<OrderStatus, number>>, from: OrderStatus, to: OrderStatus): Record<OrderStatus, number> {
  const out = { placed: 0, confirmed: 0, packed: 0, shipped: 0, delivered: 0, cancelled: 0, returned: 0, ...counts } as Record<OrderStatus, number>;
  if (from === to) return out;
  out[from] = Math.max(0, (out[from] ?? 0) - 1);
  out[to] = (out[to] ?? 0) + 1;
  return out;
}

/** Sum of all status counts ("All" tab). */
export const totalCount = (counts: Partial<Record<OrderStatus, number>> | undefined) =>
  Object.values(counts ?? {}).reduce<number>((s, n) => s + (n ?? 0), 0);
