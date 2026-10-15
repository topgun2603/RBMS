/** Feature keys the storefront reads (server: GET /v1/features `enabled`). Unknown or missing → off. */
export const STORE_FEATURES = {
  chat: "chat",
  support: "support",
  faq: "support.faq",
  marketplace: "marketplace",
  loyalty: "loyalty",
} as const;

export function featureOn(enabled: readonly string[] | null | undefined, key: string): boolean {
  return !!enabled && enabled.includes(key);
}

/** The help centre exists when either the FAQ or tickets are on (tickets without FAQ: only "Raise a ticket"). */
export function helpCentreOn(enabled: readonly string[] | null | undefined): boolean {
  return featureOn(enabled, STORE_FEATURES.support) || featureOn(enabled, STORE_FEATURES.faq);
}
