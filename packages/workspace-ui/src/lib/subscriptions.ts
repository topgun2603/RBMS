"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  apiDownload,
  ApiError,
  featureKeys,
  normalizeInvoice,
  subscriptionKeys,
  useSubscriptionCurrent,
  type BillingInterval,
  type ChangePreview,
  type ChangeResult,
  type PlanInfo,
  type PlatformInvoice,
  type SubscriptionCurrent,
  type UsageItem,
} from "@rbms/web";

/**
 * Plan & billing data. API types live in @rbms/web (lib/subscriptions.ts) so the shell banner, upgrade dialog
 * and this page read the same shapes.
 */

/** The current subscription, or, when the subscriptions routes aren't there (404), the plan + usage from /plans/current. */
export function usePlanState() {
  const current = useSubscriptionCurrent();
  const missing = current.error instanceof ApiError && current.error.status === 404;
  const legacy = useQuery({
    queryKey: ["plans", "current"],
    queryFn: () =>
      api.get<{ plan: PlanInfo | null; usage?: { items?: UsageItem[] } | UsageItem[] }>("/plans/current").then(
        (r): SubscriptionCurrent => ({
          subscription: null,
          plan: r.plan,
          trialDaysLeft: null,
          usage: Array.isArray(r.usage) ? r.usage : (r.usage?.items ?? []),
          canTrial: false,
        }),
      ),
    enabled: missing,
  });
  if (missing) return { ...legacy, readOnly: true as const };
  return { ...current, refetch: current.refetch, readOnly: false as const };
}

export function usePlatformInvoices(enabled = true) {
  return useQuery<PlatformInvoice[]>({
    queryKey: subscriptionKeys.invoices,
    queryFn: ({ signal }) =>
      api
        .get<{ items?: Record<string, unknown>[] } | Record<string, unknown>[]>("/subscriptions/invoices", undefined, { signal })
        .then((r) => (Array.isArray(r) ? r : (r.items ?? [])).map(normalizeInvoice)),
    enabled,
    retry: (n, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && n < 1,
  });
}

/** Responses that may hand back a mandate URL to open (checkout; an upgrade that starts a new mandate). */
export interface MaybeAuth {
  authUrl?: string | null;
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: subscriptionKeys.all });
    void qc.invalidateQueries({ queryKey: ["plans", "current"] });
    // The tenant plan may have changed: features and their gates follow it.
    void qc.invalidateQueries({ queryKey: featureKeys.all });
  };
}

export function useChangePlan() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: { planId: string; interval: BillingInterval }) => api.post<ChangeResult>("/subscriptions/change", body),
    onSuccess: invalidate,
  });
}

/**
 * What choosing `planId`/`interval` would do and cost (credit for the unused days, due now with GST, when it starts):
 * POST /subscriptions/change/preview. Off while `enabled` is false (the confirm dialog is closed).
 */
export function useChangePreview(target: { planId: string; interval: BillingInterval } | null, enabled = true) {
  return useQuery<ChangePreview>({
    queryKey: [...subscriptionKeys.all, "preview", target?.planId ?? "", target?.interval ?? ""],
    queryFn: ({ signal }) => api.post<ChangePreview>("/subscriptions/change/preview", target, { signal }),
    enabled: enabled && !!target,
    staleTime: 30_000,
    retry: (n, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && n < 1,
  });
}

/** Drops an upgrade that is waiting for payment (POST /subscriptions/change/cancel). */
export function useCancelUpgrade() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: () => api.post("/subscriptions/change/cancel"), onSuccess: invalidate });
}

export function useCheckout() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: { planId: string; interval: BillingInterval }) => api.post<MaybeAuth>("/subscriptions/checkout", body),
    onSuccess: invalidate,
  });
}

export function useCancelSubscription() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: () => api.post("/subscriptions/cancel"), onSuccess: invalidate });
}

export function useResumeSubscription() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: () => api.post<MaybeAuth>("/subscriptions/resume"), onSuccess: invalidate });
}

/** Mock provider only (non-production): completes the mandate the mock authUrl stands for. */
export function useMockAuthorize() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (subscriptionId: string) => api.post("/subscriptions/mock/authorize", { subscriptionId }),
    onSuccess: invalidate,
  });
}

export const downloadInvoicePdf = (inv: Pick<PlatformInvoice, "id" | "number">) =>
  apiDownload(`/subscriptions/invoices/${inv.id}.pdf`, {}, `${inv.number.replace(/[^\w-]+/g, "-") || "invoice"}.pdf`);

/**
 * Opens a mandate URL. Same-origin (the mock provider's link back to this page) replaces the page; Razorpay's opens in
 * a new tab, and this page refreshes when the owner comes back (the current query refetches on focus).
 */
export function openAuthUrl(url: string): "same" | "new" {
  try {
    const u = new URL(url, window.location.href);
    if (u.origin === window.location.origin) {
      window.location.assign(u.toString());
      return "same";
    }
    window.open(u.toString(), "_blank", "noopener");
    return "new";
  } catch {
    window.location.assign(url);
    return "same";
  }
}

// ---------------------------------------------------------------- add-ons (GET/POST /v1/subscriptions/addons*)

/** A catalogue add-on. Prices are GST-exclusive paise. */
export interface AddonInfo {
  id: string;
  code: string;
  kind: "limit" | "feature" | "credits";
  name: string;
  description: string | null;
  /** Per unit: limits added (limit) or credits granted per pack (credits). */
  limits: Record<string, number>;
  modules: string[];
  priceMonthlyPaise: number;
  priceYearlyPaise: number;
  priceOncePaise: number;
  minQuantity: number;
  maxQuantity: number;
  tiers: string[];
}

/** The shop's own add-on. */
export interface ShopAddon {
  id: string;
  addonId: string;
  name: string;
  kind: AddonInfo["kind"] | null;
  source: "plan" | "comp";
  status: "active" | "ended";
  quantity: number;
  nextQuantity: number | null;
  activeQuantity: number;
  interval: BillingInterval;
  unitPricePaise: number;
  currentPeriodEnd: string | null;
  endsAtPeriodEnd: boolean;
  endReason: "cancelled" | "plan_change" | "plan_ended" | "comp_ended" | "removed" | null;
  notice: string | null;
}

export interface AddonPayment {
  id: string;
  addonId: string;
  kind: "proration" | "credits";
  fromQuantity: number;
  toQuantity: number;
  taxablePaise: number;
  chargePaise: number;
  label: string;
  status: "pending" | "paid" | "cancelled" | "expired";
  authUrl: string | null;
  providerPaymentId: string | null;
  expiresAt: string;
}

export type AddonBlock = "tier" | "app" | "included";
export type AddonBillingBlock = "trial" | "free" | "manual" | "past_due" | "payment_setup" | "cancelling" | "upgrade_pending" | "ended" | "no_provider";

export interface AddonOffer {
  addon: AddonInfo;
  interval: BillingInterval | null;
  unitPricePaise: number;
  block: AddonBlock | null;
  billing: AddonBillingBlock | null;
  current: ShopAddon | null;
  pendingPayment: AddonPayment | null;
}

export interface AddonsState {
  interval: BillingInterval;
  periodEnd: string | null;
  billing: AddonBillingBlock | null;
  items: AddonOffer[];
  other: ShopAddon[];
  payments: AddonPayment[];
  credits: Record<string, number>;
}

/** POST /addons/preview. Money in paise. */
export interface AddonPreview {
  addonId: string;
  quantity: number;
  fromQuantity: number;
  kind: "buy" | "increase" | "decrease" | "cancel" | "resume" | "credits" | "same";
  applies: "after_payment" | "period_end" | "now" | "none";
  interval: BillingInterval | null;
  unitPricePaise: number;
  unusedDays: number;
  periodDays: number;
  taxablePaise: number;
  chargeTodayPaise: number;
  gst: ChangePreview["gst"];
  startsAt: string | null;
  nextChargeAt: string | null;
  nextRenewalPaise: number;
  recurringPaise: number;
  credits?: Record<string, number>;
  block: AddonBlock | AddonBillingBlock | null;
}

const addonKeys = { all: [...subscriptionKeys.all, "addons"] as const };

export function useAddons(enabled = true) {
  return useQuery<AddonsState>({
    queryKey: addonKeys.all,
    queryFn: ({ signal }) => api.get<AddonsState>("/subscriptions/addons", undefined, { signal }),
    enabled,
    retry: (n, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && n < 1,
  });
}

/** What setting an add-on to `quantity` would do and charge; off while `enabled` is false (dialog closed). */
export function useAddonPreview(target: { addonId: string; quantity: number } | null, enabled = true) {
  return useQuery<AddonPreview>({
    queryKey: [...addonKeys.all, "preview", target?.addonId ?? "", target?.quantity ?? -1],
    queryFn: ({ signal }) => api.post<AddonPreview>("/subscriptions/addons/preview", target, { signal }),
    enabled: enabled && !!target,
    staleTime: 30_000,
    retry: (n, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && n < 1,
  });
}

export function useSetAddon() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: { addonId: string; quantity: number }) =>
      api.post<{ applied: AddonPreview["applies"]; authUrl?: string | null; payment?: AddonPayment | null }>("/subscriptions/addons", body),
    onSuccess: invalidate,
  });
}

export function useCancelAddonPayment() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => api.post(`/subscriptions/addons/payments/${id}/cancel`), onSuccess: invalidate });
}

/** The mock provider's `?mockPay=<link id>` (non-production only). */
export const MOCK_PAY_PARAM = "mockPay";

/** Mock provider only: pays an add-on payment link. */
export function useMockPay() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (paymentId: string) => api.post("/subscriptions/mock/pay", { paymentId }), onSuccess: invalidate });
}
