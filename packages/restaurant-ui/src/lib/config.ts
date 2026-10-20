/** Host settings the pages read (set once by restaurantModule()). */
export interface RestaurantConfig {
  /** App path of a bill, where payment is taken. */
  invoiceHref: (id: string) => string;
  /** The shop's online store, `{slug}` = shop subdomain; table QR codes open `<store>/table/<token>`. Null = no QR links. */
  storeUrl: string | null;
}

let config: RestaurantConfig = { invoiceHref: (id) => `/billing/invoices/${id}`, storeUrl: null };

export function setRestaurantConfig(c: Partial<RestaurantConfig>) {
  config = { ...config, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) };
}

export const restaurantConfig = () => config;

/** The QR link of a table, or null when no store URL is configured. */
export function tableQrUrl(slug: string | null, token: string): string | null {
  if (!config.storeUrl || !slug) return null;
  return `${config.storeUrl.replace("{slug}", slug).replace(/\/+$/, "")}/table/${token}`;
}
