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
  type ChangeResult,
  type PlanInfo,
  type PlatformInvoice,
  type SubscriptionCurrent,
  type UsageItem,
} from "@srirealtime/web";

/**
 * Plan & billing data. API types live in @srirealtime/web (lib/subscriptions.ts) so the shell banner, upgrade dialog
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
